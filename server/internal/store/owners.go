package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

// Multi-owner boards and ownership transfer (R-122).
const ownersSchema = `
CREATE TABLE board_owners (
	board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
	user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	added_at INTEGER NOT NULL,
	PRIMARY KEY (board_id, user_id)
);
CREATE INDEX board_owners_user ON board_owners(user_id);
INSERT OR IGNORE INTO board_owners (board_id, user_id, added_at)
SELECT id, owner_id, created_at FROM boards;
`

var (
	// ErrAlreadyOwner means the user is already an owner (or the sole owner) of the board.
	ErrAlreadyOwner = errors.New("already an owner")
	// ErrLastOwner means removing the requested owner would leave the board ownerless.
	ErrLastOwner = errors.New("cannot remove the last owner")
	// ErrForbidden means the caller is not allowed to act on one of the target boards.
	ErrForbidden = errors.New("forbidden")
)

// BoardOwner is one account with full ownership rights on a board.
type BoardOwner struct {
	UserID   int64
	Username string
	Avatar   string
	AddedAt  time.Time
}

// IsBoardOwner reports whether userID is an owner of boardID.
func (s *Store) IsBoardOwner(boardID string, userID int64) (bool, error) {
	var one int
	err := s.db.QueryRow("SELECT 1 FROM board_owners WHERE board_id = ? AND user_id = ?", boardID, userID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// ListBoardOwners returns all owners of a board ordered from earliest added to newest.
func (s *Store) ListBoardOwners(boardID string) ([]BoardOwner, error) {
	rows, err := s.db.Query(`SELECT u.id, u.username, u.avatar, bo.added_at
		FROM board_owners bo
		JOIN users u ON u.id = bo.user_id
		WHERE bo.board_id = ?
		ORDER BY bo.added_at ASC, bo.user_id ASC`, boardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BoardOwner
	for rows.Next() {
		var o BoardOwner
		var added int64
		if err := rows.Scan(&o.UserID, &o.Username, &o.Avatar, &added); err != nil {
			return nil, err
		}
		o.AddedAt = time.Unix(added, 0)
		out = append(out, o)
	}
	return out, rows.Err()
}

// BoardOwnersMap returns owner usernames per board for the given board IDs.
func (s *Store) BoardOwnersMap(boardIDs []string) (map[string][]string, error) {
	out := map[string][]string{}
	if len(boardIDs) == 0 {
		return out, nil
	}
	placeholders := make([]string, len(boardIDs))
	args := make([]any, len(boardIDs))
	for i, id := range boardIDs {
		placeholders[i] = "?"
		args[i] = id
	}
	rows, err := s.db.Query(`SELECT bo.board_id, u.username
		FROM board_owners bo
		JOIN users u ON u.id = bo.user_id
		WHERE bo.board_id IN (`+strings.Join(placeholders, ",")+`)
		ORDER BY bo.added_at ASC, bo.user_id ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var bid, uname string
		if err := rows.Scan(&bid, &uname); err != nil {
			return nil, err
		}
		out[bid] = append(out[bid], uname)
	}
	return out, rows.Err()
}

// BoardsSolelyOwnedBy lists boards where userID is the only owner (used before deleting an account
// so live rooms are shut down only for boards that will actually be deleted).
func (s *Store) BoardsSolelyOwnedBy(userID int64) ([]Board, error) {
	return s.listBoards("SELECT "+boardCols+", "+sizeCol+`, ''
		FROM board_owners bo
		JOIN boards b ON b.id = bo.board_id
		WHERE bo.user_id = ?
		  AND NOT EXISTS (SELECT 1 FROM board_owners other WHERE other.board_id = b.id AND other.user_id != ?)
		ORDER BY b.updated_at DESC, b.id`, userID, userID)
}

// AddBoardOwner grants userID equal ownership of boardID and clears any visit record for them.
func (s *Store) AddBoardOwner(boardID string, userID int64, at time.Time) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var one int
	if err := tx.QueryRow("SELECT 1 FROM boards WHERE id = ?", boardID).Scan(&one); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if err := tx.QueryRow("SELECT 1 FROM users WHERE id = ?", userID).Scan(&one); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if err := tx.QueryRow("SELECT 1 FROM board_owners WHERE board_id = ? AND user_id = ?", boardID, userID).Scan(&one); err == nil {
		return ErrAlreadyOwner
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	if _, err := tx.Exec("INSERT INTO board_owners (board_id, user_id, added_at) VALUES (?, ?, ?)",
		boardID, userID, unix(at)); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM visits WHERE user_id = ? AND board_id = ?", userID, boardID); err != nil {
		return err
	}
	return tx.Commit()
}

// RemoveBoardOwner revokes userID's ownership of boardID, repointing boards.owner_id if needed,
// and records a visit so the former owner keeps quick access under visited boards.
func (s *Store) RemoveBoardOwner(boardID string, userID int64, at time.Time) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var one int
	if err := tx.QueryRow("SELECT 1 FROM board_owners WHERE board_id = ? AND user_id = ?", boardID, userID).Scan(&one); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	var count int
	if err := tx.QueryRow("SELECT COUNT(*) FROM board_owners WHERE board_id = ?", boardID).Scan(&count); err != nil {
		return err
	}
	if count <= 1 {
		return ErrLastOwner
	}

	if _, err := tx.Exec("DELETE FROM board_owners WHERE board_id = ? AND user_id = ?", boardID, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE boards
		SET owner_id = (SELECT user_id FROM board_owners WHERE board_id = ? ORDER BY added_at ASC, user_id ASC LIMIT 1)
		WHERE id = ? AND owner_id = ?`, boardID, boardID, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO visits (user_id, board_id, last_opened) VALUES (?, ?, ?)
		ON CONFLICT (user_id, board_id) DO UPDATE SET last_opened = excluded.last_opened`,
		userID, boardID, unix(at)); err != nil {
		return err
	}
	return tx.Commit()
}

// TransferBoardOwnership hands sole ownership of boardID to toUserID and records a visit for every
// former owner so the board moves into their visited list.
func (s *Store) TransferBoardOwnership(boardID string, toUserID int64, at time.Time) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := transferOneTx(tx, boardID, toUserID, at); err != nil {
		return err
	}
	return tx.Commit()
}

// TransferBoardsOwnership atomically transfers multiple boards owned by callerID to toUserID.
func (s *Store) TransferBoardsOwnership(boardIDs []string, callerID, toUserID int64, at time.Time) error {
	if len(boardIDs) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var one int
	if err := tx.QueryRow("SELECT 1 FROM users WHERE id = ?", toUserID).Scan(&one); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}

	seen := map[string]bool{}
	for _, bid := range boardIDs {
		if bid == "" || seen[bid] {
			continue
		}
		seen[bid] = true
		if err := tx.QueryRow("SELECT 1 FROM board_owners WHERE board_id = ? AND user_id = ?", bid, callerID).Scan(&one); errors.Is(err, sql.ErrNoRows) {
			return ErrForbidden
		} else if err != nil {
			return err
		}
		if err := transferOneTx(tx, bid, toUserID, at); err != nil {
			if errors.Is(err, ErrAlreadyOwner) {
				continue // skip boards already solely owned by the recipient in bulk transfers
			}
			return err
		}
	}
	return tx.Commit()
}

func transferOneTx(tx *sql.Tx, boardID string, toUserID int64, at time.Time) error {
	var one int
	if err := tx.QueryRow("SELECT 1 FROM boards WHERE id = ?", boardID).Scan(&one); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if err := tx.QueryRow("SELECT 1 FROM users WHERE id = ?", toUserID).Scan(&one); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}

	// Collect current owners to record visits for everyone who is losing ownership.
	rows, err := tx.Query("SELECT user_id FROM board_owners WHERE board_id = ?", boardID)
	if err != nil {
		return err
	}
	var prev []int64
	for rows.Next() {
		var uid int64
		if err := rows.Scan(&uid); err != nil {
			rows.Close()
			return err
		}
		prev = append(prev, uid)
	}
	rows.Close()
	if len(prev) == 1 && prev[0] == toUserID {
		return ErrAlreadyOwner
	}

	if _, err := tx.Exec("UPDATE boards SET owner_id = ? WHERE id = ?", toUserID, boardID); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM board_owners WHERE board_id = ?", boardID); err != nil {
		return err
	}
	if _, err := tx.Exec("INSERT INTO board_owners (board_id, user_id, added_at) VALUES (?, ?, ?)",
		boardID, toUserID, unix(at)); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM visits WHERE user_id = ? AND board_id = ?", toUserID, boardID); err != nil {
		return err
	}
	ts := unix(at)
	for _, uid := range prev {
		if uid == toUserID {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO visits (user_id, board_id, last_opened) VALUES (?, ?, ?)
			ON CONFLICT (user_id, board_id) DO UPDATE SET last_opened = excluded.last_opened`,
			uid, boardID, ts); err != nil {
			return err
		}
	}
	return nil
}
