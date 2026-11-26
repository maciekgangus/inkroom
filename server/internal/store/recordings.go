package store

import (
	"database/sql"
	"errors"
	"time"
)

// Lesson recordings (R-094, R-117): the video is kept in a bucket or on disk (see recstore); the
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

// addRecordingVideo adds what the server knows about the video rendered from a recording (R-115).
func addRecordingVideo(tx *sql.Tx) error {
	for _, q := range []string{
		"ALTER TABLE recordings ADD COLUMN video_state TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE recordings ADD COLUMN video_progress INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE recordings ADD COLUMN video_bytes INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE recordings ADD COLUMN video_attempts INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE recordings ADD COLUMN video_at INTEGER NOT NULL DEFAULT 0",
	} {
		if _, err := tx.Exec(q); err != nil {
			return err
		}
	}
	return nil
}

// The states of the video that is rendered from a recording on the server (R-115, ADR 0029).
const (
	VideoNone      = ""          // nobody renders (no renderer is set up) or the recording is not finished
	VideoQueued    = "queued"    // waits for the renderer
	VideoRendering = "rendering" // the renderer works on it
	VideoReady     = "ready"     // <id>/video.mp4 is in the store
	VideoFailed    = "failed"    // the renderer gave up
)

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
	// The video rendered on the server: its state, how far it is (percent), its size once ready,
	// how many times the renderer took it, and the last sign of life of the renderer.
	Video         string
	VideoProgress int
	VideoBytes    int64
	VideoAttempts int
	VideoAt       time.Time
}

const recordingCols = "id, board_id, COALESCE(user_id, 0), name, mime, storage, upload_id, created_at, updated_at, duration_ms, bytes, finished, segments, video_state, video_progress, video_bytes, video_attempts, video_at"

func scanRecording(row scanner) (Recording, error) {
	var r Recording
	var created, updated, videoAt int64
	err := row.Scan(&r.ID, &r.BoardID, &r.UserID, &r.Name, &r.Mime, &r.Storage, &r.UploadID, &created, &updated, &r.DurationMs, &r.Bytes, &r.Finished, &r.Segments,
		&r.Video, &r.VideoProgress, &r.VideoBytes, &r.VideoAttempts, &videoAt)
	r.CreatedAt, r.UpdatedAt, r.VideoAt = time.Unix(created, 0), time.Unix(updated, 0), time.Unix(videoAt, 0)
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

// RecordingExists tells whether a recording with this id exists on any board.
func (s *Store) RecordingExists(id string) (bool, error) {
	var n int
	err := s.db.QueryRow("SELECT 1 FROM recordings WHERE id = ?", id).Scan(&n)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
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

// RenameRecording gives a recording a new name.
func (s *Store) RenameRecording(id, name string) error {
	return s.mustAffect(s.db.Exec("UPDATE recordings SET name = ? WHERE id = ?", name, id))
}

// DeleteRecording removes the description of a recording.
func (s *Store) DeleteRecording(id string) error {
	return s.mustAffect(s.db.Exec("DELETE FROM recordings WHERE id = ?", id))
}

// QueueVideo puts the video of a finished recording in the queue of the renderer; a recording
// that has a video or one in the queue is left alone.
func (s *Store) QueueVideo(id string) error {
	_, err := s.db.Exec("UPDATE recordings SET video_state = ? WHERE id = ? AND finished = 1 AND video_state = ?", VideoQueued, id, VideoNone)
	return err
}

// ClaimVideo hands the oldest queued recording to a renderer; ok is false when none waits.
func (s *Store) ClaimVideo(now time.Time) (rec Recording, ok bool, err error) {
	rec, err = scanRecording(s.db.QueryRow(`UPDATE recordings SET video_state = ?, video_attempts = video_attempts + 1, video_progress = 0, video_at = ?
		WHERE id = (SELECT id FROM recordings WHERE video_state = ? ORDER BY created_at, id LIMIT 1)
		RETURNING `+recordingCols, VideoRendering, now.Unix(), VideoQueued))
	if errors.Is(err, sql.ErrNoRows) {
		return Recording{}, false, nil
	}
	return rec, err == nil, err
}

// NoteVideoProgress records how far (percent) the renderer is, and that it is alive.
func (s *Store) NoteVideoProgress(id string, percent int, now time.Time) error {
	percent = min(max(percent, 0), 100)
	return s.mustAffect(s.db.Exec("UPDATE recordings SET video_progress = ?, video_at = ? WHERE id = ? AND video_state = ?",
		percent, now.Unix(), id, VideoRendering))
}

// FinishVideo marks the video as ready, with its size.
func (s *Store) FinishVideo(id string, bytes int64) error {
	return s.mustAffect(s.db.Exec("UPDATE recordings SET video_state = ?, video_progress = 100, video_bytes = ? WHERE id = ? AND video_state = ?",
		VideoReady, bytes, id, VideoRendering))
}

// FailVideo returns the recording to the queue, or marks it failed when the renderer already
// took it maxAttempts times.
func (s *Store) FailVideo(id string, maxAttempts int) error {
	return s.mustAffect(s.db.Exec(`UPDATE recordings SET video_state = CASE WHEN video_attempts >= ? THEN ? ELSE ? END
		WHERE id = ? AND video_state = ?`, maxAttempts, VideoFailed, VideoQueued, id, VideoRendering))
}

// RequeueStaleVideos treats the renderings nothing was heard of since `before` as failed (the
// renderer died); it returns how many there were.
func (s *Store) RequeueStaleVideos(before time.Time, maxAttempts int) (int64, error) {
	res, err := s.db.Exec(`UPDATE recordings SET video_state = CASE WHEN video_attempts >= ? THEN ? ELSE ? END
		WHERE video_state = ? AND video_at < ?`, maxAttempts, VideoFailed, VideoQueued, VideoRendering, before.Unix())
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// QueueMissingVideos queues every finished recording that has no video yet (for the recordings
// made before a renderer was set up); it returns how many there were.
func (s *Store) QueueMissingVideos() (int64, error) {
	res, err := s.db.Exec("UPDATE recordings SET video_state = ? WHERE finished = 1 AND video_state = ?", VideoQueued, VideoNone)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
