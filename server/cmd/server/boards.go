package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
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
	// Owner is the owner's username, given for boards of other people only (R-051).
	Owner string `json:"owner,omitempty"`
}

func toJSON(boards []store.Board) []boardJSON {
	out := make([]boardJSON, 0, len(boards))
	for _, b := range boards {
		out = append(out, boardJSON{ID: b.ID, Name: b.Name, UpdatedAt: b.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z"), Owner: b.OwnerName})
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

// copyName is the name of a copy of a board: the name with " (kopia)", cut to fit.
func copyName(name string) string {
	const suffix = " (kopia)"
	if r := []rune(name); len(r) > maxBoardName-len([]rune(suffix)) {
		name = string(r[:maxBoardName-len([]rune(suffix))])
	}
	return name + suffix
}

// copyBoard makes the owner a new board holding everything on this one (R-020): a manual backup
// before a change, or a starting point for the next lesson. The copy has its own link.
func (a *app) copyBoard(w http.ResponseWriter, r *http.Request) {
	if !auth.RequireJSON(w, r) {
		return
	}
	b, ok := a.ownedBoard(w, r)
	if !ok {
		return
	}
	u, _ := a.auth.User(r)
	a.copyTo(w, b, u.ID)
}

// copyTo copies a board for the given owner and answers with the new board's id and name.
func (a *app) copyTo(w http.ResponseWriter, b store.Board, ownerID int64) {
	a.hub.Flush() // what people drew a moment ago may not be in the database yet
	cp, err := a.st.CopyBoard(b.ID, newBoardID(), ownerID, copyName(b.Name), newBoardID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": cp.ID, "name": cp.Name})
}

// boardPreview gives what a client needs to draw a small picture of a board (R-052): its
// background and its strokes, as saved. Like the board itself it is open to whoever has the link.
// The answer carries an ETag made of the board's last change, so a client that already has the
// picture of this version is told "not modified" and nothing is sent again.
func (a *app) boardPreview(w http.ResponseWriter, r *http.Request) {
	b, err := a.st.Board(r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Nie ma takiej tablicy")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	etag := previewTag(b)
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	raw, err := a.st.LoadStrokes(b.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	strokes := make([]json.RawMessage, 0, len(raw))
	for _, s := range raw {
		strokes = append(strokes, s)
	}
	writeJSON(w, http.StatusOK, map[string]any{"background": b.Background, "strokes": strokes})
}

// previewTag names a version of a board for its preview: it changes when the board does.
func previewTag(b store.Board) string {
	return `"` + strconv.FormatInt(b.UpdatedAt.Unix(), 10) + "-" + b.Background + `"`
}

// Limits of a stored preview picture (R-088): a tile is at most 480 px, so this is generous.
const maxPreviewBytes = 300 << 10

var pngSignature = []byte("\x89PNG\r\n\x1a\n")

// boardPreviewPicture serves the stored picture of a board for its tile (R-088), or 404 when
// there is none for the board's current version; the client then draws it from the strokes.
// Open to whoever has the link, like the preview data; the ETag is the board's version.
func (a *app) boardPreviewPicture(w http.ResponseWriter, r *http.Request) {
	b, err := a.st.Board(r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Nie ma takiej tablicy")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	tag := previewTag(b)
	png, err := a.st.Preview(b.ID, tag)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Brak podglądu")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	w.Header().Set("ETag", tag)
	w.Header().Set("Cache-Control", "private, no-cache")
	if r.Header.Get("If-None-Match") == tag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	_, _ = w.Write(png)
}

// setBoardPreviewPicture stores the picture a client drew of a board (R-088): the server only
// keeps bytes, so no drawing costs it CPU. Only the owner may, only for the version the picture
// was drawn from (`tag`), and only a PNG within the limit.
func (a *app) setBoardPreviewPicture(w http.ResponseWriter, r *http.Request) {
	b, ok := a.ownedBoard(w, r)
	if !ok {
		return
	}
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "image/png" {
		writeError(w, http.StatusUnsupportedMediaType, "Oczekiwano image/png")
		return
	}
	png, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxPreviewBytes))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "Podgląd jest za duży")
		return
	}
	if !bytes.HasPrefix(png, pngSignature) {
		writeError(w, http.StatusBadRequest, "To nie jest PNG")
		return
	}
	tag := r.URL.Query().Get("tag")
	if tag != previewTag(b) {
		writeError(w, http.StatusConflict, "Tablica zmieniła się od narysowania podglądu")
		return
	}
	if err := a.st.SetPreview(b.ID, tag, png); err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// forgetBoard takes a board off the caller's list of boards they were invited to (R-051). The
// board stays as it is, and opening its link again lists it again.
func (a *app) forgetBoard(w http.ResponseWriter, r *http.Request) {
	if !auth.RequireJSON(w, r) {
		return
	}
	u, ok := a.auth.User(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Nie jesteś zalogowany")
		return
	}
	if err := a.st.RemoveVisit(u.ID, r.PathValue("id")); err != nil {
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
