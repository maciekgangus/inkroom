package main

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// at is a lesson time in the future, at hour h of day d from now (UTC, on the hour).
func at(d, h int) time.Time {
	return time.Now().UTC().Truncate(24*time.Hour).AddDate(0, 0, d).Add(time.Duration(h) * time.Hour)
}

func when(a, b time.Time) string {
	return `"start":"` + a.Format(time.RFC3339) + `","end":"` + b.Format(time.RFC3339) + `"`
}

// lessonFor makes a lesson of teacher with the student (username "<name>-user") and returns its id.
func lessonFor(t *testing.T, srv *httptest.Server, teacher user, student string, a time.Time) int64 {
	t.Helper()
	resp := call(t, srv, "POST", "/api/lessons", `{"title":"Matma","student":"`+student+`-user",`+when(a, a.Add(time.Hour))+`}`, &teacher)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create lesson = %d", resp.StatusCode)
	}
	return int64(decode(t, resp)["id"].(float64))
}

func calendarOf(t *testing.T, srv *httptest.Server, u user) map[string]any {
	t.Helper()
	resp := call(t, srv, "GET", "/api/calendar?from="+at(-1, 0).Format("2006-01-02")+"&to="+at(40, 0).Format("2006-01-02"), "", &u)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("calendar = %d", resp.StatusCode)
	}
	return decode(t, resp)
}

func TestCalendarNeedsLogin(t *testing.T) {
	srv, _, _ := testApp(t)
	for _, c := range [][2]string{{"GET", "/api/calendar"}, {"POST", "/api/lessons"}, {"POST", "/api/series"}, {"POST", "/api/unavailability"}} {
		if got := status(call(t, srv, c[0], c[1], `{}`, nil)); got != http.StatusUnauthorized {
			t.Errorf("%s %s = %d", c[0], c[1], got)
		}
	}
}

func TestBothSidesSeeALessonWithTheirRole(t *testing.T) {
	srv, _, _ := testApp(t)
	teacher, student, other := register(t, srv, "t@example.com"), register(t, srv, "s@example.com"), register(t, srv, "o@example.com")
	lessonFor(t, srv, teacher, "s", at(2, 15))
	for who, want := range map[string]struct {
		u    user
		role string
		n    int
	}{"teacher": {teacher, "teacher", 1}, "student": {student, "student", 1}, "stranger": {other, "", 0}} {
		lessons := calendarOf(t, srv, want.u)["lessons"].([]any)
		if len(lessons) != want.n {
			t.Fatalf("%s sees %d lessons", who, len(lessons))
		}
		if want.n == 1 && lessons[0].(map[string]any)["role"] != want.role {
			t.Errorf("%s role = %v", who, lessons[0])
		}
	}
}

func TestLessonValidation(t *testing.T) {
	srv, _, _ := testApp(t)
	teacher := register(t, srv, "t@example.com")
	register(t, srv, "s@example.com")
	a := at(2, 15)
	for name, body := range map[string]string{
		"unknown student": `{"student":"nobody",` + when(a, a.Add(time.Hour)) + `}`,
		"self":            `{"student":"t-user",` + when(a, a.Add(time.Hour)) + `}`,
		"end before":      `{"student":"s-user",` + when(a, a.Add(-time.Hour)) + `}`,
		"too long":        `{"student":"s-user",` + when(a, a.Add(13*time.Hour)) + `}`,
		"no times":        `{"student":"s-user"}`,
		"long title":      `{"student":"s-user","title":"` + strings.Repeat("x", 101) + `",` + when(a, a.Add(time.Hour)) + `}`,
	} {
		if got := status(call(t, srv, "POST", "/api/lessons", body, &teacher)); got < 400 || got >= 500 {
			t.Errorf("%s: got %d", name, got)
		}
	}
	// The student can also be named by e-mail, and the title defaults.
	resp := call(t, srv, "POST", "/api/lessons", `{"student":"s@example.com",`+when(a, a.Add(time.Hour))+`}`, &teacher)
	if m := decode(t, resp); resp.StatusCode != http.StatusCreated || m["title"] != "Korepetycje" {
		t.Fatalf("got %d %v", resp.StatusCode, m)
	}
}

func TestOverlapIsAConflict(t *testing.T) {
	srv, _, _ := testApp(t)
	teacher := register(t, srv, "t@example.com")
	register(t, srv, "s@example.com")
	register(t, srv, "x@example.com")
	a := at(2, 15)
	lessonFor(t, srv, teacher, "s", a)
	if got := status(call(t, srv, "POST", "/api/lessons", `{"student":"x-user",`+when(a.Add(30*time.Minute), a.Add(90*time.Minute))+`}`, &teacher)); got != http.StatusConflict {
		t.Fatalf("got %d", got)
	}
}

func TestOnlyTheTeacherChangesALesson(t *testing.T) {
	srv, _, _ := testApp(t)
	teacher, student, other := register(t, srv, "t@example.com"), register(t, srv, "s@example.com"), register(t, srv, "o@example.com")
	id := lessonFor(t, srv, teacher, "s", at(2, 15))
	path := "/api/lessons/" + itoa(id)
	body := `{"status":"done","note":"Ułamki","homework":"str. 12"}`
	if got := status(call(t, srv, "PATCH", path, body, &student)); got != http.StatusForbidden {
		t.Errorf("student patch = %d", got)
	}
	if got := status(call(t, srv, "PATCH", path, body, &other)); got != http.StatusNotFound {
		t.Errorf("stranger patch = %d", got)
	}
	if got := status(call(t, srv, "PATCH", path, `{"status":"weird"}`, &teacher)); got != http.StatusBadRequest {
		t.Errorf("bad status = %d", got)
	}
	resp := call(t, srv, "PATCH", path, body, &teacher)
	if m := decode(t, resp); resp.StatusCode != 200 || m["status"] != "done" || m["note"] != "Ułamki" {
		t.Fatalf("got %d %v", resp.StatusCode, m)
	}
	// The student reads the log.
	if l := calendarOf(t, srv, student)["lessons"].([]any)[0].(map[string]any); l["homework"] != "str. 12" {
		t.Errorf("student sees %v", l)
	}
	if got := status(call(t, srv, "DELETE", path, "", &student)); got != http.StatusForbidden {
		t.Errorf("student delete = %d", got)
	}
	if got := status(call(t, srv, "DELETE", path, "", &teacher)); got != http.StatusNoContent {
		t.Errorf("teacher delete = %d", got)
	}
}

func TestLessonBoardIsCreatedOrAttachedAndOpenToTheStudent(t *testing.T) {
	srv, _, _ := testApp(t)
	teacher, student := register(t, srv, "t@example.com"), register(t, srv, "s@example.com")
	other := register(t, srv, "o@example.com")
	id := lessonFor(t, srv, teacher, "s", at(2, 15))
	path := "/api/lessons/" + itoa(id) + "/board"
	if got := status(call(t, srv, "POST", path, `{}`, &student)); got != http.StatusForbidden {
		t.Fatalf("student links = %d", got)
	}
	resp := call(t, srv, "POST", path, `{}`, &teacher)
	board, _ := decode(t, resp)["boardId"].(string)
	if resp.StatusCode != 200 || len(board) != 32 {
		t.Fatalf("got %d %q", resp.StatusCode, board)
	}
	if l := calendarOf(t, srv, student)["lessons"].([]any)[0].(map[string]any); l["boardId"] != board {
		t.Fatalf("student sees %v", l)
	}
	if got := status(call(t, srv, "GET", "/api/boards/"+board, "", &student)); got != 200 {
		t.Errorf("student opens board = %d", got)
	}
	// An existing board of the teacher; somebody else's is refused.
	own := createBoard(t, srv, teacher, "Moja")
	if got := status(call(t, srv, "POST", path, `{"boardId":"`+own+`"}`, &teacher)); got != 200 {
		t.Errorf("own board = %d", got)
	}
	foreign := createBoard(t, srv, other, "Cudza")
	if got := status(call(t, srv, "POST", path, `{"boardId":"`+foreign+`"}`, &teacher)); got != http.StatusNotFound {
		t.Errorf("foreign board = %d", got)
	}
}

func TestSeriesMakesLessonsAndCanBeCut(t *testing.T) {
	srv, _, _ := testApp(t)
	teacher, student := register(t, srv, "t@example.com"), register(t, srv, "s@example.com")
	start := time.Now().AddDate(0, 0, 1).Format("2006-01-02")
	body := `{"title":"Cykl","student":"s-user","start":"` + start + `","intervalWeeks":1,"slots":[{"day":0,"time":"16:00","minutes":60},{"day":3,"time":"17:00","minutes":60}],"count":6}`
	resp := call(t, srv, "POST", "/api/series", body, &teacher)
	m := decode(t, resp)
	if resp.StatusCode != http.StatusCreated || m["lessons"] != float64(6) {
		t.Fatalf("got %d %v", resp.StatusCode, m)
	}
	if n := len(calendarOf(t, srv, student)["lessons"].([]any)); n != 6 {
		t.Fatalf("student sees %d", n)
	}
	// The same series again collides with itself.
	if got := status(call(t, srv, "POST", "/api/series", body, &teacher)); got != http.StatusConflict {
		t.Errorf("duplicate series = %d", got)
	}
	if got := status(call(t, srv, "POST", "/api/series", `{"student":"s-user","start":"`+start+`","intervalWeeks":1,"slots":[{"day":0,"time":"16:00","minutes":60}]}`, &teacher)); got != http.StatusBadRequest {
		t.Errorf("series without an end = %d", got)
	}
	id := itoa(int64(m["id"].(float64)))
	if got := status(call(t, srv, "DELETE", "/api/series/"+id, "", &student)); got != http.StatusNotFound {
		t.Errorf("student deletes series = %d", got)
	}
	resp = call(t, srv, "DELETE", "/api/series/"+id+"?from="+time.Now().Format("2006-01-02"), "", &teacher)
	if m := decode(t, resp); resp.StatusCode != 200 || m["deleted"] != float64(6) {
		t.Fatalf("got %d %v", resp.StatusCode, m)
	}
}

func TestUnavailableBlocksLessonsAndIsPrivateToItsOwner(t *testing.T) {
	srv, _, _ := testApp(t)
	teacher, student := register(t, srv, "t@example.com"), register(t, srv, "s@example.com")
	a := at(3, 10)
	resp := call(t, srv, "POST", "/api/unavailability", `{"note":"urlop",`+when(a, a.Add(4*time.Hour))+`}`, &student)
	id := itoa(int64(decode(t, resp)["id"].(float64)))
	if got := status(call(t, srv, "POST", "/api/lessons", `{"student":"s-user",`+when(a.Add(time.Hour), a.Add(2*time.Hour))+`}`, &teacher)); got != http.StatusConflict {
		t.Fatalf("lesson in unavailable time = %d", got)
	}
	if n := len(calendarOf(t, srv, teacher)["unavailable"].([]any)); n != 0 {
		t.Errorf("teacher sees the student's unavailability")
	}
	if got := status(call(t, srv, "DELETE", "/api/unavailability/"+id, "", &teacher)); got != http.StatusNotFound {
		t.Errorf("foreign delete = %d", got)
	}
	if got := status(call(t, srv, "DELETE", "/api/unavailability/"+id, "", &student)); got != http.StatusNoContent {
		t.Errorf("own delete = %d", got)
	}
}

func TestRequestToMoveALesson(t *testing.T) {
	srv, _, _ := testApp(t)
	teacher, student, other := register(t, srv, "t@example.com"), register(t, srv, "s@example.com"), register(t, srv, "o@example.com")
	id := lessonFor(t, srv, teacher, "s", at(2, 15))
	moved := at(4, 12)
	req := `{"note":"choroba",` + when(moved, moved.Add(time.Hour)) + `}`
	if got := status(call(t, srv, "POST", "/api/lessons/"+itoa(id)+"/requests", req, &other)); got != http.StatusNotFound {
		t.Fatalf("stranger asks = %d", got)
	}
	resp := call(t, srv, "POST", "/api/lessons/"+itoa(id)+"/requests", req, &student)
	m := decode(t, resp)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("student asks = %d %v", resp.StatusCode, m)
	}
	rid := itoa(int64(m["id"].(float64)))
	if got := status(call(t, srv, "POST", "/api/lessons/"+itoa(id)+"/requests", req, &teacher)); got != http.StatusConflict {
		t.Errorf("second request = %d", got)
	}
	// Each side sees it; only the other side answers it, only the sender withdraws it.
	if r := calendarOf(t, srv, student)["requests"].([]any); len(r) != 1 || r[0].(map[string]any)["mine"] != true {
		t.Errorf("student sees %v", r)
	}
	if r := calendarOf(t, srv, teacher)["requests"].([]any); len(r) != 1 || r[0].(map[string]any)["mine"] != false {
		t.Errorf("teacher sees %v", r)
	}
	if got := status(call(t, srv, "POST", "/api/requests/"+rid+"/accept", `{}`, &student)); got != http.StatusForbidden {
		t.Errorf("sender accepts = %d", got)
	}
	if got := status(call(t, srv, "POST", "/api/requests/"+rid+"/cancel", `{}`, &teacher)); got != http.StatusForbidden {
		t.Errorf("responder cancels = %d", got)
	}
	if got := status(call(t, srv, "POST", "/api/requests/"+rid+"/accept", `{}`, &other)); got != http.StatusNotFound {
		t.Errorf("stranger accepts = %d", got)
	}
	if got := status(call(t, srv, "POST", "/api/requests/"+rid+"/accept", `{}`, &teacher)); got != http.StatusNoContent {
		t.Fatalf("accept = %d", got)
	}
	l := calendarOf(t, srv, student)["lessons"].([]any)[0].(map[string]any)
	if l["start"] != moved.Format(time.RFC3339) {
		t.Errorf("lesson at %v, want %v", l["start"], moved)
	}
	if got := status(call(t, srv, "POST", "/api/requests/"+rid+"/accept", `{}`, &teacher)); got != http.StatusNotFound {
		t.Errorf("accept twice = %d", got)
	}
}

func TestSenderWithdrawsARequest(t *testing.T) {
	srv, _, _ := testApp(t)
	teacher, student := register(t, srv, "t@example.com"), register(t, srv, "s@example.com")
	id := lessonFor(t, srv, teacher, "s", at(2, 15))
	moved := at(4, 12)
	resp := call(t, srv, "POST", "/api/lessons/"+itoa(id)+"/requests", `{`+when(moved, moved.Add(time.Hour))+`}`, &teacher)
	rid := itoa(int64(decode(t, resp)["id"].(float64)))
	if got := status(call(t, srv, "POST", "/api/requests/"+rid+"/cancel", `{}`, &teacher)); got != http.StatusNoContent {
		t.Fatalf("cancel = %d", got)
	}
	if r := calendarOf(t, srv, student)["requests"].([]any); len(r) != 0 {
		t.Errorf("still listed: %v", r)
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
