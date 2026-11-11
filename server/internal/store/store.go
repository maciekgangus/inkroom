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
)

// User is an account.
type User struct {
	ID    int64
	Email string
	Hash  string // argon2id hash
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
var migrations = []string{
	schema,
	imagesSchema,
	"ALTER TABLE boards ADD COLUMN background TEXT NOT NULL DEFAULT 'plain'",
	// Where each user last looked on each board, so a reload puts them back there.
	`CREATE TABLE views (
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
	x REAL NOT NULL,
	y REAL NOT NULL,
	scale REAL NOT NULL,
	PRIMARY KEY (user_id, board_id)
)`,
	// People who may not draw on a board (R-016, ADR 0011).
	`CREATE TABLE board_revoked (
	board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
	person TEXT NOT NULL,
	PRIMARY KEY (board_id, person)
)`,
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
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // one connection: no lock contention, plenty for this scale
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	var version int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	for i := version; i < len(migrations); i++ {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(migrations[i]); err != nil {
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

// CreateUser adds an account. The e-mail must already be normalized.
func (s *Store) CreateUser(email, hash string) (User, error) {
	res, err := s.db.Exec("INSERT INTO users (email, hash, created_at) VALUES (?, ?, ?)", email, hash, unix(time.Now()))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return User{}, ErrEmailTaken
		}
		return User{}, err
	}
	id, _ := res.LastInsertId()
	return User{ID: id, Email: email, Hash: hash}, nil
}

// UserByEmail finds an account by (normalized) e-mail.
func (s *Store) UserByEmail(email string) (User, error) {
	var u User
	err := s.db.QueryRow("SELECT id, email, hash FROM users WHERE email = ?", email).Scan(&u.ID, &u.Email, &u.Hash)
	return u, notFound(err)
}

// CreateSession stores a session by the hash of its token.
func (s *Store) CreateSession(tokenHash string, userID int64, expires time.Time) error {
	_, err := s.db.Exec("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", tokenHash, userID, unix(expires))
	return err
}

// SessionUser returns the user of a live session, or ErrNotFound if missing or expired.
func (s *Store) SessionUser(tokenHash string, now time.Time) (User, error) {
	var u User
	err := s.db.QueryRow(`SELECT u.id, u.email, u.hash FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ?`, tokenHash, unix(now)).Scan(&u.ID, &u.Email, &u.Hash)
	return u, notFound(err)
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
	return s.boards("SELECT "+boardCols+` FROM visits v JOIN boards b ON b.id = v.board_id
		WHERE v.user_id = ? AND b.owner_id != ? ORDER BY v.last_opened DESC, b.id`, userID, userID)
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
