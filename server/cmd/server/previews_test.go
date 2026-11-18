package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

// A tiny valid PNG signature plus filler: the server only checks the signature and the size.
var fakePNG = append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{1}, 64)...)

func putPreview(t *testing.T, srv *httptest.Server, id, tag, ctype string, body []byte, u *user) *http.Response {
	t.Helper()
	req, err := http.NewRequest("PUT", srv.URL+"/api/boards/"+id+"/preview.png?tag="+tag, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", ctype)
	if u != nil {
		req.AddCookie(u.cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func currentTag(t *testing.T, srv *httptest.Server, id string) string {
	t.Helper()
	r := call(t, srv, "GET", "/api/boards/"+id+"/preview", "", nil)
	r.Body.Close()
	return r.Header.Get("ETag")
}

func TestAStoredPreviewIsServedAsAPictureWithAnETag(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "anna@example.com")
	id := createBoard(t, srv, owner, "Matma")
	if r := call(t, srv, "GET", "/api/boards/"+id+"/preview.png", "", nil); r.StatusCode != http.StatusNotFound {
		t.Fatalf("no stored picture yet = %d, want 404", r.StatusCode)
	}
	tag := currentTag(t, srv, id)
	if r := putPreview(t, srv, id, tag, "image/png", fakePNG, &owner); r.StatusCode != http.StatusNoContent {
		t.Fatalf("store = %d", r.StatusCode)
	}
	// The link is the key, as for the board: no account to read it.
	r := call(t, srv, "GET", "/api/boards/"+id+"/preview.png", "", nil)
	defer r.Body.Close()
	if r.StatusCode != http.StatusOK || r.Header.Get("Content-Type") != "image/png" || r.Header.Get("ETag") != tag {
		t.Fatalf("got %d %q %q", r.StatusCode, r.Header.Get("Content-Type"), r.Header.Get("ETag"))
	}
	req, _ := http.NewRequest("GET", srv.URL+"/api/boards/"+id+"/preview.png", nil)
	req.Header.Set("If-None-Match", tag)
	again, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Body.Close()
	if again.StatusCode != http.StatusNotModified {
		t.Fatalf("unchanged = %d, want 304", again.StatusCode)
	}
}

func TestAStoredPreviewOfAnOlderVersionIsNotServed(t *testing.T) {
	srv, a, _ := testApp(t)
	owner := register(t, srv, "anna@example.com")
	id := createBoard(t, srv, owner, "Matma")
	putPreview(t, srv, id, currentTag(t, srv, id), "image/png", fakePNG, &owner).Body.Close()
	time.Sleep(1100 * time.Millisecond) // updated_at has a resolution of a second
	if err := a.st.Apply(id, []store.Op{{Add: true, ID: "s1", Data: []byte(`{"id":"s1","points":[[1,1,0.5]]}`)}}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if r := call(t, srv, "GET", "/api/boards/"+id+"/preview.png", "", nil); r.StatusCode != http.StatusNotFound {
		t.Fatalf("stale picture = %d, want 404", r.StatusCode)
	}
}

func TestOnlyTheOwnerStoresAPreviewAndOnlyOfTheCurrentVersion(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "anna@example.com")
	other := register(t, srv, "ola@example.com")
	id := createBoard(t, srv, owner, "Matma")
	tag := currentTag(t, srv, id)
	for name, c := range map[string]struct {
		u     *user
		tag   string
		ctype string
		body  []byte
		want  int
	}{
		"guest":         {nil, tag, "image/png", fakePNG, http.StatusUnauthorized},
		"not the owner": {&other, tag, "image/png", fakePNG, http.StatusForbidden},
		"old version":   {&owner, `"1-plain"`, "image/png", fakePNG, http.StatusConflict},
		"not a png":     {&owner, tag, "image/png", []byte("<html>"), http.StatusBadRequest},
		"wrong type":    {&owner, tag, "text/html", fakePNG, http.StatusUnsupportedMediaType},
		"too big":       {&owner, tag, "image/png", append(fakePNG, make([]byte, maxPreviewBytes)...), http.StatusRequestEntityTooLarge},
	} {
		if r := putPreview(t, srv, id, c.tag, c.ctype, c.body, c.u); r.StatusCode != c.want {
			t.Errorf("%s = %d, want %d", name, r.StatusCode, c.want)
		}
	}
	if r := call(t, srv, "GET", "/api/boards/"+id+"/preview.png", "", nil); r.StatusCode != http.StatusNotFound {
		t.Fatalf("nothing valid was stored, got %d", r.StatusCode)
	}
}
