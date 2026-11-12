package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/maciekgangus/inkroom/server/internal/auth"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

const (
	maxFeedback     = 2000 // characters in a note
	feedbackPerHour = 10   // notes one person may send in an hour (R-062)
	maxFeedbackBody = 16 << 10
	maxFeedbackMeta = 300 // characters kept of the page, screen and name
)

// clip trims s and cuts it to at most n characters.
func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > n {
		s = string([]rune(s)[:n])
	}
	return s
}

// sendFeedback saves a note from the feedback button (R-062). Anyone may send one, a guest too;
// a logged-in person is known by their account whatever the body says.
func (a *app) sendFeedback(w http.ResponseWriter, r *http.Request) {
	if !auth.RequireJSON(w, r) {
		return
	}
	var body struct {
		Message string `json:"message"`
		Page    string `json:"page"`
		Screen  string `json:"screen"`
		Name    string `json:"name"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxFeedbackBody)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	msg := strings.TrimSpace(body.Message)
	if msg == "" || utf8.RuneCountInString(msg) > maxFeedback {
		writeError(w, http.StatusBadRequest, "Uwaga musi mieć od 1 do 2000 znaków")
		return
	}
	u, loggedIn := a.auth.User(r)
	person := a.person(r, u, loggedIn, "")
	now := time.Now()
	n, err := a.st.CountFeedbackSince(person, now.Add(-time.Hour))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	if n >= feedbackPerHour {
		writeError(w, http.StatusTooManyRequests, "Za dużo uwag naraz, spróbuj za godzinę")
		return
	}
	f := store.Feedback{
		At: now, Person: person, Message: msg,
		Name:      clip(body.Name, maxFeedbackMeta),
		Page:      clip(body.Page, maxFeedbackMeta),
		Screen:    clip(body.Screen, maxFeedbackMeta),
		UserAgent: clip(r.UserAgent(), maxFeedbackMeta),
	}
	if loggedIn {
		f.UserID, f.Name = u.ID, u.Username
	}
	if err := a.st.AddFeedback(f); err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}
