package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/maciekgangus/inkroom/server/internal/auth"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

const (
	defaultBoardName = "Nowa tablica"
	maxBoardName     = 100
	maxBodyBytes     = 4 << 10
)

type boardJSON struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	UpdatedAt string `json:"updatedAt"`
}

func toJSON(boards []store.Board) []boardJSON {
	out := make([]boardJSON, 0, len(boards))
	for _, b := range boards {
		out = append(out, boardJSON{ID: b.ID, Name: b.Name, UpdatedAt: b.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z")})
	}
	return out
}

// newBoardID returns a 128-bit random hex identifier, the board's secret link.
func newBoardID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// readName reads {"name": "..."} and validates it; an empty name becomes the default if allowEmpty.
func readName(w http.ResponseWriter, r *http.Request, allowEmpty bool) (string, bool) {
	if !auth.RequireJSON(w, r) {
		return "", false
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return "", false
	}
	name := strings.TrimSpace(body.Name)
	if name == "" && allowEmpty {
		name = defaultBoardName
	}
	if name == "" || utf8.RuneCountInString(name) > maxBoardName {
		writeError(w, http.StatusBadRequest, "Nazwa musi mieć od 1 do 100 znaków")
		return "", false
	}
	return name, true
}

func (a *app) createBoard(w http.ResponseWriter, r *http.Request) {
	u, ok := a.auth.User(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Zaloguj się, aby utworzyć tablicę")
		return
	}
	name, ok := readName(w, r, true)
	if !ok {
		return
	}
	b, err := a.st.CreateBoard(newBoardID(), u.ID, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": b.ID, "name": b.Name})
}

func (a *app) listBoards(w http.ResponseWriter, r *http.Request) {
	u, ok := a.auth.User(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Nie jesteś zalogowany")
		return
	}
	owned, err1 := a.st.BoardsOwnedBy(u.ID)
	visited, err2 := a.st.BoardsVisitedBy(u.ID)
	if err1 != nil || err2 != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"owned": toJSON(owned), "visited": toJSON(visited)})
}

// getBoard tells whether a board exists (anyone with the link may ask).
func (a *app) getBoard(w http.ResponseWriter, r *http.Request) {
	b, err := a.st.Board(r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Nie ma takiej tablicy")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": b.ID, "name": b.Name})
}

// ownedBoard loads the board named in the URL and checks that the caller owns it.
func (a *app) ownedBoard(w http.ResponseWriter, r *http.Request) (store.Board, bool) {
	u, ok := a.auth.User(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Nie jesteś zalogowany")
		return store.Board{}, false
	}
	b, err := a.st.Board(r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Nie ma takiej tablicy")
		return store.Board{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return store.Board{}, false
	}
	if b.OwnerID != u.ID {
		writeError(w, http.StatusForbidden, "Tylko właściciel może to zrobić")
		return store.Board{}, false
	}
	return b, true
}

func (a *app) renameBoard(w http.ResponseWriter, r *http.Request) {
	b, ok := a.ownedBoard(w, r)
	if !ok {
		return
	}
	name, ok := readName(w, r, false)
	if !ok {
		return
	}
	if err := a.st.RenameBoard(b.ID, name); err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) deleteBoard(w http.ResponseWriter, r *http.Request) {
	b, ok := a.ownedBoard(w, r)
	if !ok {
		return
	}
	a.hub.Delete(b.ID) // disconnect everyone and drop unsaved changes first
	if err := a.st.DeleteBoard(b.ID); err != nil && !errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
