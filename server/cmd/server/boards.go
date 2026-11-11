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

// getBoard tells whether a board exists and whether the caller owns it (anyone with the link may ask).
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
	a.ensureGuestCookie(w, r)
	u, loggedIn := a.auth.User(r)
	writeJSON(w, http.StatusOK, map[string]any{"id": b.ID, "name": b.Name, "owner": loggedIn && u.ID == b.OwnerID})
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
	a.hub.SetName(b.ID, name) // everyone on the board sees the new name at once
	w.WriteHeader(http.StatusNoContent)
}

// setBackground lets the owner change the board's background; everyone on the board sees it at once.
func (a *app) setBackground(w http.ResponseWriter, r *http.Request) {
	b, ok := a.ownedBoard(w, r)
	if !ok || !auth.RequireJSON(w, r) {
		return
	}
	var body struct {
		Background string `json:"background"`
	}
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body)
	if err != nil || !store.ValidBackground(body.Background) {
		writeError(w, http.StatusBadRequest, "Nieznane tło")
		return
	}
	if err := a.st.SetBoardBackground(b.ID, body.Background); err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	a.hub.SetBackground(b.ID, body.Background)
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

// Limits of a saved view: the zoom the board allows and a generous reach for the position.
const (
	minViewScale = 0.1
	maxViewScale = 5
	maxViewReach = 1e7
)

func validView(v store.View) bool {
	in := func(n, limit float64) bool { return n >= -limit && n <= limit } // false for NaN too
	return in(v.X, maxViewReach) && in(v.Y, maxViewReach) &&
		v.Scale >= minViewScale && v.Scale <= maxViewScale
}

// getView returns where the logged-in user last looked on the board; 204 if never saved.
func (a *app) getView(w http.ResponseWriter, r *http.Request) {
	u, ok := a.auth.User(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Zaloguj się")
		return
	}
	v, err := a.st.View(u.ID, r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusOK, map[string]float64{"x": v.X, "y": v.Y, "scale": v.Scale})
}

// setView remembers where the logged-in user is looking on the board.
func (a *app) setView(w http.ResponseWriter, r *http.Request) {
	u, ok := a.auth.User(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Zaloguj się")
		return
	}
	if !auth.RequireJSON(w, r) {
		return
	}
	id := r.PathValue("id")
	if _, err := a.st.Board(id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "Nie ma takiej tablicy")
		} else {
			writeError(w, http.StatusInternalServerError, "Błąd serwera")
		}
		return
	}
	var v store.View
	var body struct {
		X     float64 `json:"x"`
		Y     float64 `json:"y"`
		Scale float64 `json:"scale"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	v = store.View{X: body.X, Y: body.Y, Scale: body.Scale}
	if !validView(v) {
		writeError(w, http.StatusBadRequest, "Nieprawidłowy widok")
		return
	}
	if err := a.st.SetView(u.ID, id, v); err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
