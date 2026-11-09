package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// A valid 1x1 PNG.
var tinyPNG, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")

func upload(t *testing.T, srv *httptest.Server, boardID string, body []byte) *http.Response {
	t.Helper()
	req, err := http.NewRequest("POST", srv.URL+"/api/boards/"+boardID+"/images", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/octet-stream") // the server must not trust this
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func uploadOK(t *testing.T, srv *httptest.Server, boardID string, body []byte) string {
	t.Helper()
	resp := upload(t, srv, boardID, body)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload = %d", resp.StatusCode)
	}
	var out struct{ ID string }
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err := json.Unmarshal(b, &out); err != nil || len(out.ID) != 32 {
		t.Fatalf("bad body %q", b)
	}
	return out.ID
}

func TestUploadAndDownloadAnImage(t *testing.T) {
	srv, _, _ := testApp(t)
	board := createBoard(t, srv, register(t, srv, "a@example.com"), "Matma")
	id := uploadOK(t, srv, board, tinyPNG)

	resp, err := http.Get(srv.URL + "/api/boards/" + board + "/images/" + id)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	got, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || !bytes.Equal(got, tinyPNG) {
		t.Fatalf("download = %d, %d bytes", resp.StatusCode, len(got))
	}
	if ct := resp.Header.Get("Content-Type"); ct != "image/png" {
		t.Errorf("content type %q", ct)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Errorf("cache control %q", cc)
	}
	if resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Error("missing nosniff")
	}
}

func TestGuestsWithTheLinkMayUploadToo(t *testing.T) {
	srv, _, _ := testApp(t)
	board := createBoard(t, srv, register(t, srv, "a@example.com"), "Matma")
	uploadOK(t, srv, board, tinyPNG) // no cookie at all
}

func TestSupportedFormatsAreAccepted(t *testing.T) {
	srv, _, _ := testApp(t)
	board := createBoard(t, srv, register(t, srv, "a@example.com"), "Matma")
	pad := make([]byte, 64)
	for name, body := range map[string][]byte{
		"jpeg": append([]byte("\xff\xd8\xff\xe0"), pad...),
		"gif":  append([]byte("GIF89a"), pad...),
		"webp": append([]byte("RIFF\x24\x00\x00\x00WEBPVP8 "), pad...),
	} {
		if resp := upload(t, srv, board, body); resp.StatusCode != http.StatusCreated {
			t.Errorf("%s: got %d", name, resp.StatusCode)
		}
	}
}

func TestOtherFilesAreRejected(t *testing.T) {
	srv, _, _ := testApp(t)
	board := createBoard(t, srv, register(t, srv, "a@example.com"), "Matma")
	for name, body := range map[string][]byte{
		"svg (scriptable)": []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
		"html":             []byte("<html><script>alert(1)</script></html>"),
		"text":             []byte("hello"),
		"empty":            {},
	} {
		if resp := upload(t, srv, board, body); resp.StatusCode != http.StatusUnsupportedMediaType {
			t.Errorf("%s: got %d, want 415", name, resp.StatusCode)
		}
	}
}

func TestTooLargeUploadsAreRejected(t *testing.T) {
	srv, _, _ := testApp(t)
	board := createBoard(t, srv, register(t, srv, "a@example.com"), "Matma")
	big := append([]byte{}, tinyPNG...)
	big = append(big, make([]byte, maxImageBytes)...)
	if resp := upload(t, srv, board, big); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("got %d, want 413", resp.StatusCode)
	}
}

func TestUploadToAnUnknownBoardIs404(t *testing.T) {
	srv, _, _ := testApp(t)
	if resp := upload(t, srv, "nope", tinyPNG); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("got %d", resp.StatusCode)
	}
}

func TestAnImageIsOnlyServedThroughItsOwnBoard(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	b1 := createBoard(t, srv, owner, "Jedna")
	b2 := createBoard(t, srv, owner, "Dwie")
	id := uploadOK(t, srv, b1, tinyPNG)
	if got := status(call(t, srv, "GET", "/api/boards/"+b2+"/images/"+id, "", nil)); got != http.StatusNotFound {
		t.Fatalf("got %d", got)
	}
	if got := status(call(t, srv, "GET", "/api/boards/"+b1+"/images/nope", "", nil)); got != http.StatusNotFound {
		t.Fatalf("got %d", got)
	}
}

func TestDeletingTheBoardRemovesItsImages(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	id := uploadOK(t, srv, board, tinyPNG)
	if got := status(call(t, srv, "DELETE", "/api/boards/"+board, "", &owner)); got != http.StatusNoContent {
		t.Fatalf("delete = %d", got)
	}
	if got := status(call(t, srv, "GET", "/api/boards/"+board+"/images/"+id, "", nil)); got != http.StatusNotFound {
		t.Fatalf("image still served: %d", got)
	}
}
