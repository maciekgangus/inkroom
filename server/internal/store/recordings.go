package store

import "time"

// Lesson recordings (R-094, R-112): the video is kept in a bucket or on disk (see recstore); the
// table only describes it.
const recordingsSchema = `
CREATE TABLE recordings (
	id TEXT PRIMARY KEY,
	board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
	user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
	name TEXT NOT NULL,
	mime TEXT NOT NULL,
	storage TEXT NOT NULL,
	upload_id TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	duration_ms INTEGER NOT NULL DEFAULT 0,
	bytes INTEGER NOT NULL DEFAULT 0,
	finished INTEGER NOT NULL DEFAULT 0,
	segments INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX recordings_board ON recordings(board_id, created_at)`

// Recording describes one recording of a lesson.
type Recording struct {
	ID      string
	BoardID string
	UserID  int64 // who records; 0 once that account is gone
	Name    string
	Mime    string
	// Storage names where the video is kept ("s3" or "disk") and UploadID the unfinished upload
	// there; both stay with the recording, so a changed setting does not lose old ones.
	Storage    string
	UploadID   string
	CreatedAt  time.Time
	UpdatedAt  time.Time // the last sign of life of the upload
	DurationMs int64
	Bytes      int64
	Finished   bool
	// Segments is the highest number of a segment of the event log that was asked for (R-113).
	Segments int
}

const recordingCols = "id, board_id, COALESCE(user_id, 0), name, mime, storage, upload_id, created_at, updated_at, duration_ms, bytes, finished, segments"

func scanRecording(row scanner) (Recording, error) {
	var r Recording
	var created, updated int64
	err := row.Scan(&r.ID, &r.BoardID, &r.UserID, &r.Name, &r.Mime, &r.Storage, &r.UploadID, &created, &updated, &r.DurationMs, &r.Bytes, &r.Finished, &r.Segments)
	r.CreatedAt, r.UpdatedAt = time.Unix(created, 0), time.Unix(updated, 0)
	return r, err
}

// CreateRecording adds a recording that has no bytes yet.
func (s *Store) CreateRecording(r Recording) error {
	if r.UpdatedAt.IsZero() {
		r.UpdatedAt = r.CreatedAt
	}
	var user any // NULL for a recording without an account (tests)
	if r.UserID != 0 {
		user = r.UserID
	}
	_, err := s.db.Exec(`INSERT INTO recordings (id, board_id, user_id, name, mime, storage, upload_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.BoardID, user, r.Name, r.Mime, r.Storage, r.UploadID, r.CreatedAt.Unix(), r.UpdatedAt.Unix())
	return err
}

// Recording finds a recording of the board. ErrNotFound for a missing one or one of another board.
func (s *Store) Recording(boardID, id string) (Recording, error) {
	r, err := scanRecording(s.db.QueryRow("SELECT "+recordingCols+" FROM recordings WHERE board_id = ? AND id = ?", boardID, id))
	return r, notFound(err)
}

// RecordingsOf lists the recordings of a board, newest first.
func (s *Store) RecordingsOf(boardID string) ([]Recording, error) {
	return s.listRecordings("SELECT "+recordingCols+" FROM recordings WHERE board_id = ? ORDER BY created_at DESC, id", boardID)
}

// IdleRecordings lists the unfinished recordings nothing was heard of since `before`: the tab was
// closed or the network lost, and somebody must finish them.
func (s *Store) IdleRecordings(before time.Time) ([]Recording, error) {
	return s.listRecordings("SELECT "+recordingCols+" FROM recordings WHERE finished = 0 AND updated_at < ? ORDER BY created_at", before.Unix())
}

func (s *Store) listRecordings(query string, args ...any) ([]Recording, error) {
	rows, err := s.db.Query(query, args...)
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

// TouchRecording notes that the upload is alive.
func (s *Store) TouchRecording(id string, now time.Time) error {
	return s.mustAffect(s.db.Exec("UPDATE recordings SET updated_at = ? WHERE id = ?", now.Unix(), id))
}

// NoteSegment records that segment n of the event log is being sent, so a recording that is
// never finished by its owner still knows how many segments there may be to play.
func (s *Store) NoteSegment(id string, n int) error {
	return s.mustAffect(s.db.Exec("UPDATE recordings SET segments = MAX(segments, ?) WHERE id = ?", n, id))
}

// FinishRecording closes a recording with its length and final size.
func (s *Store) FinishRecording(id string, durationMs, bytes int64) error {
	return s.mustAffect(s.db.Exec("UPDATE recordings SET finished = 1, duration_ms = ?, bytes = ? WHERE id = ?", durationMs, bytes, id))
}

// DeleteRecording removes the description of a recording.
func (s *Store) DeleteRecording(id string) error {
	return s.mustAffect(s.db.Exec("DELETE FROM recordings WHERE id = ?", id))
}
