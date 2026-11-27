package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/logx"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

// The job port of the renderer (R-115, ADR 0029). A separate worker takes recordings from the
// queue, renders each to an MP4 in a headless browser and sends the file to the store. It speaks to
// the app on its own port (RENDER_ADDR), which is not published and takes only requests that carry
// RENDER_TOKEN; the video of a recording itself goes straight to the bucket by a signed address, or,
// for the disk store, through this port.

// configureRender turns the renderer on: finished recordings get a video from now on, and the ones
// that have none yet are queued.
func (a *app) configureRender(token string) {
	a.renderToken = token
	if token == "" {
		return
	}
	if n, err := a.st.QueueMissingVideos(); err != nil {
		slog.Warn("queueing the recordings that have no video", "err", err)
	} else if n > 0 {
		slog.Info("recordings without a video were queued", "count", n)
	}
}

// renderHandler serves the job port.
func (a *app) renderHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /render/claim", a.renderClaim)
	mux.HandleFunc("POST /render/{id}/{rec}/progress", a.renderProgress)
	mux.HandleFunc("PUT /render/{id}/{rec}/video", a.renderPutVideo)
	mux.HandleFunc("POST /render/{id}/{rec}/done", a.renderDone)
	mux.HandleFunc("POST /render/{id}/{rec}/fail", a.renderFail)
	return a.renderAuth(mux)
}

func (a *app) renderAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || a.renderToken == "" || subtle.ConstantTimeCompare([]byte(token), []byte(a.renderToken)) != 1 {
			writeError(w, http.StatusUnauthorized, "Brak dostępu")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// renderClaim hands the renderer the oldest recording that waits for a video, and where to send it.
func (a *app) renderClaim(w http.ResponseWriter, r *http.Request) {
	rec, ok, err := a.st.ClaimVideo(time.Now())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	if !ok {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	backend, found := a.backendOf(rec)
	var url string
	if found {
		ctx, cancel := context.WithTimeout(r.Context(), bucketTimeout)
		defer cancel()
		url, err = backend.PutURL(ctx, videoKey(rec.ID), videoUploadTTL)
	}
	if !found || err != nil {
		slog.Error("signing the address of a video", "storage", rec.Storage, "found", found, "err", err)
		_ = a.st.FailVideo(rec.ID, maxVideoAttempts)
		writeError(w, http.StatusBadGateway, "Magazyn nagrań jest niedostępny")
		return
	}
	if url == "" { // the disk store: the video comes through this port
		url = "/render/" + rec.BoardID + "/" + rec.ID + "/video"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"board": rec.BoardID, "rec": rec.ID, "name": rec.Name, "durationMs": rec.DurationMs, "upload": url,
	})
}

// renderedRecording finds the recording the renderer reports on.
func (a *app) renderedRecording(w http.ResponseWriter, r *http.Request) (store.Recording, bool) {
	return a.recordingOf(w, r.PathValue("id"), r.PathValue("rec"))
}

func (a *app) renderProgress(w http.ResponseWriter, r *http.Request) {
	rec, ok := a.renderedRecording(w, r)
	if !ok {
		return
	}
	var body struct {
		Percent int `json:"percent"`
	}
	if !readBody(w, r, &body) {
		return
	}
	if err := a.st.NoteVideoProgress(rec.ID, body.Percent, time.Now()); err != nil {
		storeFail(w, err, "Nagranie nie jest renderowane")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// renderPutVideo takes the video into the disk store.
func (a *app) renderPutVideo(w http.ResponseWriter, r *http.Request) {
	rec, ok := a.renderedRecording(w, r)
	if !ok {
		return
	}
	if rec.Video != store.VideoRendering || rec.Storage != a.recDisk.Name() {
		http.NotFound(w, r)
		return
	}
	err := a.recDisk.WriteObject(videoKey(rec.ID), r.Body, maxVideoBytes)
	if err != nil {
		slog.Error("writing a video", "err", err)
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// renderDone marks the video as ready. When the recording was deleted meanwhile, what the renderer
// sent is removed again, so nothing is left behind.
func (a *app) renderDone(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Bytes int64 `json:"bytes"`
	}
	if !readBody(w, r, &body) {
		return
	}
	id, recID := r.PathValue("id"), r.PathValue("rec")
	if _, err := a.st.Recording(id, recID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			if exists, err2 := a.st.RecordingExists(recID); err2 == nil && !exists {
				a.removeVideoFiles(r.Context(), recID)
			}
		}
		storeFail(w, err, "Nie ma takiego nagrania")
		return
	}
	err := a.st.FinishVideo(recID, max(body.Bytes, 0))
	if errors.Is(err, store.ErrNotFound) {
		if exists, err2 := a.st.RecordingExists(recID); err2 == nil && !exists {
			a.removeVideoFiles(r.Context(), recID)
		}
		writeError(w, http.StatusNotFound, "Nie ma takiego nagrania")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) removeVideoFiles(ctx context.Context, recID string) {
	ctx, cancel := context.WithTimeout(ctx, bucketTimeout)
	defer cancel()
	for name, backend := range a.recBackends {
		if err := backend.RemoveAll(ctx, recID+"/"); err != nil {
			slog.Warn("removing the files of a deleted recording", "storage", name, "err", err)
		}
	}
}

func (a *app) renderFail(w http.ResponseWriter, r *http.Request) {
	rec, ok := a.renderedRecording(w, r)
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body) // the reason is optional
	if err := a.st.FailVideo(rec.ID, maxVideoAttempts); err != nil {
		storeFail(w, err, "Nagranie nie jest renderowane")
		return
	}
	slog.Warn("the renderer failed on a recording", "recording", logx.Ref(rec.ID), "attempt", rec.VideoAttempts, "reason", body.Reason)
	w.WriteHeader(http.StatusNoContent)
}
