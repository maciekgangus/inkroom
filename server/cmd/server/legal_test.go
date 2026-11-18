package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func fetch(t *testing.T, srv *httptest.Server, path string) (*http.Response, string) {
	t.Helper()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Get(srv.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

func TestLegalPagesArePublicHTML(t *testing.T) {
	srv, _, _ := testApp(t) // an empty static dir: the pages must not depend on the SPA
	for path, title := range map[string]string{"/privacy": "Polityka prywatności", "/terms": "Regulamin"} {
		resp, body := fetch(t, srv, path)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET %s = %d, want 200", path, resp.StatusCode)
		}
		if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
			t.Errorf("%s Content-Type = %q", path, ct)
		}
		for _, want := range []string{`lang="pl"`, title, "Privacy", `href="/privacy"`, `href="/terms"`, `href="/"`} {
			if !strings.Contains(body, want) && !(path == "/terms" && want == "Privacy") {
				t.Errorf("%s lacks %q", path, want)
			}
		}
		if strings.Contains(body, "<script") {
			t.Errorf("%s must work without JavaScript", path)
		}
	}
}

func TestLegalPagesNameTheOperator(t *testing.T) {
	srv, a, _ := testApp(t)
	a.configureLegal("Jan Kowalski", "kontakt@example.com")
	for _, path := range []string{"/privacy", "/terms"} {
		_, body := fetch(t, srv, path)
		if !strings.Contains(body, "Jan Kowalski") || !strings.Contains(body, "kontakt@example.com") {
			t.Errorf("%s does not show the operator", path)
		}
	}
}

func TestLegalPagesWithoutOperatorShowAPlaceholder(t *testing.T) {
	srv, _, _ := testApp(t)
	_, body := fetch(t, srv, "/privacy")
	if !strings.Contains(body, "Dane operatora nie zostały jeszcze uzupełnione") {
		t.Error("no placeholder when the operator is not configured")
	}
}

func TestLegalPagesEscapeTheOperator(t *testing.T) {
	srv, a, _ := testApp(t)
	a.configureLegal("<script>x</script>", "a@b.c")
	_, body := fetch(t, srv, "/terms")
	if strings.Contains(body, "<script>x") {
		t.Error("the operator name is not escaped")
	}
}
