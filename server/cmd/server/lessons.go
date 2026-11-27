package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/maciekgangus/inkroom/server/internal/calendar"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

// The calendar API (R-104 to R-108, ADR 0025).

const (
	defaultLessonTitle = "Korepetycje"
	maxLessonTitle     = 100
	maxLessonText      = 4000
	maxLessonLength    = 12 * time.Hour
	maxCalendarRange   = 400 * 24 * time.Hour
	defaultRange       = 60 * 24 * time.Hour
	maxCalendarBody    = 16 << 10
)

const msgConflict = "Ten termin koliduje z innymi zajęciami lub niedostępnością"

type lessonJSON struct {
	ID       int64  `json:"id"`
	Title    string `json:"title"`
	Start    string `json:"start"`
	End      string `json:"end"`
	Status   string `json:"status"`
	Teacher  string `json:"teacher"`
	Student  string `json:"student"`
	Role     string `json:"role"` // what the caller is in this lesson: teacher or student
	SeriesID int64  `json:"seriesId,omitempty"`
	BoardID  string `json:"boardId,omitempty"`
	Note     string `json:"note"`
	Homework string `json:"homework"`
}

func lessonOut(l store.Lesson, viewer int64) lessonJSON {
	role := "student"
	if l.TeacherID == viewer {
		role = "teacher"
	}
	return lessonJSON{ID: l.ID, Title: l.Title, Start: iso(l.Start), End: iso(l.End), Status: l.Status, Teacher: l.TeacherName,
		Student: l.StudentName, Role: role, SeriesID: l.SeriesID, BoardID: l.BoardID, Note: l.Note, Homework: l.Homework}
}

type requestJSON struct {
	ID          int64  `json:"id"`
	LessonID    int64  `json:"lessonId"`
	LessonTitle string `json:"lessonTitle"`
	From        string `json:"from"` // the proposer's username
	Mine        bool   `json:"mine"` // sent by the caller (so only the caller may withdraw it)
	Start       string `json:"start"`
	End         string `json:"end"`
	Note        string `json:"note"`
}

type unavailableJSON struct {
	ID    int64  `json:"id"`
	Start string `json:"start"`
	End   string `json:"end"`
	Note  string `json:"note"`
}

// calendarUser is the caller of a calendar call that changes something: signed in and, for a
// call with a body, sending JSON (like the other write calls).
func (a *app) calendarUser(w http.ResponseWriter, r *http.Request) (store.User, bool) {
	if r.Method == http.MethodDelete {
		u, ok := a.auth.User(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "Nie jesteś zalogowany")
		}
		return u, ok
	}
	return a.accountUser(w, r)
}

func readCalendarBody(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxCalendarBody)).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return false
	}
	return true
}

// span checks a lesson's or a period's time: both set, in order, and not absurdly long.
func span(w http.ResponseWriter, start, end time.Time) bool {
	if start.IsZero() || end.IsZero() || !end.After(start) || end.Sub(start) > maxLessonLength {
		writeError(w, http.StatusBadRequest, "Nieprawidłowy czas: koniec musi być po początku, najwyżej 12 godzin")
		return false
	}
	return true
}

func cleanTitle(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		s = defaultLessonTitle
	}
	return s, utf8.RuneCountInString(s) <= maxLessonTitle
}

// student finds the account named by a username or an e-mail; it has already answered if it cannot.
func (a *app) student(w http.ResponseWriter, login string, teacher store.User) (store.User, bool) {
	s, err := a.st.UserByLogin(login)
	if err != nil {
		storeFail(w, err, "Nie ma takiego użytkownika")
		return store.User{}, false
	}
	if s.ID == teacher.ID {
		writeError(w, http.StatusBadRequest, "Nie możesz prowadzić zajęć sam dla siebie")
		return store.User{}, false
	}
	return s, true
}

func lessonFail(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, msgConflict)
		return
	}
	storeFail(w, err, "Nie ma takich zajęć")
}

// lessonOf loads the lesson in the URL for a caller who teaches it (teacherOnly) or is in it.
func (a *app) lessonOf(w http.ResponseWriter, r *http.Request, u store.User, teacherOnly bool) (store.Lesson, bool) {
	id, ok := pathID(w, r)
	if !ok {
		return store.Lesson{}, false
	}
	l, err := a.st.Lesson(id)
	if err != nil {
		storeFail(w, err, "Nie ma takich zajęć")
		return store.Lesson{}, false
	}
	if l.TeacherID != u.ID && (teacherOnly || l.StudentID != u.ID) {
		// A lesson of strangers does not exist for the caller.
		if l.TeacherID == u.ID || l.StudentID == u.ID {
			writeError(w, http.StatusForbidden, "Tylko prowadzący może to zrobić")
		} else {
			writeError(w, http.StatusNotFound, "Nie ma takich zajęć")
		}
		return store.Lesson{}, false
	}
	return l, true
}

// timeParam reads a date or a time from the query; empty gives the default.
func timeParam(r *http.Request, name string, def time.Time) (time.Time, bool) {
	v := r.URL.Query().Get(name)
	if v == "" {
		return def, true
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t, true
	}
	t, err := time.Parse("2006-01-02", v)
	return t, err == nil
}

// getCalendar lists the caller's lessons, unavailable periods and open requests in a time range
// (default: from now, 60 days ahead).
func (a *app) getCalendar(w http.ResponseWriter, r *http.Request) {
	u, ok := a.auth.User(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Nie jesteś zalogowany")
		return
	}
	now := time.Now()
	from, ok1 := timeParam(r, "from", now)
	to, ok2 := timeParam(r, "to", from.Add(defaultRange))
	if !ok1 || !ok2 || !to.After(from) || to.Sub(from) > maxCalendarRange {
		writeError(w, http.StatusBadRequest, "Nieprawidłowy zakres dat")
		return
	}
	lessons, err1 := a.st.LessonsOf(u.ID, from, to)
	away, err2 := a.st.UnavailableOf(u.ID, from, to)
	requests, err3 := a.st.RequestsOf(u.ID)
	if err1 != nil || err2 != nil || err3 != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	out := struct {
		Lessons     []lessonJSON      `json:"lessons"`
		Unavailable []unavailableJSON `json:"unavailable"`
		Requests    []requestJSON     `json:"requests"`
	}{[]lessonJSON{}, []unavailableJSON{}, []requestJSON{}}
	for _, l := range lessons {
		out.Lessons = append(out.Lessons, lessonOut(l, u.ID))
	}
	for _, v := range away {
		out.Unavailable = append(out.Unavailable, unavailableJSON{v.ID, iso(v.Start), iso(v.End), v.Note})
	}
	for _, q := range requests {
		out.Requests = append(out.Requests, requestJSON{q.ID, q.LessonID, q.LessonTitle, q.ProposerName, q.ProposerID == u.ID,
			iso(q.NewStart), iso(q.NewEnd), q.Note})
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, out)
}

func (a *app) createLesson(w http.ResponseWriter, r *http.Request) {
	u, ok := a.calendarUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Title   string    `json:"title"`
		Student string    `json:"student"`
		Start   time.Time `json:"start"`
		End     time.Time `json:"end"`
	}
	if !readCalendarBody(w, r, &body) || !span(w, body.Start, body.End) {
		return
	}
	title, ok := cleanTitle(body.Title)
	if !ok {
		writeError(w, http.StatusBadRequest, "Tytuł może mieć najwyżej 100 znaków")
		return
	}
	student, ok := a.student(w, body.Student, u)
	if !ok {
		return
	}
	l, err := a.st.CreateLesson(store.Lesson{TeacherID: u.ID, StudentID: student.ID, Title: title, Start: body.Start, End: body.End}, time.Now())
	if err != nil {
		lessonFail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, lessonOut(l, u.ID))
}

func (a *app) updateLesson(w http.ResponseWriter, r *http.Request) {
	u, ok := a.calendarUser(w, r)
	if !ok {
		return
	}
	l, ok := a.lessonOf(w, r, u, true)
	if !ok {
		return
	}
	var body struct {
		Title    *string    `json:"title"`
		Start    *time.Time `json:"start"`
		End      *time.Time `json:"end"`
		Status   *string    `json:"status"`
		Note     *string    `json:"note"`
		Homework *string    `json:"homework"`
	}
	if !readCalendarBody(w, r, &body) {
		return
	}
	patch := store.LessonPatch{Start: body.Start, End: body.End, Status: body.Status, Note: body.Note, Homework: body.Homework}
	start, end := l.Start, l.End
	if body.Start != nil {
		start = *body.Start
	}
	if body.End != nil {
		end = *body.End
	}
	if (body.Start != nil || body.End != nil) && !span(w, start, end) {
		return
	}
	if body.Title != nil {
		title, ok := cleanTitle(*body.Title)
		if !ok {
			writeError(w, http.StatusBadRequest, "Tytuł może mieć najwyżej 100 znaków")
			return
		}
		patch.Title = &title
	}
	if s := body.Status; s != nil && *s != store.LessonScheduled && *s != store.LessonDone && *s != store.LessonCancelled {
		writeError(w, http.StatusBadRequest, "Nieznany status zajęć")
		return
	}
	for _, text := range []*string{body.Note, body.Homework} {
		if text != nil && utf8.RuneCountInString(*text) > maxLessonText {
			writeError(w, http.StatusBadRequest, "Tekst jest za długi")
			return
		}
	}
	got, err := a.st.UpdateLesson(l.ID, patch)
	if err != nil {
		lessonFail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, lessonOut(got, u.ID))
}

func (a *app) deleteLesson(w http.ResponseWriter, r *http.Request) {
	u, ok := a.calendarUser(w, r)
	if !ok {
		return
	}
	l, ok := a.lessonOf(w, r, u, true)
	if !ok {
		return
	}
	if err := a.st.DeleteLesson(l.ID); err != nil {
		lessonFail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// linkBoard ties the lesson to a board: one of the teacher's own ({"boardId"}), or a new one
// named after the lesson (empty body). The answer carries the lesson.
func (a *app) linkBoard(w http.ResponseWriter, r *http.Request) {
	u, ok := a.calendarUser(w, r)
	if !ok {
		return
	}
	l, ok := a.lessonOf(w, r, u, true)
	if !ok {
		return
	}
	var body struct {
		BoardID string `json:"boardId"`
	}
	if r.ContentLength != 0 && !readCalendarBody(w, r, &body) {
		return
	}
	id := body.BoardID
	if id == "" {
		name := l.Title
		if utf8.RuneCountInString(name) > maxBoardName {
			name = defaultBoardName
		}
		b, err := a.st.CreateBoard(newBoardID(), u.ID, name)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Błąd serwera")
			return
		}
		id = b.ID
	} else if isOwner, err := a.st.IsBoardOwner(id, u.ID); err != nil || !isOwner {
		writeError(w, http.StatusNotFound, "Nie ma takiej tablicy")
		return
	}
	if err := a.st.SetLessonBoard(l.ID, id); err != nil {
		lessonFail(w, err)
		return
	}
	l.BoardID = id
	writeJSON(w, http.StatusOK, lessonOut(l, u.ID))
}

// createSeries makes the lessons of a repeat rule (R-105); the answer is the series id and how many.
func (a *app) createSeries(w http.ResponseWriter, r *http.Request) {
	u, ok := a.calendarUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Title   string `json:"title"`
		Student string `json:"student"`
		calendar.Rule
	}
	if !readCalendarBody(w, r, &body) {
		return
	}
	title, ok := cleanTitle(body.Title)
	if !ok {
		writeError(w, http.StatusBadRequest, "Tytuł może mieć najwyżej 100 znaków")
		return
	}
	spans, err := body.Rule.Expand()
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	student, ok := a.student(w, body.Student, u)
	if !ok {
		return
	}
	pairs := make([][2]time.Time, len(spans))
	for i, sp := range spans {
		pairs[i] = [2]time.Time{sp.Start, sp.End}
	}
	rule, _ := json.Marshal(body.Rule)
	id, err := a.st.CreateSeries(u.ID, student.ID, title, string(rule), pairs, time.Now())
	if err != nil {
		lessonFail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "lessons": len(pairs)})
}

// deleteSeries removes the series' lessons from a time on (default: now); earlier ones stay.
func (a *app) deleteSeries(w http.ResponseWriter, r *http.Request) {
	u, ok := a.calendarUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	from, ok := timeParam(r, "from", time.Now())
	if !ok {
		writeError(w, http.StatusBadRequest, "Nieprawidłowa data")
		return
	}
	if owner, err := a.st.SeriesOwner(id); err != nil || owner != u.ID {
		writeError(w, http.StatusNotFound, "Nie ma takiej serii")
		return
	}
	n, err := a.st.DeleteSeriesFrom(id, from)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"deleted": n})
}

func (a *app) createUnavailable(w http.ResponseWriter, r *http.Request) {
	u, ok := a.calendarUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Start time.Time `json:"start"`
		End   time.Time `json:"end"`
		Note  string    `json:"note"`
	}
	if !readCalendarBody(w, r, &body) || !span(w, body.Start, body.End) {
		return
	}
	if utf8.RuneCountInString(body.Note) > maxLessonTitle {
		writeError(w, http.StatusBadRequest, "Notatka może mieć najwyżej 100 znaków")
		return
	}
	v, err := a.st.AddUnavailable(store.Unavailable{UserID: u.ID, Start: body.Start, End: body.End, Note: strings.TrimSpace(body.Note)})
	if err != nil {
		lessonFail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, unavailableJSON{v.ID, iso(v.Start), iso(v.End), v.Note})
}

func (a *app) deleteUnavailable(w http.ResponseWriter, r *http.Request) {
	u, ok := a.calendarUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := a.st.DeleteUnavailable(id, u.ID); err != nil {
		storeFail(w, err, "Nie ma takiego okresu")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// createRequest proposes another time for a lesson to the other person in it (R-107).
func (a *app) createRequest(w http.ResponseWriter, r *http.Request) {
	u, ok := a.calendarUser(w, r)
	if !ok {
		return
	}
	l, ok := a.lessonOf(w, r, u, false)
	if !ok {
		return
	}
	var body struct {
		Start time.Time `json:"start"`
		End   time.Time `json:"end"`
		Note  string    `json:"note"`
	}
	if !readCalendarBody(w, r, &body) || !span(w, body.Start, body.End) {
		return
	}
	if utf8.RuneCountInString(body.Note) > 500 {
		writeError(w, http.StatusBadRequest, "Notatka może mieć najwyżej 500 znaków")
		return
	}
	other := l.StudentID
	if u.ID == l.StudentID {
		other = l.TeacherID
	}
	q, err := a.st.CreateRequest(store.Request{LessonID: l.ID, ProposerID: u.ID, ResponderID: other, NewStart: body.Start, NewEnd: body.End,
		Note: strings.TrimSpace(body.Note)}, time.Now())
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeError(w, http.StatusConflict, "Ten termin jest zajęty albo prośba o zmianę już czeka na odpowiedź")
			return
		}
		lessonFail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, requestJSON{q.ID, q.LessonID, q.LessonTitle, q.ProposerName, true, iso(q.NewStart), iso(q.NewEnd), q.Note})
}

// resolveRequest closes a pending request: the responder accepts or rejects it, the proposer
// withdraws it.
func (a *app) resolveRequest(status string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := a.calendarUser(w, r)
		if !ok {
			return
		}
		id, ok := pathID(w, r)
		if !ok {
			return
		}
		q, err := a.st.RequestByID(id)
		if err != nil || q.Status != store.RequestPending || q.ProposerID != u.ID && q.ResponderID != u.ID {
			writeError(w, http.StatusNotFound, "Nie ma takiej prośby")
			return
		}
		if (status == store.RequestCancelled) != (q.ProposerID == u.ID) {
			writeError(w, http.StatusForbidden, "Tej prośby nie możesz tak zamknąć")
			return
		}
		if err := a.st.ResolveRequest(id, status, time.Now()); err != nil {
			lessonFail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
