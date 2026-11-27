package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

type contactJSON struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Avatar   string `json:"avatar,omitempty"`
	Saved    bool   `json:"saved"`
	Source   string `json:"source"`
	Relation string `json:"relation,omitempty"`
}

func contactsToJSON(list []store.ContactSuggestion) []contactJSON {
	out := make([]contactJSON, 0, len(list))
	for _, c := range list {
		out = append(out, contactJSON{
			ID:       c.UserID,
			Username: c.Username,
			Avatar:   c.Avatar,
			Saved:    c.Saved,
			Source:   c.Source,
			Relation: c.Relation,
		})
	}
	return out
}

func (a *app) listContacts(w http.ResponseWriter, r *http.Request) {
	u, ok := a.auth.User(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Nie jesteś zalogowany")
		return
	}
	list, err := a.st.ListContactSuggestions(u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"contacts": contactsToJSON(list)})
}

func (a *app) addContact(w http.ResponseWriter, r *http.Request) {
	u, ok := a.accountUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Login  string `json:"login"`
		UserID int64  `json:"userId"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	login := strings.TrimSpace(body.Login)
	var target store.User
	var err error
	if body.UserID > 0 {
		// By id only people the caller already knows, or every account's name would be a loop away
		// (R-053, R-123); an unrelated id gets the same answer as a missing one.
		target, err = a.st.UserByID(body.UserID)
		if err == nil {
			var ok bool
			if ok, err = a.connectedTo(u.ID, target.ID); err == nil && !ok {
				err = store.ErrNotFound
			}
		}
	} else {
		if login == "" {
			writeError(w, http.StatusBadRequest, "Podaj nazwę użytkownika lub adres e-mail")
			return
		}
		target, err = a.st.UserByLogin(login)
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Nie ma takiego konta")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	if err := a.st.AddContact(u.ID, target.ID, time.Now()); err != nil {
		switch {
		case errors.Is(err, store.ErrSelfContact):
			writeError(w, http.StatusBadRequest, "Nie możesz dodać siebie do znajomych")
		case errors.Is(err, store.ErrAlreadyContact):
			writeError(w, http.StatusConflict, "Ta osoba jest już w Twoich znajomych")
		default:
			writeError(w, http.StatusInternalServerError, "Błąd serwera")
		}
		return
	}
	list, err := a.st.ListContactSuggestions(u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"contact": contactJSON{
			ID:       target.ID,
			Username: target.Username,
			Avatar:   target.Avatar,
			Saved:    true,
			Source:   "contact",
		},
		"contacts": contactsToJSON(list),
	})
}

func (a *app) removeContact(w http.ResponseWriter, r *http.Request) {
	u, ok := a.auth.User(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Nie jesteś zalogowany")
		return
	}
	targetID, err := strconv.ParseInt(r.PathValue("userId"), 10, 64)
	if err != nil || targetID <= 0 {
		writeError(w, http.StatusBadRequest, "Nieprawidłowy identyfikator użytkownika")
		return
	}
	if err := a.st.RemoveContact(u.ID, targetID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "Tej osoby nie ma w Twoich znajomych")
			return
		}
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	list, err := a.st.ListContactSuggestions(u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"contacts": contactsToJSON(list)})
}

// connectedTo reports whether target is someone caller already knows: a saved contact, a
// collaborator from ListContactSuggestions, or a person on the same live board (R-122, R-123).
func (a *app) connectedTo(callerID, targetID int64) (bool, error) {
	if a.hub.SharesRoom(callerID, targetID) {
		return true, nil
	}
	list, err := a.st.ListContactSuggestions(callerID)
	if err != nil {
		return false, err
	}
	for _, c := range list {
		if c.UserID == targetID {
			return true, nil
		}
	}
	return false, nil
}
