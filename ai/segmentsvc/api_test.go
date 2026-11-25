package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func manifestTwoClusters() Manifest {
	return Manifest{BoardID: "b1", Elements: []Element{
		stroke("a", 1, Point{0, 0, 1}, Point{20, 2, 1}),
		stroke("b", 2, Point{0, 14, 1}, Point{20, 16, 1}),
		stroke("c", 3, Point{400, 400, 1}, Point{420, 402, 1}),
	}}
}

func TestAnalyzeEndToEnd(t *testing.T) {
	var calls atomic.Int32
	modelSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req chatRequest
		if err := json.Unmarshal(body, &req); err != nil {
			t.Errorf("bad request body: %v", err)
		}
		hasImage := false
		for _, msg := range req.Messages {
			for _, p := range msg.Content {
				if p.Type == "image_url" && strings.HasPrefix(p.ImageURL.URL, "data:image/png;base64,") {
					hasImage = true
				}
			}
		}
		if !hasImage {
			t.Error("request without image_url part")
		}
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"choices\":[{\"message\":{\"content\":\"```latex\\nx^2\\n```\"}}]}"))
	}))
	defer modelSrv.Close()

	srv := &Server{Rec: &UniMuMER{BaseURL: modelSrv.URL, Model: "test-model", Client: modelSrv.Client()}}
	body, _ := json.Marshal(manifestTwoClusters())
	req := httptest.NewRequest(http.MethodPost, "/api/analyze", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var resp analyzeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Count != 2 || len(resp.Segments) != 2 {
		t.Fatalf("want 2 segments, got %+v", resp)
	}
	if resp.Model != "test-model" {
		t.Errorf("model name not propagated: %q", resp.Model)
	}
	for _, seg := range resp.Segments {
		if seg.Latex != "x^2" {
			t.Errorf("segment %s: latex %q (fences should be stripped) err=%q", seg.ID, seg.Latex, seg.Error)
		}
	}
	if calls.Load() != 2 {
		t.Errorf("model called %d times, want 2", calls.Load())
	}
}

func TestSegmentEndpointNeedsNoModel(t *testing.T) {
	srv := &Server{}
	body, _ := json.Marshal(manifestTwoClusters())
	req := httptest.NewRequest(http.MethodPost, "/api/segment", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var resp segmentResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Count != 2 {
		t.Fatalf("want 2 segments, got %d", resp.Count)
	}
}

func TestAnalyzeWithoutRecognizerIs503(t *testing.T) {
	srv := &Server{}
	body, _ := json.Marshal(manifestTwoClusters())
	req := httptest.NewRequest(http.MethodPost, "/api/analyze", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503, got %d", rec.Code)
	}
}

func TestSegmentRejectsBadJSON(t *testing.T) {
	srv := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/api/segment", strings.NewReader("{nope"))
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestHealthz(t *testing.T) {
	srv := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

func TestTrimLatex(t *testing.T) {
	cases := map[string]string{
		"  x^2  ":                     "x^2",
		"```latex\n\\frac{a}{b}\n```": "\\frac{a}{b}",
		"```\ny=2\n```":               "y=2",
	}
	for in, want := range cases {
		if got := trimLatex(in); got != want {
			t.Errorf("trimLatex(%q) = %q, want %q", in, got, want)
		}
	}
}
