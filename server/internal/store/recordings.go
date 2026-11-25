package store

import "time"

// Lesson recordings, stage 1 (R-112): the video file is kept on the app server's disk, the table
// only describes it.
const recordingsSchema = `
CREATE TABLE recordings (
	id TEXT PRIMARY KEY,
	board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
	user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
	name TEXT NOT NULL,
	mime TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	duration_ms INTEGER NOT NULL DEFAULT 0,
	bytes INTEGER NOT NULL DEFAULT 0,
	finished INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX recordings_board ON recordings(board_id, created_at)`

// Recording describes one recording of a lesson.
type Recording struct {
	ID         string
	BoardID    string
	UserID     int64 // who records; 0 once that account is gone
	Name       string
	Mime       string
	CreatedAt  time.Time
	DurationMs int64
	Bytes      int64
	Finished   bool
}

const recordingCols = "id, board_id, COALESCE(user_id, 0), name, mime, created_at, duration_ms, bytes, finished"

func scanRecording(row scanner) (Recording, error) {
	var r Recording
	var created int64
	err := row.Scan(&r.ID, &r.BoardID, &r.UserID, &r.Name, &r.Mime, &created, &r.DurationMs, &r.Bytes, &r.Finished)
	r.CreatedAt = time.Unix(created, 0)
	return r, err
}

// CreateRecording adds a recording that has no bytes yet.
func (s *Store) CreateRecording(r Recording) error {
	_, err := s.db.Exec(`INSERT INTO recordings (id, board_id, user_id, name, mime, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		r.ID, r.BoardID, r.UserID, r.Name, r.Mime, r.CreatedAt.Unix())
	return err
}

// Recording finds a recording of the board. ErrNotFound for a missing one or one of another board.
func (s *Store) Recording(boardID, id string) (Recording, error) {
	r, err := scanRecording(s.db.QueryRow("SELECT "+recordingCols+" FROM recordings WHERE board_id = ? AND id = ?", boardID, id))
	return r, notFound(err)
}

// RecordingsOf lists the recordings of a board, newest first.
func (s *Store) RecordingsOf(boardID string) ([]Recording, error) {
	rows, err := s.db.Query("SELECT "+recordingCols+" FROM recordings WHERE board_id = ? ORDER BY created_at DESC, id", boardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Recording
	for rows.Next() {
		r, err := scanRecording(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// SetRecordingBytes records how much of the file has arrived.
func (s *Store) SetRecordingBytes(id string, bytes int64) error {
	return s.mustAffect(s.db.Exec("UPDATE recordings SET bytes = ? WHERE id = ?", bytes, id))
}

// FinishRecording closes a recording with its length and final size.
func (s *Store) FinishRecording(id string, durationMs, bytes int64) error {
	return s.mustAffect(s.db.Exec("UPDATE recordings SET finished = 1, duration_ms = ?, bytes = ? WHERE id = ?", durationMs, bytes, id))
}
