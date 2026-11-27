package store

import (
	"encoding/json"
	"time"
)

// Status of an AI analysis job (R-124, ADR 0034).
const (
	AIRunning = "running"
	AIDone    = "done"
	AIFailed  = "failed"
)

const aiSchema = `
CREATE TABLE ai_jobs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
	status TEXT NOT NULL,
	model TEXT NOT NULL DEFAULT '',
	error TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	finished_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ai_jobs_board ON ai_jobs(board_id);
CREATE TABLE ai_segments (
	job_id INTEGER NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
	seq INTEGER NOT NULL,
	id TEXT NOT NULL,
	element_ids TEXT NOT NULL,
	min_x REAL NOT NULL,
	min_y REAL NOT NULL,
	max_x REAL NOT NULL,
	max_y REAL NOT NULL,
	latex TEXT NOT NULL DEFAULT '',
	verbatim INTEGER NOT NULL DEFAULT 0,
	error TEXT NOT NULL DEFAULT '',
	PRIMARY KEY (job_id, seq)
);
`

// AIJob is one analysis of a board; a board keeps only its latest one.
type AIJob struct {
	ID         int64
	BoardID    string
	Status     string
	Model      string
	Error      string
	CreatedAt  time.Time
	FinishedAt time.Time // zero while running
	Segments   []AISegment
}

// AISegment is one recognized group of board elements, in the order segmentsvc gave.
type AISegment struct {
	ID                     string
	ElementIDs             []string
	MinX, MinY, MaxX, MaxY float64
	Latex                  string
	Verbatim               bool
	Error                  string
}

// StartAIJob creates a running job for a board and drops the board's older jobs. ErrConflict
// when a job of the board is still running.
func (s *Store) StartAIJob(boardID string, at time.Time) (int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var running int
	if err := tx.QueryRow("SELECT COUNT(*) FROM ai_jobs WHERE board_id = ? AND status = ?", boardID, AIRunning).Scan(&running); err != nil {
		return 0, err
	}
	if running > 0 {
		return 0, ErrConflict
	}
	if _, err := tx.Exec("DELETE FROM ai_jobs WHERE board_id = ?", boardID); err != nil {
		return 0, err
	}
	res, err := tx.Exec("INSERT INTO ai_jobs (board_id, status, created_at) VALUES (?, ?, ?)", boardID, AIRunning, unix(at))
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	return id, tx.Commit()
}

// FinishAIJob stores a job's segments and marks it done.
func (s *Store) FinishAIJob(id int64, model string, segs []AISegment, at time.Time) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, g := range segs {
		ids, err := json.Marshal(g.ElementIDs)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO ai_segments (job_id, seq, id, element_ids, min_x, min_y, max_x, max_y, latex, verbatim, error)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, i, g.ID, string(ids), g.MinX, g.MinY, g.MaxX, g.MaxY, g.Latex, g.Verbatim, g.Error); err != nil {
			return err
		}
	}
	res, err := tx.Exec("UPDATE ai_jobs SET status = ?, model = ?, finished_at = ? WHERE id = ?", AIDone, model, unix(at), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// FailAIJob marks a job failed with a message for the user.
func (s *Store) FailAIJob(id int64, msg string, at time.Time) error {
	_, err := s.db.Exec("UPDATE ai_jobs SET status = ?, error = ?, finished_at = ? WHERE id = ?", AIFailed, msg, unix(at), id)
	return err
}

// FailRunningAIJobs marks every running job failed; a job cannot outlive the server process.
func (s *Store) FailRunningAIJobs(msg string, at time.Time) error {
	_, err := s.db.Exec("UPDATE ai_jobs SET status = ?, error = ?, finished_at = ? WHERE status = ?", AIFailed, msg, unix(at), AIRunning)
	return err
}

// LatestAIJob returns the board's latest job with its segments; ErrNotFound when there is none.
func (s *Store) LatestAIJob(boardID string) (AIJob, error) {
	j := AIJob{BoardID: boardID}
	var created, finished int64
	err := s.db.QueryRow("SELECT id, status, model, error, created_at, finished_at FROM ai_jobs WHERE board_id = ? ORDER BY id DESC LIMIT 1", boardID).
		Scan(&j.ID, &j.Status, &j.Model, &j.Error, &created, &finished)
	if err != nil {
		return AIJob{}, notFound(err)
	}
	j.CreatedAt = time.Unix(created, 0)
	if finished != 0 {
		j.FinishedAt = time.Unix(finished, 0)
	}
	rows, err := s.db.Query("SELECT id, element_ids, min_x, min_y, max_x, max_y, latex, verbatim, error FROM ai_segments WHERE job_id = ? ORDER BY seq", j.ID)
	if err != nil {
		return AIJob{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var g AISegment
		var ids string
		if err := rows.Scan(&g.ID, &ids, &g.MinX, &g.MinY, &g.MaxX, &g.MaxY, &g.Latex, &g.Verbatim, &g.Error); err != nil {
			return AIJob{}, err
		}
		if err := json.Unmarshal([]byte(ids), &g.ElementIDs); err != nil {
			return AIJob{}, err
		}
		j.Segments = append(j.Segments, g)
	}
	return j, rows.Err()
}
