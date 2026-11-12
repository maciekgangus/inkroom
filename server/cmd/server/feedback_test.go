package main

import (
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

func TestFeedbackFromGuestAndUser(t *testing.T) {
	srv, a, _ := startApp(t, filepath.Join(t.TempDir(), "t.db"), t.TempDir())
	_ = a
	// a guest, with no account
	resp := call(t, srv, "POST", "/api/feedback", `{"message":"  the eraser is too big ","page":"/b/abc","screen":"1024x768","name":"Ola"}`, nil)
	if status(resp) != http.StatusCreated {
		t.Fatalf("guest feedback = %d", resp.StatusCode)
	}
	u := register(t, srv, "fb@example.com")
	resp = call(t, srv, "POST", "/api/feedback", `{"message":"nice"}`, &u)
	if status(resp) != http.StatusCreated {
		t.Fatalf("user feedback = %d", resp.StatusCode)
	}
	all, err := a.st.ListFeedback(10)
	if err != nil || len(all) != 2 {
		t.Fatalf("stored %d, %v", len(all), err)
	}
	guest, user := all[1], all[0]
	if guest.Message != "the eraser is too big" || guest.Page != "/b/abc" || guest.Name != "Ola" || guest.UserID != 0 {
		t.Fatalf("guest row: %+v", guest)
	}
	if user.UserID == 0 || user.Name != "fb-user" {
		t.Fatalf("a logged-in person is known by their account, not by what the body says: %+v", user)
	}
}

func TestFeedbackIsChecked(t *testing.T) {
	srv, _, _ := startApp(t, filepath.Join(t.TempDir(), "t.db"), t.TempDir())
	for name, body := range map[string]string{
		"empty":      `{"message":"   "}`,
		"too long":   `{"message":"` + strings.Repeat("a", 2001) + `"}`,
		"not a body": `nope`,
	} {
		if got := status(call(t, srv, "POST", "/api/feedback", body, nil)); got != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400", name, got)
		}
	}
}

func TestFeedbackIsLimited(t *testing.T) {
	srv, _, _ := startApp(t, filepath.Join(t.TempDir(), "t.db"), t.TempDir())
	u := register(t, srv, "spam@example.com")
	for i := 0; i < feedbackPerHour; i++ {
		if got := status(call(t, srv, "POST", "/api/feedback", `{"message":"x"}`, &u)); got != http.StatusCreated {
			t.Fatalf("message %d = %d", i, got)
		}
	}
	if got := status(call(t, srv, "POST", "/api/feedback", `{"message":"x"}`, &u)); got != http.StatusTooManyRequests {
		t.Fatalf("over the limit = %d, want 429", got)
	}
}
