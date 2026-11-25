package main

import (
	"context"
	"errors"
	"log/slog"
	"mime"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/maciekgangus/inkroom/server/internal/logx"
	"github.com/maciekgangus/inkroom/server/internal/recstore"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

// Lesson recording (R-094, R-112). Only the board's owner records. The browser cuts the video into
// parts of recstore.PartSize and asks for the address of each: with a bucket (R2) that is a signed
// address of the bucket, so the video never passes through this server; without one it is this
// server's own address, and the part is written into a file. The list and the download need only
// access to the board.

const (
	maxRecordingName = 100
	// partTTL is how long the address of a part stays valid; downloadTTL, the address of a download.
	partTTL     = 15 * time.Minute
	downloadTTL = 5 * time.Minute
	// maxRecordingAge is the 1 h 15 min a recording may last plus five minutes to send its last
	// parts: later no part is accepted (the client ends it by itself at 1 h 15 min).
	maxRecordingAge = 80 * time.Minute
	// idleRecording is how long an unfinished recording may be silent before the server finishes it
	// with the parts that arrived; the sweep runs every sweepEvery.
	idleRecording = 15 * time.Minute
	sweepEvery    = 5 * time.Minute
	// The event log: the most segments (about one every 10 s for 80 minutes, with room to spare) and
	// the largest object (the starting state of a big board).
	maxEventSegments = 2000
	maxEventObject   = 64 << 20
	// A call to the bucket gives up after this long.
	bucketTimeout = 30 * time.Second
)

// recordingTypes are the containers MediaRecorder produces for the sound (R-113), with the
// extension of the object kept.
var recordingTypes = map[string]string{"audio/webm": ".webm", "audio/mp4": ".mp4"}

// configureRecordings sets where the video goes: `bucket` when given (new recordings are kept
// there), otherwise the directory `dir`. The directory is always known, so recordings made
// without a bucket stay reachable after one is set up.
func (a *app) configureRecordings(dir string, bucket recstore.Backend) {
	disk := &recstore.Disk{Dir: dir}
	a.recDisk = disk
	a.recBackends = map[string]recstore.Backend{disk.Name(): disk}
	a.recNew = disk.Name()
	if bucket != nil {
		a.recBackends[bucket.Name()] = bucket
		a.recNew = bucket.Name()
	}
}

// recordingBucket connects to the bucket named in RECORDINGS_S3_* (R2: the endpoint is
// <account>.r2.cloudflarestorage.com). It returns nil, nil when none is set, and an error when
// the settings are only partly there.
func recordingBucket(getenv func(string) string) (*recstore.S3, error) {
	endpoint, bucket := getenv("RECORDINGS_S3_ENDPOINT"), getenv("RECORDINGS_S3_BUCKET")
	key, secret := getenv("RECORDINGS_S3_ACCESS_KEY"), getenv("RECORDINGS_S3_SECRET_KEY")
	if endpoint == "" && bucket == "" && key == "" && secret == "" {
		return nil, nil
	}
	if endpoint == "" || bucket == "" || key == "" || secret == "" {
		return nil, errors.New("RECORDINGS_S3_ENDPOINT, _BUCKET, _ACCESS_KEY and _SECRET_KEY must all be set")
	}
	return recstore.NewS3(endpoint, bucket, key, secret, getenv("RECORDINGS_S3_REGION"))
}

// recDir is the directory of the disk store.
func (a *app) recDir() string { return a.recDisk.Dir }

// recordingType reduces "video/webm;codecs=vp9,opus" to a known container; ok is false for others.
func recordingType(s string) (typ string, ok bool) {
	typ, _, _ = strings.Cut(s, ";")
	typ = strings.ToLower(strings.TrimSpace(typ))
	_, ok = recordingTypes[typ]
	return typ, ok
}

// All the files of a recording live under "<id>/", so one prefix removes them (ADR 0028).
func recordingKey(r store.Recording) string { return r.ID + "/audio" + recordingTypes[r.Mime] }

// eventKey is segment n of the event log; 0 is the state of the board when the recording began.
func eventKey(recID string, n int) string {
	if n == 0 {
		return recID + "/snapshot.json"
	}
	return recID + "/events/" + strconv.Itoa(n) + ".json"
}

func (a *app) backendOf(r store.Recording) (recstore.Backend, bool) {
	b, ok := a.recBackends[r.Storage]
	return b, ok
}

// ownedRecording loads the recording named in the URL on the board named in the URL and checks
// that the caller owns the board.
func (a *app) ownedRecording(w http.ResponseWriter, r *http.Request) (store.Recording, bool) {
	board, ok := a.ownedBoard(w, r)
	if !ok {
		return store.Recording{}, false
	}
	return a.recordingOf(w, board.ID, r.PathValue("rec"))
}

func (a *app) recordingOf(w http.ResponseWriter, boardID, id string) (store.Recording, bool) {
	rec, err := a.st.Recording(boardID, id)
	if err != nil {
		storeFail(w, err, "Nie ma takiego nagrania")
		return store.Recording{}, false
	}
	return rec, true
}

func (a *app) startRecording(w http.ResponseWriter, r *http.Request) {
	board, ok := a.ownedBoard(w, r)
	if !ok {
		return
	}
	u, _ := a.auth.User(r)
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
	backend := a.recBackends[a.recNew]
	now := time.Now()
	rec := store.Recording{ID: newBoardID(), BoardID: board.ID, UserID: u.ID, Name: name, Mime: typ, Storage: backend.Name(), CreatedAt: now, UpdatedAt: now}
	ctx, cancel := context.WithTimeout(r.Context(), bucketTimeout)
	defer cancel()
	uploadID, err := backend.Start(ctx, recordingKey(rec), typ)
	if err != nil {
		slog.Error("starting a recording upload", "storage", backend.Name(), "err", err)
		writeError(w, http.StatusBadGateway, "Magazyn nagrań jest niedostępny")
		return
	}
	rec.UploadID = uploadID
	if err := a.st.CreateRecording(rec); err != nil {
		_ = backend.Remove(ctx, recordingKey(rec), uploadID, false)
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": rec.ID, "partSize": recstore.PartSize})
}

// openForParts finds the recording a part (or a segment of the event log) is for and checks it
// still takes them and that its number lies in lo..hi.
func (a *app) openForParts(w http.ResponseWriter, r *http.Request, lo, hi int) (store.Recording, int, bool) {
	rec, ok := a.ownedRecording(w, r)
	if !ok {
		return rec, 0, false
	}
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n < lo || n > hi {
		writeError(w, http.StatusBadRequest, "Nieprawidłowy numer części")
		return rec, 0, false
	}
	if rec.Finished {
		writeError(w, http.StatusConflict, "Nagranie jest już zakończone")
		return rec, 0, false
	}
	if time.Since(rec.CreatedAt) > maxRecordingAge {
		writeError(w, http.StatusConflict, "Nagranie przekroczyło limit czasu")
		return rec, 0, false
	}
	if err := a.st.TouchRecording(rec.ID, time.Now()); err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return rec, 0, false
	}
	return rec, n, true
}

// recordingPart tells where to send part n: the bucket's signed address, or this server's own.
func (a *app) recordingPart(w http.ResponseWriter, r *http.Request) {
	rec, n, ok := a.openForParts(w, r, 1, recstore.MaxParts)
	if !ok {
		return
	}
	backend, ok := a.backendOf(rec)
	if !ok {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), bucketTimeout)
	defer cancel()
	url, err := backend.PartURL(ctx, recordingKey(rec), rec.UploadID, n, partTTL)
	if err != nil {
		slog.Error("signing a part address", "err", err)
		writeError(w, http.StatusBadGateway, "Magazyn nagrań jest niedostępny")
		return
	}
	if url == "" {
		url = "/api/boards/" + rec.BoardID + "/recordings/" + rec.ID + "/parts/" + strconv.Itoa(n)
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url, "method": "PUT"})
}

// putRecordingPart takes a part into the file, for recordings kept on this server's disk. The
// same part again (a retry) overwrites itself.
func (a *app) putRecordingPart(w http.ResponseWriter, r *http.Request) {
	rec, n, ok := a.openForParts(w, r, 1, recstore.MaxParts)
	if !ok {
		return
	}
	if rec.Storage != a.recDisk.Name() {
		http.NotFound(w, r) // the bucket takes the parts, not this server
		return
	}
	err := a.recDisk.WritePart(recordingKey(rec), n, r.Body)
	switch {
	case errors.Is(err, recstore.ErrPartTooBig):
		writeError(w, http.StatusRequestEntityTooLarge, "Część nagrania jest za duża")
	case err != nil:
		slog.Error("writing a recording part", "err", err)
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// recordingEvents tells where to send segment n of the event log: the bucket's signed address,
// or this server's own. Segment 0 is the starting state; 1, 2, ... follow about every 10 s.
func (a *app) recordingEvents(w http.ResponseWriter, r *http.Request) {
	rec, n, ok := a.openForParts(w, r, 0, maxEventSegments)
	if !ok {
		return
	}
	backend, ok := a.backendOf(rec)
	if !ok {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	if err := a.st.NoteSegment(rec.ID, n); err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), bucketTimeout)
	defer cancel()
	url, err := backend.PutURL(ctx, eventKey(rec.ID, n), partTTL)
	if err != nil {
		slog.Error("signing an events address", "err", err)
		writeError(w, http.StatusBadGateway, "Magazyn nagrań jest niedostępny")
		return
	}
	if url == "" {
		url = "/api/boards/" + rec.BoardID + "/recordings/" + rec.ID + "/events/" + strconv.Itoa(n)
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url, "method": "PUT"})
}

// putRecordingEvents takes a segment of the event log into a file, for recordings kept on this
// server's disk.
func (a *app) putRecordingEvents(w http.ResponseWriter, r *http.Request) {
	rec, n, ok := a.openForParts(w, r, 0, maxEventSegments)
	if !ok {
		return
	}
	if rec.Storage != a.recDisk.Name() {
		http.NotFound(w, r) // the bucket takes the events, not this server
		return
	}
	err := a.recDisk.WriteObject(eventKey(rec.ID, n), r.Body, maxEventObject)
	switch {
	case errors.Is(err, recstore.ErrTooBig):
		writeError(w, http.StatusRequestEntityTooLarge, "Segment zapisu jest za duży")
	case err != nil:
		slog.Error("writing an events segment", "err", err)
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// playRecording is the index the player starts from: where the sound, the starting state and
// every segment of the event log can be read (signed addresses of the bucket, or this server's).
func (a *app) playRecording(w http.ResponseWriter, r *http.Request) {
	board, ok := a.boardFromURL(w, r)
	if !ok {
		return
	}
	rec, ok := a.recordingOf(w, board.ID, r.PathValue("rec"))
	if !ok {
		return
	}
	if !rec.Finished {
		writeError(w, http.StatusConflict, "Nagranie jeszcze trwa")
		return
	}
	backend, ok := a.backendOf(rec)
	if !ok {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), bucketTimeout)
	defer cancel()
	address := func(key, name string) (string, error) {
		url, err := backend.GetURL(ctx, key, downloadTTL*3)
		if err != nil || url != "" {
			return url, err
		}
		return "/api/boards/" + rec.BoardID + "/recordings/" + rec.ID + "/files/" + name, nil
	}
	audio, err := address(recordingKey(rec), "audio")
	snapshot, err2 := address(eventKey(rec.ID, 0), "snapshot")
	segments := make([]string, 0, rec.Segments)
	for n := 1; n <= rec.Segments && err == nil && err2 == nil; n++ {
		var u string
		u, err = address(eventKey(rec.ID, n), "events/"+strconv.Itoa(n))
		segments = append(segments, u)
	}
	if err != nil || err2 != nil {
		slog.Error("signing playback addresses", "err", errors.Join(err, err2))
		writeError(w, http.StatusBadGateway, "Magazyn nagrań jest niedostępny")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"v": 1, "name": rec.Name, "durationMs": rec.DurationMs, "mime": rec.Mime,
		"audio": audio, "snapshot": snapshot, "segments": segments,
	})
}

// recordingFileNames are the files of a recording the app serves itself (disk store) and the
// objects they are.
var recordingFileName = regexp.MustCompile(`^(audio|snapshot|events/[1-9][0-9]{0,3})$`)

// recordingFile serves one file of a recording kept on this server's disk. The names are matched
// strictly, so nothing outside the recording's own files can be asked for.
func (a *app) recordingFile(w http.ResponseWriter, r *http.Request) {
	board, ok := a.boardFromURL(w, r)
	if !ok {
		return
	}
	rec, ok := a.recordingOf(w, board.ID, r.PathValue("rec"))
	if !ok {
		return
	}
	name := r.PathValue("name")
	if rec.Storage != a.recDisk.Name() || !recordingFileName.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	key, ctype := recordingKey(rec), rec.Mime
	switch {
	case name == "snapshot":
		key, ctype = eventKey(rec.ID, 0), "application/json"
	case strings.HasPrefix(name, "events/"):
		n, _ := strconv.Atoi(strings.TrimPrefix(name, "events/"))
		key, ctype = eventKey(rec.ID, n), "application/json"
	}
	f, err := a.recDisk.Open(key)
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
	h.Set("Content-Type", ctype)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, "", info.ModTime(), f)
}

func (a *app) finishRecording(w http.ResponseWriter, r *http.Request) {
	rec, ok := a.ownedRecording(w, r)
	if !ok {
		return
	}
	var body struct {
		DurationMs int64 `json:"durationMs"`
	}
	if !readBody(w, r, &body) {
		return
	}
	if rec.Finished {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	a.finish(r.Context(), w, rec, max(body.DurationMs, 0))
}

// finish joins the parts that arrived and closes the recording; with no part there is nothing to
// keep and the recording is dropped.
func (a *app) finish(ctx context.Context, w http.ResponseWriter, rec store.Recording, durationMs int64) {
	if err := a.complete(ctx, rec, durationMs); err != nil {
		writeError(w, http.StatusBadGateway, "Magazyn nagrań jest niedostępny")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) complete(ctx context.Context, rec store.Recording, durationMs int64) error {
	backend, ok := a.backendOf(rec)
	if !ok {
		return errors.New("unknown storage " + rec.Storage)
	}
	ctx, cancel := context.WithTimeout(ctx, bucketTimeout)
	defer cancel()
	size, err := backend.Complete(ctx, recordingKey(rec), rec.UploadID)
	if errors.Is(err, recstore.ErrNoParts) {
		return a.st.DeleteRecording(rec.ID)
	}
	if err != nil {
		slog.Error("finishing a recording upload", "storage", rec.Storage, "err", err)
		return err
	}
	return a.st.FinishRecording(rec.ID, durationMs, size)
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

// downloadRecording sends the person to a signed address of the bucket (valid a few minutes, so
// the video never passes through this server or the tunnel), or, for a recording on this server's
// disk, sends the file as an attachment (with Range support, so a download can resume).
func (a *app) downloadRecording(w http.ResponseWriter, r *http.Request) {
	board, ok := a.boardFromURL(w, r)
	if !ok {
		return
	}
	rec, ok := a.recordingOf(w, board.ID, r.PathValue("rec"))
	if !ok {
		return
	}
	if !rec.Finished {
		writeError(w, http.StatusConflict, "Nagranie jeszcze trwa")
		return
	}
	backend, ok := a.backendOf(rec)
	if !ok {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	filename := fileName(rec.Name) + recordingTypes[rec.Mime]
	ctx, cancel := context.WithTimeout(r.Context(), bucketTimeout)
	defer cancel()
	url, err := backend.DownloadURL(ctx, recordingKey(rec), filename, rec.Mime, downloadTTL)
	if err != nil {
		slog.Error("signing a download address", "err", err)
		writeError(w, http.StatusBadGateway, "Magazyn nagrań jest niedostępny")
		return
	}
	h := w.Header()
	h.Set("Cache-Control", "private, no-store")
	if url != "" {
		http.Redirect(w, r, url, http.StatusFound)
		return
	}
	f, err := a.recDisk.Open(recordingKey(rec))
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
	h.Set("Content-Type", rec.Mime)
	h.Set("X-Content-Type-Options", "nosniff")
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": filename})
	if disposition == "" {
		disposition = "attachment"
	}
	h.Set("Content-Disposition", disposition)
	http.ServeContent(w, r, "", info.ModTime(), f)
}

// renameRecording changes the name shown in the list and in the player; only the owner does.
func (a *app) renameRecording(w http.ResponseWriter, r *http.Request) {
	rec, ok := a.ownedRecording(w, r)
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
	if name == "" || utf8.RuneCountInString(name) > maxRecordingName {
		writeError(w, http.StatusBadRequest, "Nazwa musi mieć od 1 do 100 znaków")
		return
	}
	if err := a.st.RenameRecording(rec.ID, name); err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// deleteRecording removes the video and then its description; if the store refuses, the
// description stays so the owner can try again.
func (a *app) deleteRecording(w http.ResponseWriter, r *http.Request) {
	rec, ok := a.ownedRecording(w, r)
	if !ok {
		return
	}
	if err := a.removeVideo(r.Context(), rec); err != nil {
		writeError(w, http.StatusBadGateway, "Magazyn nagrań jest niedostępny")
		return
	}
	if err := a.st.DeleteRecording(rec.ID); err != nil && !errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) removeVideo(ctx context.Context, rec store.Recording) error {
	backend, ok := a.backendOf(rec)
	if !ok {
		return nil // a store that is gone from the settings: nothing to reach
	}
	ctx, cancel := context.WithTimeout(ctx, bucketTimeout)
	defer cancel()
	if err := backend.Remove(ctx, recordingKey(rec), rec.UploadID, rec.Finished); err != nil {
		return err
	}
	return backend.RemoveAll(ctx, rec.ID+"/") // the event log and every other file of it
}

// recordingsOnBoards lists the recordings of boards that are about to be deleted, so their video
// can be removed once the boards are gone (the rows go with the boards).
func (a *app) recordingsOnBoards(boardIDs ...string) []store.Recording {
	var out []store.Recording
	for _, id := range boardIDs {
		recs, err := a.st.RecordingsOf(id)
		if err != nil {
			slog.Warn("listing recordings to remove", "err", err)
			continue
		}
		out = append(out, recs...)
	}
	return out
}

// removeRecordings removes the video of recordings whose boards are gone.
func (a *app) removeRecordings(recs []store.Recording) {
	for _, rec := range recs {
		if err := a.removeVideo(context.Background(), rec); err != nil {
			slog.Warn("removing a recording's video", "storage", rec.Storage, "err", err)
		}
	}
}

// sweepRecordings finishes the recordings that went silent (a closed tab, lost network) with the
// parts that did arrive, and drops those that never got one.
func (a *app) sweepRecordings(ctx context.Context, now time.Time) {
	idle, err := a.st.IdleRecordings(now.Add(-idleRecording))
	if err != nil {
		slog.Warn("looking for idle recordings", "err", err)
		return
	}
	for _, rec := range idle {
		// The length is not known: it lasted until the last sign of life.
		if err := a.complete(ctx, rec, rec.UpdatedAt.Sub(rec.CreatedAt).Milliseconds()); err != nil {
			slog.Warn("finishing an idle recording", "err", err)
		}
	}
}

// runRecordingSweeper sweeps until ctx ends.
func (a *app) runRecordingSweeper(ctx context.Context) {
	defer logx.Recover("recording-sweeper")
	tick := time.NewTicker(sweepEvery)
	defer tick.Stop()
	for {
		a.sweepRecordings(ctx, time.Now())
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
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
