package main

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

// maxImageBytes is the largest accepted upload; the client shrinks photos well below it (ADR 0007).
const maxImageBytes = 5 << 20

// One address may upload at most maxImageUploadsPerIP images per imageUploadWindow, so a board
// link alone cannot be used to fill the disk (security audit 2026-11). It is twice the 60 pages of
// one PDF (R-056), which goes up as 60 images: a PDF and the pictures around it fit.
const (
	maxImageUploadsPerIP = 120
	imageUploadWindow    = 10 * time.Minute
)

// imageUploadLimit is the limit set in IMAGE_UPLOADS_PER_IP, or the default when it is not a
// positive number. The e2e suite raises it: all its tests upload from one address.
func imageUploadLimit(env string) int {
	if n, err := strconv.Atoi(env); err == nil && n > 0 {
		return n
	}
	return maxImageUploadsPerIP
}

// allowedImageTypes are sniffed from the bytes, never taken from the client. SVG is left out on
// purpose: it can carry scripts.
var allowedImageTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/webp": true,
	"image/gif":  true,
}

// uploadImage stores an image for a board and returns its id. Like drawing, it needs only the
// board's link.
func (a *app) uploadImage(w http.ResponseWriter, r *http.Request) {
	board, ok := a.boardFromURL(w, r)
	if !ok {
		return
	}
	if !a.imageIPLimit.allow(a.auth.ClientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "Za dużo obrazów, spróbuj później")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxImageBytes))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "Obraz jest za duży (maks. 5 MB)")
		} else {
			writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		}
		return
	}
	mime := http.DetectContentType(data)
	if !allowedImageTypes[mime] {
		writeError(w, http.StatusUnsupportedMediaType, "Dozwolone są obrazy PNG, JPEG, WebP i GIF")
		return
	}
	id := newBoardID() // 128 random bits, also fine as an image id
	if err := a.st.SaveImage(id, board.ID, mime, data); err != nil {
		if errors.Is(err, store.ErrQuota) {
			writeError(w, http.StatusInsufficientStorage, "Tablica nie ma już miejsca na obraz")
			return
		}
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	a.hub.AddImageBytes(board.ID, int64(len(data))) // the open room counts it, as the store does
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// getImage serves an image. Its id never maps to different bytes, so browsers may cache it for good.
func (a *app) getImage(w http.ResponseWriter, r *http.Request) {
	mime, data, err := a.st.Image(r.PathValue("id"), r.PathValue("image"))
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(data)
}
