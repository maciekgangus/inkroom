package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func turnstileServer(t *testing.T, success bool, got *map[string]string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if got != nil {
			*got = map[string]string{"secret": r.Form.Get("secret"), "response": r.Form.Get("response"), "remoteip": r.Form.Get("remoteip")}
		}
		if success {
			_, _ = w.Write([]byte(`{"success":true}`))
			return
		}
		_, _ = w.Write([]byte(`{"success":false,"error-codes":["invalid-input-response"]}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestTurnstileAcceptsATokenCloudflareApproves(t *testing.T) {
	var got map[string]string
	srv := turnstileServer(t, true, &got)
	v := Turnstile{Secret: "s3cret", URL: srv.URL}
	if err := v.Verify(context.Background(), "tok", "203.0.113.5"); err != nil {
		t.Fatal(err)
	}
	if got["secret"] != "s3cret" || got["response"] != "tok" || got["remoteip"] != "203.0.113.5" {
		t.Fatalf("sent %v", got)
	}
}

func TestTurnstileRejectsTokensCloudflareRefusesAndEmptyOnes(t *testing.T) {
	srv := turnstileServer(t, false, nil)
	v := Turnstile{Secret: "s", URL: srv.URL}
	if err := v.Verify(context.Background(), "tok", ""); err == nil {
		t.Fatal("a refused token was accepted")
	}
	if err := v.Verify(context.Background(), "  ", ""); err == nil {
		t.Fatal("an empty token was accepted")
	}
}

func TestTurnstileFailsClosedWhenCloudflareCannotBeReached(t *testing.T) {
	srv := turnstileServer(t, true, nil)
	url := srv.URL
	srv.Close()
	if err := (Turnstile{Secret: "s", URL: url}).Verify(context.Background(), "tok", ""); err == nil {
		t.Fatal("an unreachable verifier let a token through")
	}
}
