package main

import (
	"net/http"
	"strings"

	"github.com/maciekgangus/inkroom/server/internal/auth"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

// changePassword sets a new password for the logged-in account after checking the current one
// (R-085). An account that signs in only with Google has no password to change.
func (a *app) changePassword(w http.ResponseWriter, r *http.Request) {
	u, ok := a.accountUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	if !readBody(w, r, &body) {
		return
	}
	if u.Hash == "" {
		writeError(w, http.StatusBadRequest, "To konto nie ma hasła (logowanie przez Google)")
		return
	}
	if !auth.VerifyPassword(u.Hash, body.Current) {
		writeError(w, http.StatusForbidden, "Obecne hasło jest nieprawidłowe")
		return
	}
	if len(body.New) < auth.MinPassword || len(body.New) > auth.MaxPassword {
		writeError(w, http.StatusBadRequest, "Nowe hasło ma mieć co najmniej 8 znaków")
		return
	}
	hash, err := auth.HashPassword(body.New)
	if err != nil || a.st.SetPassword(u.ID, hash) != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// deleteAccount removes the logged-in account with its boards, sessions and visits (R-085). The
// body must carry the account's username, typed by the person, as a check against a slip.
func (a *app) deleteAccount(w http.ResponseWriter, r *http.Request) {
	u, ok := a.accountUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Confirm string `json:"confirm"`
	}
	if !readBody(w, r, &body) {
		return
	}
	if !strings.EqualFold(strings.TrimSpace(body.Confirm), u.Username) {
		writeError(w, http.StatusBadRequest, "Wpisz dokładną nazwę konta, żeby potwierdzić")
		return
	}
	boards, err := a.st.BoardsOwnedBy(u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	for _, b := range boards {
		a.hub.Delete(b.ID) // disconnect everyone and drop unsaved changes first
	}
	if err := a.st.DeleteUser(u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	a.auth.ClearCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

// accountUser returns the logged-in user of a JSON request, answering 415 or 401 otherwise.
func (a *app) accountUser(w http.ResponseWriter, r *http.Request) (store.User, bool) {
	if !auth.RequireJSON(w, r) {
		return store.User{}, false
	}
	u, in := a.auth.User(r)
	if !in {
		writeError(w, http.StatusUnauthorized, "Nie jesteś zalogowany")
	}
	return u, in
}
