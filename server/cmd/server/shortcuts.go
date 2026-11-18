package main

import (
	"encoding/json"
	"net/http"

	"github.com/maciekgangus/inkroom/server/internal/auth"
)

const (
	maxShortcuts   = 32 // tools that may carry a key
	maxShortcutLen = 32 // characters of a tool name or a key code
)

// getShortcuts returns the account's own keyboard shortcuts (R-086).
func (a *app) getShortcuts(w http.ResponseWriter, r *http.Request) {
	u, ok := a.auth.User(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Nie jesteś zalogowany")
		return
	}
	js, err := a.st.Shortcuts(u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(`{"shortcuts":` + js + `}`))
}

// putShortcuts replaces them (an empty object brings the defaults back).
func (a *app) putShortcuts(w http.ResponseWriter, r *http.Request) {
	u, ok := a.accountUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Shortcuts map[string]string `json:"shortcuts"`
	}
	if !readBody(w, r, &body) {
		return
	}
	if len(body.Shortcuts) > maxShortcuts {
		writeError(w, http.StatusBadRequest, "Za dużo skrótów")
		return
	}
	for tool, code := range body.Shortcuts {
		if tool == "" || len(tool) > maxShortcutLen || code == "" || len(code) > maxShortcutLen {
			writeError(w, http.StatusBadRequest, "Nieprawidłowy skrót")
			return
		}
	}
	js, _ := json.Marshal(body.Shortcuts)
	if body.Shortcuts == nil {
		js = []byte("{}")
	}
	if err := a.st.SetShortcuts(u.ID, string(js)); err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
