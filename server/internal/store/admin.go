package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode"
)

// ErrUsernameReserved is returned for the name Administrator, which only the owner of the admin
// panel may appear under on a board (R-065).
var ErrUsernameReserved = errors.New("username reserved")

// ReservedName is the name the administrator shows under on a board.
const ReservedName = "Administrator"

// IsReservedName reports whether name is the reserved name Administrator, in any letter case and
// whatever is put between the letters (spaces, dots, dashes), so it cannot be passed off by
// writing "Admin.istrator".
func IsReservedName(name string) bool {
	var b strings.Builder
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String() == strings.ToLower(ReservedName)
}

// AdminUser is one account as the admin panel lists it.
type AdminUser struct {
	ID         int64
	Email      string
	Username   string
	CreatedAt  time.Time
	Owned      int       // boards they own
	Visited    int       // boards of other people they have opened
	LastActive time.Time // the latest change on their boards, else when they signed up
	Bytes      int64     // what their boards hold: strokes and images
}

// AdminUsers lists every account with counts and sizes (R-065).
func (s *Store) AdminUsers() ([]AdminUser, error) {
	rows, err := s.db.Query(`
SELECT u.id, u.email, u.username, u.created_at,
  (SELECT COUNT(*) FROM boards b WHERE b.owner_id = u.id),
  (SELECT COUNT(*) FROM visits v JOIN boards b ON b.id = v.board_id WHERE v.user_id = u.id AND b.owner_id != u.id),
  COALESCE((SELECT MAX(b.updated_at) FROM boards b WHERE b.owner_id = u.id), u.created_at),
  COALESCE((SELECT SUM(LENGTH(st.data)) FROM strokes st JOIN boards b ON b.id = st.board_id WHERE b.owner_id = u.id), 0)
  + COALESCE((SELECT SUM(LENGTH(i.data)) FROM images i JOIN boards b ON b.id = i.board_id WHERE b.owner_id = u.id), 0)
FROM users u ORDER BY u.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AdminUser
	for rows.Next() {
		var u AdminUser
		var created, last int64
		if err := rows.Scan(&u.ID, &u.Email, &u.Username, &created, &u.Owned, &u.Visited, &last, &u.Bytes); err != nil {
			return nil, err
		}
		u.CreatedAt, u.LastActive = time.Unix(created, 0), time.Unix(last, 0)
		out = append(out, u)
	}
	return out, rows.Err()
}

// AdminBoard is one board as the admin panel lists it.
type AdminBoard struct {
	ID        string
	Name      string
	OwnerID   int64
	Owner     string // the owner's username
	CreatedAt time.Time
	UpdatedAt time.Time
	Strokes   int
	Images    int
	Bytes     int64
	Visitors  int // accounts that have opened it, the owner not counted
}

// AdminBoards lists every board with its owner, counts and size (R-065).
func (s *Store) AdminBoards() ([]AdminBoard, error) {
	rows, err := s.db.Query(`
SELECT b.id, b.name, b.owner_id, u.username, b.created_at, b.updated_at,
  (SELECT COUNT(*) FROM strokes st WHERE st.board_id = b.id),
  (SELECT COUNT(*) FROM images i WHERE i.board_id = b.id),
  COALESCE((SELECT SUM(LENGTH(st.data)) FROM strokes st WHERE st.board_id = b.id), 0)
  + COALESCE((SELECT SUM(LENGTH(i.data)) FROM images i WHERE i.board_id = b.id), 0),
  (SELECT COUNT(*) FROM visits v WHERE v.board_id = b.id AND v.user_id != b.owner_id)
FROM boards b JOIN users u ON u.id = b.owner_id ORDER BY b.updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AdminBoard
	for rows.Next() {
		var b AdminBoard
		var created, updated int64
		if err := rows.Scan(&b.ID, &b.Name, &b.OwnerID, &b.Owner, &created, &updated, &b.Strokes, &b.Images, &b.Bytes, &b.Visitors); err != nil {
			return nil, err
		}
		b.CreatedAt, b.UpdatedAt = time.Unix(created, 0), time.Unix(updated, 0)
		out = append(out, b)
	}
	return out, rows.Err()
}

// RenameUser gives an account a new username (letter case may change; the name must be free and
// not reserved). ErrNotFound for a missing account.
func (s *Store) RenameUser(id int64, username string) error {
	if IsReservedName(username) {
		return ErrUsernameReserved
	}
	res, err := s.db.Exec("UPDATE users SET username = ?, username_key = ? WHERE id = ?", username, strings.ToLower(username), id)
	if err != nil {
		if strings.Contains(err.Error(), "users.username_key") {
			return ErrUsernameTaken
		}
		return err
	}
	return s.mustAffect(res, nil)
}

// SetPassword stores a new password hash for an account. ErrNotFound for a missing account.
func (s *Store) SetPassword(id int64, hash string) error {
	return s.mustAffect(s.db.Exec("UPDATE users SET hash = ? WHERE id = ?", hash, id))
}

// DeleteUser removes an account with its sessions, visits and solely-owned boards.
// Co-owned boards survive and pass boards.owner_id to a remaining co-owner (R-122).
func (s *Store) DeleteUser(id int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE boards
		SET owner_id = (SELECT user_id FROM board_owners WHERE board_id = boards.id AND user_id != ? ORDER BY added_at ASC, user_id ASC LIMIT 1)
		WHERE owner_id = ?
		  AND EXISTS (SELECT 1 FROM board_owners WHERE board_id = boards.id AND user_id != ?)`, id, id, id); err != nil {
		return err
	}
	if err := s.mustAffect(tx.Exec("DELETE FROM users WHERE id = ?", id)); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteUserSessions logs an account out everywhere.
func (s *Store) DeleteUserSessions(id int64) error {
	_, err := s.db.Exec("DELETE FROM sessions WHERE user_id = ?", id)
	return err
}

// SetBoardOwner hands a board to another account (replacing co-owners). ErrNotFound when the board
// or the account is missing.
func (s *Store) SetBoardOwner(boardID string, userID int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var one int
	if err := tx.QueryRow("SELECT 1 FROM users WHERE id = ?", userID).Scan(&one); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if err := s.mustAffect(tx.Exec("UPDATE boards SET owner_id = ? WHERE id = ?", userID, boardID)); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM board_owners WHERE board_id = ?", boardID); err != nil {
		return err
	}
	if _, err := tx.Exec("INSERT INTO board_owners (board_id, user_id, added_at) VALUES (?, ?, ?)",
		boardID, userID, unix(time.Now().Truncate(time.Second))); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM visits WHERE user_id = ? AND board_id = ?", userID, boardID); err != nil {
		return err
	}
	return tx.Commit()
}
