package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

// ErrDuplicateName is returned when a user creates or renames a folder or marker to a name they already have.
var ErrDuplicateName = errors.New("name already exists")

const organizeSchema = `
CREATE TABLE board_folders (
	id TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	color TEXT NOT NULL DEFAULT '',
	position INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	UNIQUE(user_id, name COLLATE NOCASE)
);
CREATE INDEX board_folders_user ON board_folders(user_id);

CREATE TABLE board_markers (
	id TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	color TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	UNIQUE(user_id, name COLLATE NOCASE)
);
CREATE INDEX board_markers_user ON board_markers(user_id);

CREATE TABLE board_meta (
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
	folder_id TEXT REFERENCES board_folders(id) ON DELETE SET NULL,
	pinned INTEGER NOT NULL DEFAULT 0,
	position INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (user_id, board_id)
);
CREATE INDEX board_meta_folder ON board_meta(folder_id);

CREATE TABLE board_marker_links (
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
	marker_id TEXT NOT NULL REFERENCES board_markers(id) ON DELETE CASCADE,
	PRIMARY KEY (user_id, board_id, marker_id)
);
CREATE INDEX board_marker_links_marker ON board_marker_links(marker_id);
`

// ValidOrgColor reports whether c is an allowed folder or marker color token.
func ValidOrgColor(c string) bool {
	switch c {
	case "", "indigo", "emerald", "amber", "rose", "sky", "violet", "slate":
		return true
	}
	return false
}

// Folder is a personal folder a user puts boards into on their panel.
type Folder struct {
	ID        string
	UserID    int64
	Name      string
	Color     string
	Position  int
	CreatedAt time.Time
}

// Marker is a personal colored tag a user attaches to boards on their panel.
type Marker struct {
	ID        string
	UserID    int64
	Name      string
	Color     string
	CreatedAt time.Time
}

// BoardMeta holds one user's organization state for one board.
type BoardMeta struct {
	BoardID   string
	FolderID  string
	Pinned    bool
	Position  int
	MarkerIDs []string
}

// BoardMetaPatch updates only the non-nil fields of a user's metadata for one board.
// An empty *FolderID clears the folder assignment.
type BoardMetaPatch struct {
	FolderID  *string
	Pinned    *bool
	Position  *int
	MarkerIDs *[]string
}

// BulkOrganizePatch applies organization changes to multiple boards in one transaction.
type BulkOrganizePatch struct {
	BoardIDs        []string
	FolderID        *string
	Pinned          *bool
	AddMarkerIDs    []string
	RemoveMarkerIDs []string
}

func uniqueErr(err error) error {
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrDuplicateName
	}
	return err
}

// CreateFolder adds a personal folder at the end of the user's folder list.
func (s *Store) CreateFolder(id string, userID int64, name, color string) (Folder, error) {
	now := time.Now().Truncate(time.Second)
	var pos int
	if err := s.db.QueryRow("SELECT COALESCE(MAX(position), -1) + 1 FROM board_folders WHERE user_id = ?", userID).Scan(&pos); err != nil {
		return Folder{}, err
	}
	_, err := s.db.Exec(
		"INSERT INTO board_folders (id, user_id, name, color, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		id, userID, name, color, pos, unix(now),
	)
	if err != nil {
		return Folder{}, uniqueErr(err)
	}
	return Folder{ID: id, UserID: userID, Name: name, Color: color, Position: pos, CreatedAt: now}, nil
}

// ListFolders returns all folders owned by userID in their display order.
func (s *Store) ListFolders(userID int64) ([]Folder, error) {
	rows, err := s.db.Query(
		"SELECT id, user_id, name, color, position, created_at FROM board_folders WHERE user_id = ? ORDER BY position ASC, created_at ASC, id ASC",
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Folder
	for rows.Next() {
		var f Folder
		var created int64
		if err := rows.Scan(&f.ID, &f.UserID, &f.Name, &f.Color, &f.Position, &created); err != nil {
			return nil, err
		}
		f.CreatedAt = time.Unix(created, 0)
		out = append(out, f)
	}
	return out, rows.Err()
}

// UpdateFolder changes a folder's name, color, or position for userID.
func (s *Store) UpdateFolder(userID int64, id string, name, color *string, position *int) (Folder, error) {
	var f Folder
	var created int64
	err := s.db.QueryRow(
		"SELECT id, user_id, name, color, position, created_at FROM board_folders WHERE id = ? AND user_id = ?",
		id, userID,
	).Scan(&f.ID, &f.UserID, &f.Name, &f.Color, &f.Position, &created)
	if err != nil {
		return Folder{}, notFound(err)
	}
	f.CreatedAt = time.Unix(created, 0)
	if name != nil {
		f.Name = *name
	}
	if color != nil {
		f.Color = *color
	}
	if position != nil {
		f.Position = *position
	}
	_, err = s.db.Exec(
		"UPDATE board_folders SET name = ?, color = ?, position = ? WHERE id = ? AND user_id = ?",
		f.Name, f.Color, f.Position, id, userID,
	)
	if err != nil {
		return Folder{}, uniqueErr(err)
	}
	return f, nil
}

// DeleteFolder removes a folder owned by userID; boards inside become unfiled.
func (s *Store) DeleteFolder(userID int64, id string) error {
	return s.mustAffect(s.db.Exec("DELETE FROM board_folders WHERE id = ? AND user_id = ?", id, userID))
}

// HasFolder reports whether folder id exists and belongs to userID.
func (s *Store) HasFolder(userID int64, id string) (bool, error) {
	var one int
	err := s.db.QueryRow("SELECT 1 FROM board_folders WHERE id = ? AND user_id = ?", id, userID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// CreateMarker adds a personal marker for userID.
func (s *Store) CreateMarker(id string, userID int64, name, color string) (Marker, error) {
	now := time.Now().Truncate(time.Second)
	_, err := s.db.Exec(
		"INSERT INTO board_markers (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)",
		id, userID, name, color, unix(now),
	)
	if err != nil {
		return Marker{}, uniqueErr(err)
	}
	return Marker{ID: id, UserID: userID, Name: name, Color: color, CreatedAt: now}, nil
}

// ListMarkers returns all markers owned by userID.
func (s *Store) ListMarkers(userID int64) ([]Marker, error) {
	rows, err := s.db.Query(
		"SELECT id, user_id, name, color, created_at FROM board_markers WHERE user_id = ? ORDER BY created_at ASC, id ASC",
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Marker
	for rows.Next() {
		var m Marker
		var created int64
		if err := rows.Scan(&m.ID, &m.UserID, &m.Name, &m.Color, &created); err != nil {
			return nil, err
		}
		m.CreatedAt = time.Unix(created, 0)
		out = append(out, m)
	}
	return out, rows.Err()
}

// UpdateMarker changes a marker's name or color for userID.
func (s *Store) UpdateMarker(userID int64, id string, name, color *string) (Marker, error) {
	var m Marker
	var created int64
	err := s.db.QueryRow(
		"SELECT id, user_id, name, color, created_at FROM board_markers WHERE id = ? AND user_id = ?",
		id, userID,
	).Scan(&m.ID, &m.UserID, &m.Name, &m.Color, &created)
	if err != nil {
		return Marker{}, notFound(err)
	}
	m.CreatedAt = time.Unix(created, 0)
	if name != nil {
		m.Name = *name
	}
	if color != nil {
		m.Color = *color
	}
	_, err = s.db.Exec(
		"UPDATE board_markers SET name = ?, color = ? WHERE id = ? AND user_id = ?",
		m.Name, m.Color, id, userID,
	)
	if err != nil {
		return Marker{}, uniqueErr(err)
	}
	return m, nil
}

// DeleteMarker removes a marker owned by userID and unlinks it from all boards.
func (s *Store) DeleteMarker(userID int64, id string) error {
	return s.mustAffect(s.db.Exec("DELETE FROM board_markers WHERE id = ? AND user_id = ?", id, userID))
}

// BoardMetaMap loads all per-user board metadata and marker links for userID.
func (s *Store) BoardMetaMap(userID int64) (map[string]BoardMeta, error) {
	out := map[string]BoardMeta{}
	rows, err := s.db.Query(
		"SELECT board_id, COALESCE(folder_id, ''), pinned, position FROM board_meta WHERE user_id = ?",
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m BoardMeta
		var pinned int
		if err := rows.Scan(&m.BoardID, &m.FolderID, &pinned, &m.Position); err != nil {
			return nil, err
		}
		m.Pinned = pinned != 0
		out[m.BoardID] = m
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	mrows, err := s.db.Query(
		`SELECT l.board_id, l.marker_id FROM board_marker_links l
		JOIN board_markers m ON m.id = l.marker_id
		WHERE l.user_id = ? ORDER BY m.created_at ASC, m.id ASC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer mrows.Close()
	for mrows.Next() {
		var boardID, markerID string
		if err := mrows.Scan(&boardID, &markerID); err != nil {
			return nil, err
		}
		m := out[boardID]
		m.BoardID = boardID
		m.MarkerIDs = append(m.MarkerIDs, markerID)
		out[boardID] = m
	}
	return out, mrows.Err()
}

func checkBoardExistsTx(tx *sql.Tx, boardID string) error {
	var one int
	return notFound(tx.QueryRow("SELECT 1 FROM boards WHERE id = ?", boardID).Scan(&one))
}

func checkFolderOwnedTx(tx *sql.Tx, userID int64, folderID string) error {
	if folderID == "" {
		return nil
	}
	var one int
	return notFound(tx.QueryRow("SELECT 1 FROM board_folders WHERE id = ? AND user_id = ?", folderID, userID).Scan(&one))
}

func checkMarkerOwnedTx(tx *sql.Tx, userID int64, markerID string) error {
	var one int
	return notFound(tx.QueryRow("SELECT 1 FROM board_markers WHERE id = ? AND user_id = ?", markerID, userID).Scan(&one))
}

func upsertMetaTx(tx *sql.Tx, userID int64, boardID string, folderID *string, pinned *bool, position *int) error {
	var curFolder sql.NullString
	var curPinned int
	var curPos int
	err := tx.QueryRow(
		"SELECT folder_id, pinned, position FROM board_meta WHERE user_id = ? AND board_id = ?",
		userID, boardID,
	).Scan(&curFolder, &curPinned, &curPos)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if folderID != nil {
		if *folderID == "" {
			curFolder = sql.NullString{}
		} else {
			curFolder = sql.NullString{String: *folderID, Valid: true}
		}
	}
	if pinned != nil {
		if *pinned {
			curPinned = 1
		} else {
			curPinned = 0
		}
	}
	if position != nil {
		curPos = *position
	}
	_, err = tx.Exec(
		`INSERT INTO board_meta (user_id, board_id, folder_id, pinned, position) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, board_id) DO UPDATE SET folder_id = excluded.folder_id, pinned = excluded.pinned, position = excluded.position`,
		userID, boardID, curFolder, curPinned, curPos,
	)
	return err
}

// UpdateBoardMeta updates one user's folder, pin, custom position, and/or markers for a board.
func (s *Store) UpdateBoardMeta(userID int64, boardID string, p BoardMetaPatch) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := checkBoardExistsTx(tx, boardID); err != nil {
		return err
	}
	if p.FolderID != nil {
		if err := checkFolderOwnedTx(tx, userID, *p.FolderID); err != nil {
			return err
		}
	}
	if p.MarkerIDs != nil {
		for _, mid := range *p.MarkerIDs {
			if err := checkMarkerOwnedTx(tx, userID, mid); err != nil {
				return err
			}
		}
	}

	if p.FolderID != nil || p.Pinned != nil || p.Position != nil {
		if err := upsertMetaTx(tx, userID, boardID, p.FolderID, p.Pinned, p.Position); err != nil {
			return err
		}
	}
	if p.MarkerIDs != nil {
		if _, err := tx.Exec("DELETE FROM board_marker_links WHERE user_id = ? AND board_id = ?", userID, boardID); err != nil {
			return err
		}
		for _, mid := range *p.MarkerIDs {
			if _, err := tx.Exec(
				"INSERT OR IGNORE INTO board_marker_links (user_id, board_id, marker_id) VALUES (?, ?, ?)",
				userID, boardID, mid,
			); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

// BulkOrganize updates folder, pin, or marker links across multiple boards in one transaction.
func (s *Store) BulkOrganize(userID int64, p BulkOrganizePatch) error {
	if len(p.BoardIDs) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if p.FolderID != nil {
		if err := checkFolderOwnedTx(tx, userID, *p.FolderID); err != nil {
			return err
		}
	}
	for _, mid := range p.AddMarkerIDs {
		if err := checkMarkerOwnedTx(tx, userID, mid); err != nil {
			return err
		}
	}
	for _, mid := range p.RemoveMarkerIDs {
		if err := checkMarkerOwnedTx(tx, userID, mid); err != nil {
			return err
		}
	}

	for _, boardID := range p.BoardIDs {
		if err := checkBoardExistsTx(tx, boardID); err != nil {
			return err
		}
		if p.FolderID != nil || p.Pinned != nil {
			if err := upsertMetaTx(tx, userID, boardID, p.FolderID, p.Pinned, nil); err != nil {
				return err
			}
		}
		for _, mid := range p.AddMarkerIDs {
			if _, err := tx.Exec(
				"INSERT OR IGNORE INTO board_marker_links (user_id, board_id, marker_id) VALUES (?, ?, ?)",
				userID, boardID, mid,
			); err != nil {
				return err
			}
		}
		for _, mid := range p.RemoveMarkerIDs {
			if _, err := tx.Exec(
				"DELETE FROM board_marker_links WHERE user_id = ? AND board_id = ? AND marker_id = ?",
				userID, boardID, mid,
			); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

// SetBoardOrder assigns sequential 1-based custom positions for the given board IDs for userID.
func (s *Store) SetBoardOrder(userID int64, boardIDs []string) error {
	if len(boardIDs) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for i, boardID := range boardIDs {
		if err := checkBoardExistsTx(tx, boardID); err != nil {
			return err
		}
		pos := i + 1
		if err := upsertMetaTx(tx, userID, boardID, nil, nil, &pos); err != nil {
			return err
		}
	}
	return tx.Commit()
}
