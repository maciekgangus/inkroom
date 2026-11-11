// Package store persists accounts, sessions, boards and strokes in SQLite (ADR 0005).
package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite" // pure-Go driver, registers "sqlite"
)

var (
	// ErrNotFound is returned when a row does not exist (or a session expired).
	ErrNotFound = errors.New("not found")
	// ErrEmailTaken is returned when registering an e-mail that already has an account.
	ErrEmailTaken = errors.New("email already registered")
	// ErrUsernameTaken is returned when a username is used (letter case does not matter).
	ErrUsernameTaken = errors.New("username already taken")
)

// User is an account.
type User struct {
	ID       int64
	Email    string
	Username string // the public name, as typed (R-053)
	Hash     string // argon2id hash
}

// Board is a saved board.
type Board struct {
	ID      string
	OwnerID int64
	Name    string
	// Background is the board's shared backdrop: plain, dots, grid or lines (ADR 0010).
	Background string
	CreatedAt  time.Time
	UpdatedAt  time.Time
	// OwnerName is the owner's username, filled in only for boards listed as visited (R-051).
	OwnerName string
}

// Op is one change to a board's strokes: add a stroke if it is not there yet, replace an
// existing one, or (with neither flag) remove it.
type Op struct {
	Add     bool
	Replace bool
	ID      string
	Data    []byte
}

// Store is a SQLite-backed store. Safe for concurrent use.
type Store struct {
	db *sql.DB
}

const schema = `
CREATE TABLE users (
	id INTEGER PRIMARY KEY,
	email TEXT NOT NULL UNIQUE,
	hash TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
	token_hash TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at INTEGER NOT NULL
);
CREATE TABLE boards (
	id TEXT PRIMARY KEY,
	owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX boards_owner ON boards(owner_id);
CREATE TABLE visits (
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
	last_opened INTEGER NOT NULL,
	PRIMARY KEY (user_id, board_id)
);
CREATE TABLE strokes (
	board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
	id TEXT NOT NULL,
	data BLOB NOT NULL,
	PRIMARY KEY (board_id, id)
);
`

const imagesSchema = `
CREATE TABLE images (
	id TEXT PRIMARY KEY,
	board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
	mime TEXT NOT NULL,
	data BLOB NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX images_board ON images(board_id);
`

// migrations run in order; the number applied is kept in PRAGMA user_version.
var migrations = []migration{
	stmt(schema),
	stmt(imagesSchema),
	stmt("ALTER TABLE boards ADD COLUMN background TEXT NOT NULL DEFAULT 'plain'"),
	// Where each user last looked on each board, so a reload puts them back there.
	stmt(`CREATE TABLE views (
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
	x REAL NOT NULL,
	y REAL NOT NULL,
	scale REAL NOT NULL,
	PRIMARY KEY (user_id, board_id)
)`),
	// People who may not draw on a board (R-016, ADR 0011).
	stmt(`CREATE TABLE board_revoked (
	board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
	person TEXT NOT NULL,
	PRIMARY KEY (board_id, person)
)`),
	// Usernames (R-053, ADR 0013): existing accounts are named after their e-mail.
	addUsernames,
}

// migration changes the schema inside a transaction.
type migration func(tx *sql.Tx) error

// stmt is a migration that is a single SQL statement.
func stmt(q string) migration {
	return func(tx *sql.Tx) error {
		_, err := tx.Exec(q)
		return err
	}
}

func addUsernames(tx *sql.Tx) error {
	for _, q := range []string{
		"ALTER TABLE users ADD COLUMN username TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE users ADD COLUMN username_key TEXT NOT NULL DEFAULT ''",
	} {
		if _, err := tx.Exec(q); err != nil {
			return err
		}
	}
	rows, err := tx.Query("SELECT id, email FROM users ORDER BY id")
	if err != nil {
		return err
	}
	type account struct {
		id    int64
		email string
	}
	var accounts []account
	for rows.Next() {
		var a account
		if err := rows.Scan(&a.id, &a.email); err != nil {
			rows.Close()
			return err
		}
		accounts = append(accounts, a)
	}
	rows.Close()
	taken := map[string]bool{}
	for _, a := range accounts {
		name := usernameFromEmail(a.email, func(key string) bool { return taken[key] })
		taken[strings.ToLower(name)] = true
		if _, err := tx.Exec("UPDATE users SET username = ?, username_key = ? WHERE id = ?", name, strings.ToLower(name), a.id); err != nil {
			return err
		}
	}
	_, err = tx.Exec("CREATE UNIQUE INDEX users_username_key ON users(username_key)")
	return err
}

const (
	minUsername = 3
	maxUsername = 24
)

// usernameFromEmail makes a name out of the part of an e-mail before the @: lower case, only
// the characters a username may have, at least three of them, and (when `taken` says the key is
// used) a number on the end.
func usernameFromEmail(email string, taken func(key string) bool) string {
	local, _, _ := strings.Cut(email, "@")
	var b strings.Builder
	for _, r := range strings.ToLower(local) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '.' || r == '_' || r == '-' {
			b.WriteRune(r)
		}
	}
	base := b.String()
	for len(base) < minUsername {
		base += "0"
	}
	if len(base) > maxUsername {
		base = base[:maxUsername]
	}
	name := base
	for n := 2; taken(strings.ToLower(name)); n++ {
		suffix := strconv.Itoa(n)
		cut := base
		if len(cut)+len(suffix) > maxUsername {
			cut = cut[:maxUsername-len(suffix)]
		}
		name = cut + suffix
	}
	return name
}

// DefaultBackground is the background of a new board.
const DefaultBackground = "plain"

// ValidBackground reports whether v names a board background.
func ValidBackground(v string) bool {
	switch v {
	case "plain", "dots", "grid", "lines":
		return true
	}
	return false
}

// Open opens (creating if needed) the database at path and applies migrations.
func Open(path string) (*Store, error) {
	return openMigrated(path, len(migrations))
}

// openMigrated opens the database and applies the first `upTo` migrations (tests open an old one).
func openMigrated(path string, upTo int) (*Store, error) {
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // one connection: no lock contention, plenty for this scale
	s := &Store{db: db}
	if err := s.migrate(upTo); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate(upTo int) error {
	var version int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	for i := version; i < upTo; i++ {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if err := migrations[i](tx); err != nil {
			tx.Rollback()
			return err
		}
		// PRAGMA does not accept bound parameters.
		if _, err := tx.Exec("PRAGMA user_version = " + strconv.Itoa(i+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func unix(t time.Time) int64 { return t.Unix() }

// CreateUser adds an account whose username is made from the e-mail (see usernameFromEmail).
// The e-mail must already be normalized. Registration uses CreateAccount with a chosen name.
func (s *Store) CreateUser(email, hash string) (User, error) {
	for attempt := 0; attempt < 5; attempt++ {
		name := usernameFromEmail(email, func(key string) bool {
			var one int
			return s.db.QueryRow("SELECT 1 FROM users WHERE username_key = ?", key).Scan(&one) == nil
		})
		u, err := s.CreateAccount(email, name, hash)
		if !errors.Is(err, ErrUsernameTaken) {
			return u, err
		}
	}
	return User{}, ErrUsernameTaken
}

// CreateAccount adds an account with the given username. The e-mail must already be normalized.
func (s *Store) CreateAccount(email, username, hash string) (User, error) {
	var one int
	if s.db.QueryRow("SELECT 1 FROM users WHERE email = ?", email).Scan(&one) == nil {
		return User{}, ErrEmailTaken // reported first when both are taken
	}
	res, err := s.db.Exec("INSERT INTO users (email, hash, created_at, username, username_key) VALUES (?, ?, ?, ?, ?)",
		email, hash, unix(time.Now()), username, strings.ToLower(username))
	if err != nil {
		switch {
		case strings.Contains(err.Error(), "users.username_key"):
			return User{}, ErrUsernameTaken
		case strings.Contains(err.Error(), "UNIQUE"):
			return User{}, ErrEmailTaken
		}
		return User{}, err
	}
	id, _ := res.LastInsertId()
	return User{ID: id, Email: email, Username: username, Hash: hash}, nil
}

const userCols = "id, email, username, hash"

func scanUser(sc interface{ Scan(...any) error }) (User, error) {
	var u User
	err := sc.Scan(&u.ID, &u.Email, &u.Username, &u.Hash)
	return u, notFound(err)
}

// UserByEmail finds an account by (normalized) e-mail.
func (s *Store) UserByEmail(email string) (User, error) {
	return scanUser(s.db.QueryRow("SELECT "+userCols+" FROM users WHERE email = ?", email))
}

// UserByLogin finds an account by what a person types to log in: an e-mail (it has an @) or a
// username, in any letter case.
func (s *Store) UserByLogin(login string) (User, error) {
	login = strings.ToLower(strings.TrimSpace(login))
	if strings.Contains(login, "@") {
		return s.UserByEmail(login)
	}
	return scanUser(s.db.QueryRow("SELECT "+userCols+" FROM users WHERE username_key = ?", login))
}

// CreateSession stores a session by the hash of its token.
func (s *Store) CreateSession(tokenHash string, userID int64, expires time.Time) error {
	_, err := s.db.Exec("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", tokenHash, userID, unix(expires))
	return err
}

// SessionUser returns the user of a live session, or ErrNotFound if missing or expired.
func (s *Store) SessionUser(tokenHash string, now time.Time) (User, error) {
	return scanUser(s.db.QueryRow(`SELECT u.id, u.email, u.username, u.hash FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ?`, tokenHash, unix(now)))
}

// ExtendSession moves a session's expiry.
func (s *Store) ExtendSession(tokenHash string, expires time.Time) error {
	_, err := s.db.Exec("UPDATE sessions SET expires_at = ? WHERE token_hash = ?", unix(expires), tokenHash)
	return err
}

// DeleteSession ends a session.
func (s *Store) DeleteSession(tokenHash string) error {
	_, err := s.db.Exec("DELETE FROM sessions WHERE token_hash = ?", tokenHash)
	return err
}

// CreateBoard adds a board owned by ownerID.
func (s *Store) CreateBoard(id string, ownerID int64, name string) (Board, error) {
	now := time.Now().Truncate(time.Second)
	_, err := s.db.Exec("INSERT INTO boards (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
		id, ownerID, name, unix(now), unix(now))
	if err != nil {
		return Board{}, err
	}
	return Board{ID: id, OwnerID: ownerID, Name: name, Background: DefaultBackground, CreatedAt: now, UpdatedAt: now}, nil
}

func scanBoard(sc interface{ Scan(...any) error }) (Board, error) {
	var b Board
	var created, updated int64
	if err := sc.Scan(&b.ID, &b.OwnerID, &b.Name, &b.Background, &created, &updated); err != nil {
		return Board{}, err
	}
	b.CreatedAt, b.UpdatedAt = time.Unix(created, 0), time.Unix(updated, 0)
	return b, nil
}

const boardCols = "b.id, b.owner_id, b.name, b.background, b.created_at, b.updated_at"

// Board returns a board by id.
func (s *Store) Board(id string) (Board, error) {
	b, err := scanBoard(s.db.QueryRow("SELECT "+boardCols+" FROM boards b WHERE b.id = ?", id))
	return b, notFound(err)
}

// RenameBoard changes a board's name.
func (s *Store) RenameBoard(id, name string) error {
	return s.mustAffect(s.db.Exec("UPDATE boards SET name = ? WHERE id = ?", name, id))
}

// SetBoardBackground changes a board's background; the caller validates the value.
func (s *Store) SetBoardBackground(id, background string) error {
	return s.mustAffect(s.db.Exec("UPDATE boards SET background = ? WHERE id = ?", background, id))
}

// LoadBackground returns a board's background.
func (s *Store) LoadBackground(id string) (string, error) {
	b, err := s.Board(id)
	return b.Background, err
}

// DeleteBoard removes a board with its strokes and visit records.
func (s *Store) DeleteBoard(id string) error {
	return s.mustAffect(s.db.Exec("DELETE FROM boards WHERE id = ?", id))
}

// BoardsOwnedBy lists a user's boards, most recently changed first.
func (s *Store) BoardsOwnedBy(userID int64) ([]Board, error) {
	return s.boards("SELECT "+boardCols+" FROM boards b WHERE b.owner_id = ? ORDER BY b.updated_at DESC, b.id", userID)
}

// BoardsVisitedBy lists other people's boards the user opened, most recently opened first.
func (s *Store) BoardsVisitedBy(userID int64) ([]Board, error) {
	rows, err := s.db.Query("SELECT "+boardCols+`, o.username FROM visits v
		JOIN boards b ON b.id = v.board_id JOIN users o ON o.id = b.owner_id
		WHERE v.user_id = ? AND b.owner_id != ? ORDER BY v.last_opened DESC, b.id`, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Board
	for rows.Next() {
		var b Board
		var created, updated int64
		if err := rows.Scan(&b.ID, &b.OwnerID, &b.Name, &b.Background, &created, &updated, &b.OwnerName); err != nil {
			return nil, err
		}
		b.CreatedAt, b.UpdatedAt = time.Unix(created, 0), time.Unix(updated, 0)
		out = append(out, b)
	}
	return out, rows.Err()
}

// RemoveVisit takes a board off userID's list of boards they were invited to. The board and
// its link are untouched; opening it again lists it again. Removing a missing visit is fine.
func (s *Store) RemoveVisit(userID int64, boardID string) error {
	_, err := s.db.Exec("DELETE FROM visits WHERE user_id = ? AND board_id = ?", userID, boardID)
	return err
}

func (s *Store) boards(query string, args ...any) ([]Board, error) {
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Board
	for rows.Next() {
		b, err := scanBoard(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// RecordVisit remembers that userID opened boardID (no-op for the owner's own board).
func (s *Store) RecordVisit(userID int64, boardID string, at time.Time) error {
	_, err := s.db.Exec(`INSERT INTO visits (user_id, board_id, last_opened)
		SELECT ?, id, ? FROM boards WHERE id = ? AND owner_id != ?
		ON CONFLICT (user_id, board_id) DO UPDATE SET last_opened = excluded.last_opened`,
		userID, unix(at), boardID, userID)
	return err
}

// Apply writes a batch of stroke changes in one transaction and bumps the board's updated_at.
func (s *Store) Apply(boardID string, ops []Op, at time.Time) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, op := range ops {
		if op.Add {
			_, err = tx.Exec("INSERT OR IGNORE INTO strokes (board_id, id, data) VALUES (?, ?, ?)", boardID, op.ID, op.Data)
		} else if op.Replace {
			_, err = tx.Exec("UPDATE strokes SET data = ? WHERE board_id = ? AND id = ?", op.Data, boardID, op.ID)
		} else {
			_, err = tx.Exec("DELETE FROM strokes WHERE board_id = ? AND id = ?", boardID, op.ID)
		}
		if err != nil {
			return err
		}
	}
	if _, err := tx.Exec("UPDATE boards SET updated_at = ? WHERE id = ?", unix(at), boardID); err != nil {
		return err
	}
	return tx.Commit()
}

// LoadStrokes returns a board's strokes (raw JSON) in insertion order.
func (s *Store) LoadStrokes(boardID string) ([][]byte, error) {
	rows, err := s.db.Query("SELECT data FROM strokes WHERE board_id = ? ORDER BY rowid", boardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out [][]byte
	for rows.Next() {
		var d []byte
		if err := rows.Scan(&d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// SaveImage stores an image's bytes under a board. The board must exist.
func (s *Store) SaveImage(id, boardID, mime string, data []byte) error {
	_, err := s.db.Exec("INSERT INTO images (id, board_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)",
		id, boardID, mime, data, unix(time.Now()))
	return err
}

// Image returns an image's type and bytes, only through the board it belongs to.
func (s *Store) Image(boardID, id string) (mime string, data []byte, err error) {
	err = s.db.QueryRow("SELECT mime, data FROM images WHERE board_id = ? AND id = ?", boardID, id).Scan(&mime, &data)
	return mime, data, notFound(err)
}

func (s *Store) mustAffect(res sql.Result, err error) error {
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// View is the part of a board a user last looked at: the board point at the top left of their
// screen and the zoom.
type View struct {
	X, Y, Scale float64
}

// SetView remembers where userID last looked on boardID, replacing the previous view.
func (s *Store) SetView(userID int64, boardID string, v View) error {
	_, err := s.db.Exec(`INSERT INTO views (user_id, board_id, x, y, scale) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, board_id) DO UPDATE SET x = excluded.x, y = excluded.y, scale = excluded.scale`,
		userID, boardID, v.X, v.Y, v.Scale)
	return err
}

// View returns where userID last looked on boardID, or ErrNotFound if never saved.
func (s *Store) View(userID int64, boardID string) (View, error) {
	var v View
	err := s.db.QueryRow(`SELECT x, y, scale FROM views WHERE user_id = ? AND board_id = ?`,
		userID, boardID).Scan(&v.X, &v.Y, &v.Scale)
	if errors.Is(err, sql.ErrNoRows) {
		return View{}, ErrNotFound
	}
	return v, err
}

// SetRevoked records that person may not draw on boardID (or, with revoked false, may again).
func (s *Store) SetRevoked(boardID, person string, revoked bool) error {
	if revoked {
		_, err := s.db.Exec(`INSERT OR IGNORE INTO board_revoked (board_id, person) VALUES (?, ?)`, boardID, person)
		return err
	}
	_, err := s.db.Exec(`DELETE FROM board_revoked WHERE board_id = ? AND person = ?`, boardID, person)
	return err
}

// LoadRevoked returns the people who may not draw on boardID.
func (s *Store) LoadRevoked(boardID string) ([]string, error) {
	rows, err := s.db.Query(`SELECT person FROM board_revoked WHERE board_id = ? ORDER BY person`, boardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CopyBoard makes a new board `id` owned by ownerID out of board `from`: the same strokes in the
// same order, the same background and copies of its images (each under a fresh id from
// newImageID, which the copied pictures are pointed at). All or nothing.
func (s *Store) CopyBoard(from, id string, ownerID int64, name string, newImageID func() string) (Board, error) {
	src, err := s.Board(from)
	if err != nil {
		return Board{}, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return Board{}, err
	}
	defer tx.Rollback()
	now := time.Now().Truncate(time.Second)
	if _, err := tx.Exec("INSERT INTO boards (id, owner_id, name, background, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		id, ownerID, name, src.Background, unix(now), unix(now)); err != nil {
		return Board{}, err
	}

	renamed := map[string]string{} // old image id -> id of its copy
	imgs, err := tx.Query("SELECT id, mime, data FROM images WHERE board_id = ?", from)
	if err != nil {
		return Board{}, err
	}
	type image struct {
		old, mime string
		data      []byte
	}
	var images []image
	for imgs.Next() {
		var im image
		if err := imgs.Scan(&im.old, &im.mime, &im.data); err != nil {
			imgs.Close()
			return Board{}, err
		}
		images = append(images, im)
	}
	imgs.Close()
	for _, im := range images {
		fresh := newImageID()
		renamed[im.old] = fresh
		if _, err := tx.Exec("INSERT INTO images (id, board_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)",
			fresh, id, im.mime, im.data, unix(now)); err != nil {
			return Board{}, err
		}
	}

	rows, err := tx.Query("SELECT id, data FROM strokes WHERE board_id = ? ORDER BY rowid", from)
	if err != nil {
		return Board{}, err
	}
	type stroke struct {
		id   string
		data []byte
	}
	var strokes []stroke
	for rows.Next() {
		var st stroke
		if err := rows.Scan(&st.id, &st.data); err != nil {
			rows.Close()
			return Board{}, err
		}
		strokes = append(strokes, st)
	}
	rows.Close()
	for _, st := range strokes {
		if _, err := tx.Exec("INSERT INTO strokes (board_id, id, data) VALUES (?, ?, ?)", id, st.id, repointImage(st.data, renamed)); err != nil {
			return Board{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Board{}, err
	}
	return Board{ID: id, OwnerID: ownerID, Name: name, Background: src.Background, CreatedAt: now, UpdatedAt: now}, nil
}

// repointImage returns a stroke's JSON with its picture's `src` replaced by the copy's id. A
// stroke that is not a picture, or whose picture was not copied, is returned as it is.
func repointImage(data []byte, renamed map[string]string) []byte {
	var m map[string]json.RawMessage
	if json.Unmarshal(data, &m) != nil {
		return data
	}
	var src string
	if json.Unmarshal(m["src"], &src) != nil || renamed[src] == "" {
		return data
	}
	m["src"], _ = json.Marshal(renamed[src])
	out, err := json.Marshal(m)
	if err != nil {
		return data
	}
	return out
}
