package main

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

// testApp starts an app on a fresh database in a temp dir.
func testApp(t *testing.T) (*httptest.Server, *app, string) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	return startApp(t, dbPath, t.TempDir())
}

func startApp(t *testing.T, dbPath, staticDir string) (*httptest.Server, *app, string) {
	t.Helper()
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	a := newApp(staticDir, st)
	srv := httptest.NewServer(a.Handler())
	t.Cleanup(func() {
		srv.Close()
		a.Close()
		st.Close()
	})
	return srv, a, dbPath
}

func TestHealthz(t *testing.T) {
	srv, _, _ := testApp(t)

	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /healthz = %d, want %d", resp.StatusCode, http.StatusOK)
	}
}
