package main

import (
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

// Lesson recording, stage 1 (R-112): the browser records the screen and the microphone and sends
// the video in chunks to this server, which appends them to a file in recDir. Anyone logged in
// may record, list and download; only the one who started a recording adds to it. The bucket of
// R-094 replaces this later.

const (
	maxRecordingChunk = 32 << 20 // one chunk is a few seconds of video; this only stops abuse
	maxRecordingName  = 100
)

// recordingTypes are the containers MediaRecorder produces, with the extension of the file kept.
var recordingTypes = map[string]string{"video/webm": ".webm", "video/mp4": ".mp4"}

// configureRecordings sets the directory the lesson recordings are written to (R-112).
func (a *app) configureRecordings(dir string) { a.recDir = dir }

// recordingType reduces "video/webm;codecs=vp9,opus" to a known container; ok is false for others.
func recordingType(s string) (typ string, ok bool) {
	typ, _, _ = strings.Cut(s, ";")
	typ = strings.ToLower(strings.TrimSpace(typ))
	_, ok = recordingTypes[typ]
	return typ, ok
}

func (a *app) recordingPath(r store.Recording) string {
	return filepath.Join(a.recDir, r.ID+recordingTypes[r.Mime])
}

// recordingFiles lists the files of every recording of the boards, to be removed with them.
func (a *app) recordingFiles(boardIDs ...string) []string {
	var paths []string
	for _, id := range boardIDs {
		recs, err := a.st.RecordingsOf(id)
		if err != nil {
			slog.Warn("listing recordings to remove", "err", err)
			continue
		}
		for _, r := range recs {
			paths = append(paths, a.recordingPath(r))
		}
	}
	return paths
}

// removeFiles deletes files once the rows that described them are gone.
func removeFiles(paths []string) {
	for _, p := range paths {
		if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
			slog.Warn("removing a recording file", "err", err)
		}
	}
}

// recordingRequest checks the caller is logged in and finds the recording named in the URL on the
// board named in the URL.
func (a *app) recordingRequest(w http.ResponseWriter, r *http.Request) (store.User, store.Recording, bool) {
	u, ok := a.auth.User(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Nie jesteś zalogowany")
		return store.User{}, store.Recording{}, false
	}
	b, ok := a.boardFromURL(w, r)
	if !ok {
		return store.User{}, store.Recording{}, false
	}
	rec, err := a.st.Recording(b.ID, r.PathValue("rec"))
	if err != nil {
		storeFail(w, err, "Nie ma takiego nagrania")
		return store.User{}, store.Recording{}, false
	}
	return u, rec, true
}

func (a *app) startRecording(w http.ResponseWriter, r *http.Request) {
	u, ok := a.auth.User(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Nie jesteś zalogowany")
		return
	}
	board, ok := a.boardFromURL(w, r)
	if !ok {
		return
	}
	var body struct {
		Name string `json:"name"`
		Mime string `json:"mime"`
	}
	if !readBody(w, r, &body) {
		return
	}
	typ, ok := recordingType(body.Mime)
	if !ok {
		writeError(w, http.StatusBadRequest, "Nieobsługiwany format nagrania")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "Nagranie"
	}
	if utf8.RuneCountInString(name) > maxRecordingName {
		name = string([]rune(name)[:maxRecordingName])
	}
	if err := os.MkdirAll(a.recDir, 0o755); err != nil {
		slog.Error("creating the recordings directory", "err", err)
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	rec := store.Recording{ID: newBoardID(), BoardID: board.ID, UserID: u.ID, Name: name, Mime: typ, CreatedAt: time.Now()}
	if err := a.st.CreateRecording(rec); err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": rec.ID})
}

// recordingChunk appends the body to the file when `offset` is where the file ends. A chunk that
// was already stored (the answer got lost) or one after a gap gets 409 with the current size, so
// the client knows where to go on and the file never holds a chunk twice.
func (a *app) recordingChunk(w http.ResponseWriter, r *http.Request) {
	u, rec, ok := a.recordingRequest(w, r)
	if !ok {
		return
	}
	if rec.UserID != u.ID {
		writeError(w, http.StatusForbidden, "To nie Twoje nagranie")
		return
	}
	if rec.Finished {
		writeError(w, http.StatusConflict, "Nagranie jest już zakończone")
		return
	}
	offset, err := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	if err != nil || offset < 0 {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRecordingChunk))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "Porcja nagrania jest za duża")
		} else {
			writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		}
		return
	}

	a.recMu.Lock()
	defer a.recMu.Unlock()
	f, err := os.OpenFile(a.recordingPath(rec), os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		slog.Error("opening a recording file", "err", err)
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	if size := info.Size(); size != offset {
		writeJSON(w, http.StatusConflict, map[string]int64{"size": size})
		return
	}
	if _, err := f.WriteAt(data, offset); err != nil {
		_ = f.Truncate(offset) // no half chunk: the retry starts at the same place
		slog.Error("writing a recording chunk", "err", err)
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	if err := a.st.SetRecordingBytes(rec.ID, offset+int64(len(data))); err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) finishRecording(w http.ResponseWriter, r *http.Request) {
	u, rec, ok := a.recordingRequest(w, r)
	if !ok {
		return
	}
	if rec.UserID != u.ID {
		writeError(w, http.StatusForbidden, "To nie Twoje nagranie")
		return
	}
	var body struct {
		DurationMs int64 `json:"durationMs"`
	}
	if !readBody(w, r, &body) {
		return
	}
	if body.DurationMs < 0 {
		body.DurationMs = 0
	}
	a.recMu.Lock()
	defer a.recMu.Unlock()
	var size int64
	if info, err := os.Stat(a.recordingPath(rec)); err == nil {
		size = info.Size()
	}
	if err := a.st.FinishRecording(rec.ID, body.DurationMs, size); err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type recordingJSON struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Mime       string `json:"mime"`
	CreatedAt  string `json:"createdAt"`
	DurationMs int64  `json:"durationMs"`
	Bytes      int64  `json:"bytes"`
	Finished   bool   `json:"finished"`
}

func (a *app) listRecordings(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.auth.User(r); !ok {
		writeError(w, http.StatusUnauthorized, "Nie jesteś zalogowany")
		return
	}
	board, ok := a.boardFromURL(w, r)
	if !ok {
		return
	}
	recs, err := a.st.RecordingsOf(board.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	out := make([]recordingJSON, 0, len(recs))
	for _, rec := range recs {
		out = append(out, recordingJSON{ID: rec.ID, Name: rec.Name, Mime: rec.Mime, CreatedAt: iso(rec.CreatedAt),
			DurationMs: rec.DurationMs, Bytes: rec.Bytes, Finished: rec.Finished})
	}
	writeJSON(w, http.StatusOK, out)
}

// downloadRecording sends the file as an attachment. ServeContent gives it Range support, so a
// download can resume.
func (a *app) downloadRecording(w http.ResponseWriter, r *http.Request) {
	_, rec, ok := a.recordingRequest(w, r)
	if !ok {
		return
	}
	f, err := os.Open(a.recordingPath(rec))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	h := w.Header()
	h.Set("Content-Type", rec.Mime)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, no-store")
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": fileName(rec.Name) + recordingTypes[rec.Mime]})
	if disposition == "" {
		disposition = "attachment"
	}
	h.Set("Content-Disposition", disposition)
	http.ServeContent(w, r, "", info.ModTime(), f)
}

// fileName turns a recording's name into something safe to offer as a file name.
func fileName(name string) string {
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || strings.ContainsRune(`/\:*?"<>|`, r) {
			return ' '
		}
		return r
	}, name)
	if name = strings.TrimSpace(name); name == "" {
		return "nagranie"
	}
	return name
}
