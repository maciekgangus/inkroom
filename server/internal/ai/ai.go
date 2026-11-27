// Package ai runs the AI analysis of a saved board (R-121, ADR 0034): it sends the board's
// strokes as a manifest to the segmentation service (ai/segmentsvc), which splits the board into
// segments and recognizes each with Uni-MuMER, and keeps the result in SQLite.
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/logx"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

// jobTimeout bounds a whole analysis; segmentsvc spends up to 3 minutes on each segment.
const jobTimeout = 30 * time.Minute

// maxResponseBytes bounds what is read back from segmentsvc.
const maxResponseBytes = 16 << 20

// Authorize loads the board named in the request and checks the caller may analyze it. When it
// cannot, it has already answered.
type Authorize func(w http.ResponseWriter, r *http.Request) (store.Board, bool)

// Service starts analyses in the background and answers their status.
type Service struct {
	st        *store.Store
	url       string // segmentsvc base URL
	client    *http.Client
	authorize Authorize
	log       *slog.Logger

	ctx    context.Context // cancelled by Close
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// New makes the service. Jobs left running by a previous process are marked failed. Call Close
// before closing the store.
func New(st *store.Store, segmentsvcURL string, authorize Authorize) *Service {
	ctx, cancel := context.WithCancel(context.Background())
	s := &Service{
		st:        st,
		url:       strings.TrimRight(segmentsvcURL, "/"),
		client:    &http.Client{},
		authorize: authorize,
		log:       logx.For("ai"),
		ctx:       ctx,
		cancel:    cancel,
	}
	if err := st.FailRunningAIJobs("Analiza przerwana restartem serwera", time.Now()); err != nil {
		s.log.Error("fail stale ai jobs", "err", err)
	}
	return s
}

// SetURL points the service at segmentsvc; call it before serving.
func (s *Service) SetURL(segmentsvcURL string) { s.url = strings.TrimRight(segmentsvcURL, "/") }

// Close cancels running analyses and waits for them to stop.
func (s *Service) Close() {
	s.cancel()
	s.wait()
}

func (s *Service) wait() { s.wg.Wait() }

// Start handles POST /api/boards/{id}/analyze: it creates a job and runs it in the background.
func (s *Service) Start(w http.ResponseWriter, r *http.Request) {
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "Oczekiwano application/json")
		return
	}
	b, ok := s.authorize(w, r)
	if !ok {
		return
	}
	id, err := s.st.StartAIJob(b.ID, time.Now())
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "Analiza tej tablicy już trwa")
		return
	}
	if err != nil {
		s.log.Error("start ai job", "board", b.ID, "err", err)
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.run(id, b)
	}()
	writeJSON(w, http.StatusAccepted, map[string]any{"id": id, "status": store.AIRunning})
}

// run analyzes the board and records the outcome of job id.
func (s *Service) run(id int64, b store.Board) {
	ctx, cancel := context.WithTimeout(s.ctx, jobTimeout)
	defer cancel()
	res, err := s.analyze(ctx, b)
	if err != nil {
		s.log.Warn("ai job failed", "board", b.ID, "job", id, "err", err)
		msg := err.Error()
		if s.ctx.Err() != nil {
			msg = "Analiza przerwana zamknięciem serwera"
		} else if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			msg = "Analiza przekroczyła limit 30 minut"
		}
		if err := s.st.FailAIJob(id, msg, time.Now()); err != nil {
			s.log.Error("record ai job failure", "job", id, "err", err)
		}
		return
	}
	segs := make([]store.AISegment, 0, len(res.Segments))
	for _, g := range res.Segments {
		segs = append(segs, store.AISegment{
			ID: g.ID, ElementIDs: g.ElementIDs,
			MinX: g.BBox.MinX, MinY: g.BBox.MinY, MaxX: g.BBox.MaxX, MaxY: g.BBox.MaxY,
			Latex: g.Latex, Verbatim: g.Verbatim, Error: g.Error,
		})
	}
	if err := s.st.FinishAIJob(id, res.Model, segs, time.Now()); err != nil {
		s.log.Error("record ai job result", "job", id, "err", err)
		_ = s.st.FailAIJob(id, "Nie udało się zapisać wyniku", time.Now())
		return
	}
	s.log.Info("ai job done", "board", b.ID, "job", id, "segments", len(segs))
}

// manifest is the board export segmentsvc reads (ai/segmentsvc/manifest.go). The strokes are
// stored in the client's wire format, which segmentsvc understands, so they go as they are.
type manifest struct {
	BoardID  string            `json:"boardId"`
	Title    string            `json:"title,omitempty"`
	Elements []json.RawMessage `json:"elements"`
}

// analyzeResponse is the answer of segmentsvc POST /api/analyze.
type analyzeResponse struct {
	Model    string `json:"model"`
	Segments []struct {
		ID         string   `json:"id"`
		ElementIDs []string `json:"elementIds"`
		BBox       struct {
			MinX float64 `json:"minX"`
			MinY float64 `json:"minY"`
			MaxX float64 `json:"maxX"`
			MaxY float64 `json:"maxY"`
		} `json:"bbox"`
		Latex    string `json:"latex"`
		Verbatim bool   `json:"verbatim"`
		Error    string `json:"error"`
	} `json:"segments"`
}

// analyze sends the board's saved strokes to segmentsvc and returns its answer.
func (s *Service) analyze(ctx context.Context, b store.Board) (analyzeResponse, error) {
	var out analyzeResponse
	strokes, err := s.st.LoadStrokes(b.ID)
	if err != nil {
		return out, fmt.Errorf("Nie udało się wczytać tablicy: %w", err)
	}
	m := manifest{BoardID: b.ID, Title: b.Name, Elements: make([]json.RawMessage, 0, len(strokes))}
	for _, d := range strokes {
		m.Elements = append(m.Elements, d)
	}
	body, err := json.Marshal(m)
	if err != nil {
		return out, fmt.Errorf("Nie udało się zbudować manifestu: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url+"/api/analyze", bytes.NewReader(body))
	if err != nil {
		return out, fmt.Errorf("segmentsvc: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return out, fmt.Errorf("segmentsvc niedostępny: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return out, fmt.Errorf("segmentsvc: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return out, fmt.Errorf("segmentsvc odpowiedział %d: %s", resp.StatusCode, truncate(strings.TrimSpace(string(raw)), 500))
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, fmt.Errorf("segmentsvc: nieczytelna odpowiedź: %w", err)
	}
	return out, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

type bboxJSON struct {
	MinX float64 `json:"minX"`
	MinY float64 `json:"minY"`
	MaxX float64 `json:"maxX"`
	MaxY float64 `json:"maxY"`
}

type segmentJSON struct {
	ID         string   `json:"id"`
	ElementIDs []string `json:"elementIds"`
	BBox       bboxJSON `json:"bbox"`
	Latex      string   `json:"latex"`
	Verbatim   bool     `json:"verbatim"`
	Error      string   `json:"error"`
}

type jobJSON struct {
	ID         int64         `json:"id,omitempty"`
	Status     string        `json:"status"`
	Model      string        `json:"model,omitempty"`
	Error      string        `json:"error,omitempty"`
	CreatedAt  string        `json:"createdAt,omitempty"`
	FinishedAt string        `json:"finishedAt,omitempty"`
	Segments   []segmentJSON `json:"segments"`
}

// Status handles GET /api/boards/{id}/analyze: the latest job of the board with its segments,
// or status "none".
func (s *Service) Status(w http.ResponseWriter, r *http.Request) {
	b, ok := s.authorize(w, r)
	if !ok {
		return
	}
	j, err := s.st.LatestAIJob(b.ID)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, jobJSON{Status: "none", Segments: []segmentJSON{}})
		return
	}
	if err != nil {
		s.log.Error("load ai job", "board", b.ID, "err", err)
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	out := jobJSON{
		ID: j.ID, Status: j.Status, Model: j.Model, Error: j.Error,
		CreatedAt: iso(j.CreatedAt), Segments: make([]segmentJSON, 0, len(j.Segments)),
	}
	if !j.FinishedAt.IsZero() {
		out.FinishedAt = iso(j.FinishedAt)
	}
	for _, g := range j.Segments {
		ids := g.ElementIDs
		if ids == nil {
			ids = []string{}
		}
		out.Segments = append(out.Segments, segmentJSON{
			ID: g.ID, ElementIDs: ids, BBox: bboxJSON{g.MinX, g.MinY, g.MaxX, g.MaxY},
			Latex: g.Latex, Verbatim: g.Verbatim, Error: g.Error,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func iso(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
