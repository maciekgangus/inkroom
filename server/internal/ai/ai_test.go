package ai

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

// fixture is a store with one board holding two strokes and a text, the AI service wired to
// segmentsvc at svcURL, and a mux with the two routes. Anyone may use the board here; the
// owner check of the real server is tested in cmd/server.
type fixture struct {
	st  *store.Store
	svc *Service
	mux *http.ServeMux
}

func newFixture(t *testing.T, svcURL string) *fixture {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	u, err := st.CreateUser("a@example.com", "hash")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateBoard("b1", u.ID, "Lekcja 1"); err != nil {
		t.Fatal(err)
	}
	ops := []store.Op{
		{ID: "e1", Add: true, Data: []byte(`{"id":"e1","kind":"stroke","color":"#000","size":4,"z":1,"authorId":"u1","points":[[0,0,0.5],[10,10,0.5]]}`)},
		{ID: "e2", Add: true, Data: []byte(`{"id":"e2","color":"#000","size":4,"z":2,"authorId":"u1","points":[[20,0,0.5],[30,10,0.5]],"opacity":0.5}`)},
		{ID: "t1", Add: true, Data: []byte(`{"id":"t1","kind":"text","text":"Zadanie 1","color":"#000","size":4,"z":3,"authorId":"u1","points":[[0,100,1]]}`)},
	}
	if err := st.Apply("b1", ops, time.Now()); err != nil {
		t.Fatal(err)
	}
	svc := New(st, svcURL, func(w http.ResponseWriter, r *http.Request) (store.Board, bool) {
		b, err := st.Board(r.PathValue("id"))
		if err != nil {
			http.Error(w, "no board", http.StatusNotFound)
			return store.Board{}, false
		}
		return b, true
	})
	t.Cleanup(svc.Close)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/boards/{id}/analyze", svc.Start)
	mux.HandleFunc("GET /api/boards/{id}/analyze", svc.Status)
	return &fixture{st: st, svc: svc, mux: mux}
}

func (f *fixture) do(t *testing.T, method, path string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return rec, body
}

const okResponse = `{"boardId":"b1","model":"uni-mumer","count":3,"segments":[
	{"id":"s1","elementIds":["e1","e2"],"bbox":{"minX":0,"minY":0,"maxX":30,"maxY":10},"latex":"x^{2}"},
	{"id":"s2","elementIds":["t1"],"bbox":{"minX":0,"minY":100,"maxX":40,"maxY":110},"latex":"Zadanie 1","verbatim":true},
	{"id":"s3","elementIds":["e9"],"bbox":{"minX":1,"minY":2,"maxX":3,"maxY":4},"latex":"","error":"model timeout"}]}`

func TestAnalyzeSendsManifestAndStoresSegments(t *testing.T) {
	var got map[string]any
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/analyze" || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("segmentsvc got %s %s %q", r.Method, r.URL.Path, r.Header.Get("Content-Type"))
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		io.WriteString(w, okResponse)
	}))
	defer fake.Close()
	f := newFixture(t, fake.URL)

	rec, body := f.do(t, http.MethodPost, "/api/boards/b1/analyze")
	if rec.Code != http.StatusAccepted || body["status"] != "running" || body["id"] == nil {
		t.Fatalf("POST: %d %s", rec.Code, rec.Body)
	}
	f.svc.wait()

	if got["boardId"] != "b1" || got["title"] != "Lekcja 1" {
		t.Fatalf("manifest header: %v", got)
	}
	els, _ := got["elements"].([]any)
	if len(els) != 3 {
		t.Fatalf("manifest elements: %v", got["elements"])
	}
	first := els[0].(map[string]any)
	if first["id"] != "e1" || first["kind"] != "stroke" || len(first["points"].([]any)) != 2 {
		t.Fatalf("first element: %v", first)
	}
	if els[1].(map[string]any)["opacity"] != 0.5 || els[2].(map[string]any)["text"] != "Zadanie 1" {
		t.Fatalf("raw stroke fields lost: %v", els)
	}

	rec, body = f.do(t, http.MethodGet, "/api/boards/b1/analyze")
	if rec.Code != http.StatusOK || body["status"] != "done" || body["model"] != "uni-mumer" || body["finishedAt"] == nil {
		t.Fatalf("GET: %d %s", rec.Code, rec.Body)
	}
	segs := body["segments"].([]any)
	if len(segs) != 3 {
		t.Fatalf("segments: %v", segs)
	}
	s1 := segs[0].(map[string]any)
	bbox := s1["bbox"].(map[string]any)
	if s1["id"] != "s1" || s1["latex"] != "x^{2}" || s1["verbatim"] != false || s1["error"] != "" ||
		len(s1["elementIds"].([]any)) != 2 || bbox["maxX"] != 30.0 || bbox["maxY"] != 10.0 {
		t.Fatalf("s1: %v", s1)
	}
	if s2 := segs[1].(map[string]any); s2["verbatim"] != true || s2["latex"] != "Zadanie 1" {
		t.Fatalf("s2: %v", s2)
	}
	if s3 := segs[2].(map[string]any); s3["error"] != "model timeout" {
		t.Fatalf("s3: %v", s3)
	}
}

func TestAnalyzeFailsWhenSegmentsvcAnswersAnError(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		io.WriteString(w, `{"error":"recognizer not configured: set UNIMUMER_BASE_URL"}`)
	}))
	defer fake.Close()
	f := newFixture(t, fake.URL)
	f.do(t, http.MethodPost, "/api/boards/b1/analyze")
	f.svc.wait()
	_, body := f.do(t, http.MethodGet, "/api/boards/b1/analyze")
	msg, _ := body["error"].(string)
	if body["status"] != "failed" || !strings.Contains(msg, "503") || !strings.Contains(msg, "UNIMUMER_BASE_URL") {
		t.Fatalf("got %v", body)
	}
}

func TestAnalyzeFailsWhenSegmentsvcIsDown(t *testing.T) {
	fake := httptest.NewServer(http.NotFoundHandler())
	url := fake.URL
	fake.Close() // nothing listens there now
	f := newFixture(t, url)
	f.do(t, http.MethodPost, "/api/boards/b1/analyze")
	f.svc.wait()
	_, body := f.do(t, http.MethodGet, "/api/boards/b1/analyze")
	if body["status"] != "failed" || body["error"] == "" {
		t.Fatalf("got %v", body)
	}
}

func TestOneAnalysisAtATime(t *testing.T) {
	release := make(chan struct{})
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
		io.WriteString(w, okResponse)
	}))
	defer fake.Close()
	f := newFixture(t, fake.URL)
	if rec, _ := f.do(t, http.MethodPost, "/api/boards/b1/analyze"); rec.Code != http.StatusAccepted {
		t.Fatalf("first POST: %d", rec.Code)
	}
	if rec, _ := f.do(t, http.MethodPost, "/api/boards/b1/analyze"); rec.Code != http.StatusConflict {
		t.Fatalf("second POST while running: %d %s", rec.Code, rec.Body)
	}
	if _, body := f.do(t, http.MethodGet, "/api/boards/b1/analyze"); body["status"] != "running" {
		t.Fatalf("GET while running: %v", body)
	}
	close(release)
	f.svc.wait()
	if rec, _ := f.do(t, http.MethodPost, "/api/boards/b1/analyze"); rec.Code != http.StatusAccepted {
		t.Fatalf("POST after done: %d", rec.Code)
	}
}

func TestCloseCancelsARunningAnalysis(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer fake.Close()
	f := newFixture(t, fake.URL)
	f.do(t, http.MethodPost, "/api/boards/b1/analyze")
	done := make(chan struct{})
	go func() { f.svc.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Close did not stop the job")
	}
	j, err := f.st.LatestAIJob("b1")
	if err != nil || j.Status != store.AIFailed {
		t.Fatalf("got %+v %v", j, err)
	}
}

func TestStatusWithoutAnalysis(t *testing.T) {
	f := newFixture(t, "http://127.0.0.1:1")
	rec, body := f.do(t, http.MethodGet, "/api/boards/b1/analyze")
	if rec.Code != http.StatusOK || body["status"] != "none" {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	if segs, ok := body["segments"].([]any); !ok || len(segs) != 0 {
		t.Fatalf("segments must be an empty list: %s", rec.Body)
	}
}

func TestStartNeedsJSONAndAnAuthorizedBoard(t *testing.T) {
	f := newFixture(t, "http://127.0.0.1:1")
	req := httptest.NewRequest(http.MethodPost, "/api/boards/b1/analyze", nil)
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("without JSON content type: %d", rec.Code)
	}
	if rec, _ := f.do(t, http.MethodPost, "/api/boards/nope/analyze"); rec.Code != http.StatusNotFound {
		t.Fatalf("missing board: %d", rec.Code)
	}
	if rec, _ := f.do(t, http.MethodGet, "/api/boards/nope/analyze"); rec.Code != http.StatusNotFound {
		t.Fatalf("missing board: %d", rec.Code)
	}
}
