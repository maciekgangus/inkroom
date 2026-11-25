package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"
)

// Server exposes the segmentation pipeline over HTTP.
type Server struct {
	Rec Recognizer // nil: /api/analyze answers 503
}

func (s *Server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/segment", s.handleSegment)
	mux.HandleFunc("POST /api/analyze", s.handleAnalyze)
	return mux
}

type segmentResponse struct {
	BoardID  string    `json:"boardId"`
	Count    int       `json:"count"`
	Segments []Segment `json:"segments"`
}

func (s *Server) handleSegment(w http.ResponseWriter, r *http.Request) {
	m, err := decodeManifest(w, r)
	if err != nil {
		return
	}
	opts := SegmentOptions{Gap: queryFloat(r, "gap"), Order: r.URL.Query().Get("order")}
	segs := SegmentManifest(m, opts)
	writeJSON(w, http.StatusOK, segmentResponse{BoardID: m.BoardID, Count: len(segs), Segments: segs})
}

type segmentResult struct {
	Segment
	Latex string `json:"latex"`
	Error string `json:"error,omitempty"`
}

type analyzeResponse struct {
	BoardID  string          `json:"boardId"`
	Model    string          `json:"model,omitempty"`
	Count    int             `json:"count"`
	Segments []segmentResult `json:"segments"`
}

// handleAnalyze segments the board, renders every segment to a PNG and sends
// it to the recognition model. A failing segment does not fail the request;
// its error is reported in the segment result.
func (s *Server) handleAnalyze(w http.ResponseWriter, r *http.Request) {
	if s.Rec == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "recognizer not configured: set UNIMUMER_BASE_URL",
		})
		return
	}
	m, err := decodeManifest(w, r)
	if err != nil {
		return
	}
	opts := SegmentOptions{Gap: queryFloat(r, "gap"), Order: r.URL.Query().Get("order")}
	segs := SegmentManifest(m, opts)
	render := RenderOptions{
		Scale:   queryFloat(r, "scale"),
		MaxSide: int(queryFloat(r, "maxSide")),
	}
	out := analyzeResponse{BoardID: m.BoardID, Model: s.Rec.Name(), Count: len(segs)}
	for _, seg := range segs {
		res := segmentResult{Segment: seg}
		img := RenderSegment(seg, m.Elements, render)
		ctx, cancel := context.WithTimeout(r.Context(), 180*time.Second)
		latex, err := s.Rec.Recognize(ctx, img, seg.ID)
		cancel()
		if err != nil {
			res.Error = err.Error()
		} else {
			res.Latex = latex
		}
		out.Segments = append(out.Segments, res)
	}
	writeJSON(w, http.StatusOK, out)
}

func decodeManifest(w http.ResponseWriter, r *http.Request) (Manifest, error) {
	var m Manifest
	r.Body = http.MaxBytesReader(w, r.Body, 64<<20)
	if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid manifest JSON: " + err.Error()})
		return Manifest{}, err
	}
	if m.BoardID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "boardId is required"})
		return Manifest{}, errInvalid
	}
	return m, nil
}

var errInvalid = errorString("invalid request")

type errorString string

func (e errorString) Error() string { return string(e) }

func queryFloat(r *http.Request, key string) float64 {
	v := r.URL.Query().Get(key)
	if v == "" {
		return 0
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 0
	}
	return f
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
