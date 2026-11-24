package store

import (
	"database/sql"
	"errors"
	"time"
)

// ErrConflict is returned when a lesson or an unavailable period would overlap another one.
var ErrConflict = errors.New("time conflict")

// Lesson statuses.
const (
	LessonScheduled = "scheduled"
	LessonDone      = "done"
	LessonCancelled = "cancelled"
)

// Request statuses.
const (
	RequestPending   = "pending"
	RequestAccepted  = "accepted"
	RequestRejected  = "rejected"
	RequestCancelled = "cancelled"
)

const calendarSchema = `
CREATE TABLE lesson_series (
	id INTEGER PRIMARY KEY,
	teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	rule TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE TABLE lessons (
	id INTEGER PRIMARY KEY,
	teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	series_id INTEGER REFERENCES lesson_series(id) ON DELETE SET NULL,
	board_id TEXT REFERENCES boards(id) ON DELETE SET NULL,
	title TEXT NOT NULL,
	start_at INTEGER NOT NULL,
	end_at INTEGER NOT NULL,
	status TEXT NOT NULL DEFAULT 'scheduled',
	note TEXT NOT NULL DEFAULT '',
	homework TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL
);
CREATE INDEX lessons_teacher ON lessons(teacher_id, start_at);
CREATE INDEX lessons_student ON lessons(student_id, start_at);
CREATE INDEX lessons_series ON lessons(series_id);
CREATE TABLE unavailability (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	start_at INTEGER NOT NULL,
	end_at INTEGER NOT NULL,
	note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX unavailability_user ON unavailability(user_id, start_at);
CREATE TABLE lesson_requests (
	id INTEGER PRIMARY KEY,
	lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
	proposer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	responder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	new_start INTEGER NOT NULL,
	new_end INTEGER NOT NULL,
	note TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'pending',
	created_at INTEGER NOT NULL,
	resolved_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX lesson_requests_lesson ON lesson_requests(lesson_id);
`

// Lesson is one lesson between a teacher and a student.
type Lesson struct {
	ID          int64
	TeacherID   int64
	StudentID   int64
	TeacherName string // filled in by the lists and Lesson
	StudentName string
	SeriesID    int64  // 0: not part of a series
	BoardID     string // "": no board
	Title       string
	Start, End  time.Time
	Status      string
	Note        string
	Homework    string
}

// LessonPatch changes the fields that are not nil.
type LessonPatch struct {
	Title      *string
	Start, End *time.Time
	Status     *string
	Note       *string
	Homework   *string
}

// Unavailable is a period in which a user cannot have lessons.
type Unavailable struct {
	ID         int64
	UserID     int64
	Start, End time.Time
	Note       string
}

// Request asks to move a lesson to another time.
type Request struct {
	ID                      int64
	LessonID                int64
	ProposerID, ResponderID int64
	ProposerName            string
	NewStart, NewEnd        time.Time
	Note                    string
	Status                  string
	CreatedAt               time.Time
	LessonTitle             string
}

const lessonColumns = `l.id, l.teacher_id, l.student_id, t.username, s.username, COALESCE(l.series_id, 0), COALESCE(l.board_id, ''),
	l.title, l.start_at, l.end_at, l.status, l.note, l.homework`

const lessonFrom = ` FROM lessons l JOIN users t ON t.id = l.teacher_id JOIN users s ON s.id = l.student_id`

type scanner interface{ Scan(dest ...any) error }

func scanLesson(r scanner) (Lesson, error) {
	var l Lesson
	var start, end int64
	err := r.Scan(&l.ID, &l.TeacherID, &l.StudentID, &l.TeacherName, &l.StudentName, &l.SeriesID, &l.BoardID,
		&l.Title, &start, &end, &l.Status, &l.Note, &l.Homework)
	l.Start, l.End = time.Unix(start, 0).UTC(), time.Unix(end, 0).UTC()
	return l, err
}

type querier interface {
	QueryRow(query string, args ...any) *sql.Row
	Query(query string, args ...any) (*sql.Rows, error)
	Exec(query string, args ...any) (sql.Result, error)
}

// busy reports whether any of the users has a lesson (not cancelled, except lesson `except`) or
// an unavailable period that overlaps [start, end).
func busy(q querier, users []int64, start, end time.Time, except int64) (bool, error) {
	for _, u := range users {
		var n int
		err := q.QueryRow(`SELECT
			(SELECT COUNT(*) FROM lessons WHERE (teacher_id = ?1 OR student_id = ?1) AND status != 'cancelled'
				AND id != ?4 AND start_at < ?3 AND end_at > ?2) +
			(SELECT COUNT(*) FROM unavailability WHERE user_id = ?1 AND start_at < ?3 AND end_at > ?2)`,
			u, start.Unix(), end.Unix(), except).Scan(&n)
		if err != nil {
			return false, err
		}
		if n > 0 {
			return true, nil
		}
	}
	return false, nil
}

func (s *Store) tx(f func(tx *sql.Tx) error) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	if err := f(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

func insertLesson(tx *sql.Tx, l Lesson, seriesID int64, now time.Time) (int64, error) {
	var series any
	if seriesID != 0 {
		series = seriesID
	}
	res, err := tx.Exec(`INSERT INTO lessons (teacher_id, student_id, series_id, title, start_at, end_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, l.TeacherID, l.StudentID, series, l.Title, l.Start.Unix(), l.End.Unix(), now.Unix())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// CreateLesson adds a lesson, or returns ErrConflict when the teacher or the student is busy then.
func (s *Store) CreateLesson(l Lesson, now time.Time) (Lesson, error) {
	var id int64
	err := s.tx(func(tx *sql.Tx) error {
		if taken, err := busy(tx, []int64{l.TeacherID, l.StudentID}, l.Start, l.End, 0); err != nil || taken {
			if err == nil {
				err = ErrConflict
			}
			return err
		}
		var err error
		id, err = insertLesson(tx, l, 0, now)
		return err
	})
	if err != nil {
		return Lesson{}, err
	}
	return s.Lesson(id)
}

// CreateSeries stores the rule and the lessons it made, all or none (ErrConflict if one of them
// finds somebody busy).
func (s *Store) CreateSeries(teacherID, studentID int64, title, rule string, spans [][2]time.Time, now time.Time) (int64, error) {
	var seriesID int64
	err := s.tx(func(tx *sql.Tx) error {
		res, err := tx.Exec("INSERT INTO lesson_series (teacher_id, rule, created_at) VALUES (?, ?, ?)", teacherID, rule, now.Unix())
		if err != nil {
			return err
		}
		if seriesID, err = res.LastInsertId(); err != nil {
			return err
		}
		for _, sp := range spans {
			taken, err := busy(tx, []int64{teacherID, studentID}, sp[0], sp[1], 0)
			if err != nil {
				return err
			}
			if taken {
				return ErrConflict
			}
			if _, err := insertLesson(tx, Lesson{TeacherID: teacherID, StudentID: studentID, Title: title, Start: sp[0], End: sp[1]}, seriesID, now); err != nil {
				return err
			}
		}
		return nil
	})
	return seriesID, err
}

// Lesson returns one lesson.
func (s *Store) Lesson(id int64) (Lesson, error) {
	l, err := scanLesson(s.db.QueryRow("SELECT "+lessonColumns+lessonFrom+" WHERE l.id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return Lesson{}, ErrNotFound
	}
	return l, err
}

// LessonsOf lists the lessons the user teaches or attends that overlap [from, to), in time order.
func (s *Store) LessonsOf(userID int64, from, to time.Time) ([]Lesson, error) {
	rows, err := s.db.Query("SELECT "+lessonColumns+lessonFrom+` WHERE (l.teacher_id = ?1 OR l.student_id = ?1)
		AND l.start_at < ?3 AND l.end_at > ?2 ORDER BY l.start_at, l.id`, userID, from.Unix(), to.Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Lesson
	for rows.Next() {
		l, err := scanLesson(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// UpdateLesson applies the patch; a new time is checked for conflicts (ErrConflict).
func (s *Store) UpdateLesson(id int64, p LessonPatch) (Lesson, error) {
	err := s.tx(func(tx *sql.Tx) error {
		var teacher, student, start, end int64
		var status string
		if err := tx.QueryRow("SELECT teacher_id, student_id, start_at, end_at, status FROM lessons WHERE id = ?", id).
			Scan(&teacher, &student, &start, &end, &status); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		newStart, newEnd, newStatus := time.Unix(start, 0), time.Unix(end, 0), status
		if p.Start != nil {
			newStart = *p.Start
		}
		if p.End != nil {
			newEnd = *p.End
		}
		if p.Status != nil {
			newStatus = *p.Status
		}
		if newStatus != LessonCancelled && (newStart.Unix() != start || newEnd.Unix() != end || status == LessonCancelled) {
			if taken, err := busy(tx, []int64{teacher, student}, newStart, newEnd, id); err != nil || taken {
				if err == nil {
					err = ErrConflict
				}
				return err
			}
		}
		set := func(col string, v any) error {
			_, err := tx.Exec("UPDATE lessons SET "+col+" = ? WHERE id = ?", v, id)
			return err
		}
		for _, f := range []struct {
			col string
			v   any
			on  bool
		}{
			{"title", p.Title, p.Title != nil},
			{"start_at", newStart.Unix(), p.Start != nil},
			{"end_at", newEnd.Unix(), p.End != nil},
			{"status", p.Status, p.Status != nil},
			{"note", p.Note, p.Note != nil},
			{"homework", p.Homework, p.Homework != nil},
		} {
			if !f.on {
				continue
			}
			v := f.v
			switch x := v.(type) {
			case *string:
				v = *x
			}
			if err := set(f.col, v); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Lesson{}, err
	}
	return s.Lesson(id)
}

// SetLessonBoard links the lesson to a board ("" unlinks it).
func (s *Store) SetLessonBoard(id int64, boardID string) error {
	var b any
	if boardID != "" {
		b = boardID
	}
	return s.mustAffect(s.db.Exec("UPDATE lessons SET board_id = ? WHERE id = ?", b, id))
}

// DeleteLesson removes a lesson.
func (s *Store) DeleteLesson(id int64) error {
	return s.mustAffect(s.db.Exec("DELETE FROM lessons WHERE id = ?", id))
}

// SeriesOwner returns the teacher of a series.
func (s *Store) SeriesOwner(id int64) (int64, error) {
	var owner int64
	err := s.db.QueryRow("SELECT teacher_id FROM lesson_series WHERE id = ?", id).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	return owner, err
}

// DeleteSeriesFrom removes the series' lessons that start at or after `from` and returns how many;
// when none are left the series itself goes too.
func (s *Store) DeleteSeriesFrom(id int64, from time.Time) (int64, error) {
	var n int64
	err := s.tx(func(tx *sql.Tx) error {
		res, err := tx.Exec("DELETE FROM lessons WHERE series_id = ? AND start_at >= ?", id, from.Unix())
		if err != nil {
			return err
		}
		n, _ = res.RowsAffected()
		_, err = tx.Exec(`DELETE FROM lesson_series WHERE id = ? AND NOT EXISTS (SELECT 1 FROM lessons WHERE series_id = ?)`, id, id)
		return err
	})
	return n, err
}

// AddUnavailable marks a period; it fails with ErrConflict when a lesson is planned in it.
func (s *Store) AddUnavailable(u Unavailable) (Unavailable, error) {
	err := s.tx(func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM lessons WHERE (teacher_id = ?1 OR student_id = ?1) AND status = 'scheduled'
			AND start_at < ?3 AND end_at > ?2`, u.UserID, u.Start.Unix(), u.End.Unix()).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			return ErrConflict
		}
		res, err := tx.Exec("INSERT INTO unavailability (user_id, start_at, end_at, note) VALUES (?, ?, ?, ?)",
			u.UserID, u.Start.Unix(), u.End.Unix(), u.Note)
		if err != nil {
			return err
		}
		u.ID, err = res.LastInsertId()
		return err
	})
	return u, err
}

// UnavailableOf lists the user's unavailable periods that overlap [from, to).
func (s *Store) UnavailableOf(userID int64, from, to time.Time) ([]Unavailable, error) {
	rows, err := s.db.Query(`SELECT id, user_id, start_at, end_at, note FROM unavailability
		WHERE user_id = ? AND start_at < ? AND end_at > ? ORDER BY start_at`, userID, to.Unix(), from.Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Unavailable
	for rows.Next() {
		var u Unavailable
		var a, b int64
		if err := rows.Scan(&u.ID, &u.UserID, &a, &b, &u.Note); err != nil {
			return nil, err
		}
		u.Start, u.End = time.Unix(a, 0).UTC(), time.Unix(b, 0).UTC()
		out = append(out, u)
	}
	return out, rows.Err()
}

// DeleteUnavailable removes the user's own period.
func (s *Store) DeleteUnavailable(id, userID int64) error {
	return s.mustAffect(s.db.Exec("DELETE FROM unavailability WHERE id = ? AND user_id = ?", id, userID))
}

// CreateRequest asks the other person of the lesson to move it. ErrConflict: the new time is
// taken, or a request for this lesson is already pending.
func (s *Store) CreateRequest(r Request, now time.Time) (Request, error) {
	err := s.tx(func(tx *sql.Tx) error {
		var teacher, student int64
		if err := tx.QueryRow("SELECT teacher_id, student_id FROM lessons WHERE id = ?", r.LessonID).Scan(&teacher, &student); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		var pending int
		if err := tx.QueryRow("SELECT COUNT(*) FROM lesson_requests WHERE lesson_id = ? AND status = 'pending'", r.LessonID).Scan(&pending); err != nil {
			return err
		}
		if pending > 0 {
			return ErrConflict
		}
		if taken, err := busy(tx, []int64{teacher, student}, r.NewStart, r.NewEnd, r.LessonID); err != nil || taken {
			if err == nil {
				err = ErrConflict
			}
			return err
		}
		res, err := tx.Exec(`INSERT INTO lesson_requests (lesson_id, proposer_id, responder_id, new_start, new_end, note, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, r.LessonID, r.ProposerID, r.ResponderID, r.NewStart.Unix(), r.NewEnd.Unix(), r.Note, now.Unix())
		if err != nil {
			return err
		}
		r.ID, err = res.LastInsertId()
		return err
	})
	if err != nil {
		return Request{}, err
	}
	return s.RequestByID(r.ID)
}

const requestSelect = `SELECT r.id, r.lesson_id, r.proposer_id, r.responder_id, u.username, r.new_start, r.new_end, r.note, r.status, r.created_at, l.title
	FROM lesson_requests r JOIN users u ON u.id = r.proposer_id JOIN lessons l ON l.id = r.lesson_id`

func scanRequest(r scanner) (Request, error) {
	var q Request
	var a, b, c int64
	err := r.Scan(&q.ID, &q.LessonID, &q.ProposerID, &q.ResponderID, &q.ProposerName, &a, &b, &q.Note, &q.Status, &c, &q.LessonTitle)
	q.NewStart, q.NewEnd, q.CreatedAt = time.Unix(a, 0).UTC(), time.Unix(b, 0).UTC(), time.Unix(c, 0).UTC()
	return q, err
}

// RequestByID returns one request.
func (s *Store) RequestByID(id int64) (Request, error) {
	q, err := scanRequest(s.db.QueryRow(requestSelect+" WHERE r.id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return Request{}, ErrNotFound
	}
	return q, err
}

// RequestsOf lists the pending requests the user sent or has to answer, newest first.
func (s *Store) RequestsOf(userID int64) ([]Request, error) {
	rows, err := s.db.Query(requestSelect+` WHERE r.status = 'pending' AND (r.proposer_id = ?1 OR r.responder_id = ?1)
		ORDER BY r.created_at DESC, r.id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Request
	for rows.Next() {
		q, err := scanRequest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

// ResolveRequest closes a pending request with the status accepted, rejected or cancelled.
// Accepting moves the lesson (ErrConflict if the time was taken in the meantime).
func (s *Store) ResolveRequest(id int64, status string, now time.Time) error {
	return s.tx(func(tx *sql.Tx) error {
		var lesson, a, b int64
		var cur string
		if err := tx.QueryRow("SELECT lesson_id, new_start, new_end, status FROM lesson_requests WHERE id = ?", id).Scan(&lesson, &a, &b, &cur); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if cur != RequestPending {
			return ErrNotFound
		}
		if status == RequestAccepted {
			var teacher, student int64
			if err := tx.QueryRow("SELECT teacher_id, student_id FROM lessons WHERE id = ?", lesson).Scan(&teacher, &student); err != nil {
				return err
			}
			if taken, err := busy(tx, []int64{teacher, student}, time.Unix(a, 0), time.Unix(b, 0), lesson); err != nil || taken {
				if err == nil {
					err = ErrConflict
				}
				return err
			}
			if _, err := tx.Exec("UPDATE lessons SET start_at = ?, end_at = ? WHERE id = ?", a, b, lesson); err != nil {
				return err
			}
		}
		_, err := tx.Exec("UPDATE lesson_requests SET status = ?, resolved_at = ? WHERE id = ?", status, now.Unix(), id)
		return err
	})
}
