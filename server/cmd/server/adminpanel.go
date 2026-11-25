package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/maciekgangus/inkroom/server/internal/auth"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

// The users and boards views of the admin panel (R-065).

func iso(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// storeFail answers a failed store call the way the rest of the API does: 404 with the given
// message when the row is missing, 500 otherwise.
func storeFail(w http.ResponseWriter, err error, missing string) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, missing)
		return
	}
	writeError(w, http.StatusInternalServerError, "Błąd serwera")
}

// pathID reads a numeric id from the URL; a bad one is answered with 400.
func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return 0, false
	}
	return id, true
}

// readBody decodes a small JSON body into v; a bad one is answered with 400.
func readBody(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return false
	}
	return true
}

func (a *app) adminListUsers(w http.ResponseWriter, _ *http.Request) {
	users, err := a.st.AdminUsers()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	out := make([]map[string]any, 0, len(users))
	for _, u := range users {
		out = append(out, map[string]any{
			"id": u.ID, "email": u.Email, "username": u.Username, "createdAt": iso(u.CreatedAt),
			"owned": u.Owned, "visited": u.Visited, "lastActive": iso(u.LastActive), "bytes": u.Bytes,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *app) adminListBoards(w http.ResponseWriter, _ *http.Request) {
	boards, err := a.st.AdminBoards()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	out := make([]map[string]any, 0, len(boards))
	for _, b := range boards {
		out = append(out, map[string]any{
			"id": b.ID, "name": b.Name, "ownerId": b.OwnerID, "owner": b.Owner,
			"createdAt": iso(b.CreatedAt), "updatedAt": iso(b.UpdatedAt),
			"strokes": b.Strokes, "images": b.Images, "bytes": b.Bytes, "visitors": b.Visitors,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *app) adminRenameUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	var body struct {
		Username string `json:"username"`
	}
	if !ok || !readBody(w, r, &body) {
		return
	}
	if !auth.ValidUsername(body.Username) {
		writeError(w, http.StatusBadRequest, "Nazwa użytkownika ma mieć od 3 do 24 znaków: litery a-z, cyfry, kropka, myślnik lub podkreślnik")
		return
	}
	switch err := a.st.RenameUser(id, body.Username); {
	case errors.Is(err, store.ErrUsernameReserved):
		writeError(w, http.StatusBadRequest, "Ta nazwa użytkownika jest zarezerwowana")
	case errors.Is(err, store.ErrUsernameTaken):
		writeError(w, http.StatusConflict, "Ta nazwa użytkownika jest zajęta")
	default:
		a.adminDone(w, err)
	}
}

func (a *app) adminLogoutUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	a.adminDone(w, a.st.DeleteUserSessions(id))
}

// adminDeleteUser removes an account and its boards. The body must carry the account's username,
// typed by the admin, as a check that the right account is meant.
func (a *app) adminDeleteUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	var body struct {
		Confirm string `json:"confirm"`
	}
	if !ok || !readBody(w, r, &body) {
		return
	}
	users, err := a.st.AdminUsers()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	var name string
	for _, u := range users {
		if u.ID == id {
			name = u.Username
		}
	}
	if name == "" {
		writeError(w, http.StatusNotFound, "Nie ma takiego użytkownika")
		return
	}
	if body.Confirm != name {
		writeError(w, http.StatusBadRequest, "Wpisz dokładną nazwę użytkownika, żeby potwierdzić")
		return
	}
	boards, err := a.st.BoardsOwnedBy(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	var files []string
	for _, b := range boards {
		a.hub.Delete(b.ID) // disconnect everyone and drop unsaved changes first
		files = append(files, a.recordingFiles(b.ID)...)
	}
	err = a.st.DeleteUser(id)
	if err == nil {
		removeFiles(files)
	}
	a.adminDone(w, err)
}

func (a *app) adminRenameBoard(w http.ResponseWriter, r *http.Request) {
	b, ok := a.boardFromURL(w, r)
	if !ok {
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if !readBody(w, r, &body) {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || utf8.RuneCountInString(name) > maxBoardName {
		writeError(w, http.StatusBadRequest, "Nazwa musi mieć od 1 do 100 znaków")
		return
	}
	if err := a.st.RenameBoard(b.ID, name); err != nil {
		storeFail(w, err, "Nie ma takiej tablicy")
		return
	}
	a.hub.SetName(b.ID, name) // everyone on the board sees the new name at once
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) adminSetOwner(w http.ResponseWriter, r *http.Request) {
	b, ok := a.boardFromURL(w, r)
	var body struct {
		UserID int64 `json:"userId"`
	}
	if !ok || !readBody(w, r, &body) {
		return
	}
	a.adminDone(w, a.st.SetBoardOwner(b.ID, body.UserID))
}

// adminCopyBoard makes a copy of the board for the same owner (R-020).
func (a *app) adminCopyBoard(w http.ResponseWriter, r *http.Request) {
	b, ok := a.boardFromURL(w, r)
	if !ok {
		return
	}
	a.copyTo(w, b, b.OwnerID)
}

func (a *app) adminDeleteBoard(w http.ResponseWriter, r *http.Request) {
	b, ok := a.boardFromURL(w, r)
	if !ok {
		return
	}
	a.hub.Delete(b.ID) // disconnect everyone and drop unsaved changes first
	files := a.recordingFiles(b.ID)
	err := a.st.DeleteBoard(b.ID)
	if err == nil {
		removeFiles(files)
	}
	a.adminDone(w, err)
}

// adminEnterBoard gives the address to open the board as the Administrator: the board's own link
// with a signed ticket, which lets the page appear under the reserved name.
func (a *app) adminEnterBoard(w http.ResponseWriter, r *http.Request) {
	b, ok := a.boardFromURL(w, r)
	if !ok {
		return
	}
	ticket := a.makeAdminTicket(b.ID, time.Now().Add(adminTicketTTL))
	writeJSON(w, http.StatusOK, map[string]string{"url": "/b/" + b.ID + "?admin=" + ticket})
}
