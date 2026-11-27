package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"path/filepath"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/ai"
	"github.com/maciekgangus/inkroom/server/internal/auth"
	"github.com/maciekgangus/inkroom/server/internal/cfaccess"
	"github.com/maciekgangus/inkroom/server/internal/logx"
	"github.com/maciekgangus/inkroom/server/internal/recstore"
	"github.com/maciekgangus/inkroom/server/internal/room"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

// flushEvery is how often pending board changes are written to SQLite (ADR 0005).
const flushEvery = 500 * time.Millisecond

type app struct {
	st        *store.Store
	auth      *auth.Service
	hub       *room.Hub
	staticDir string
	// turnstileSiteKey is the public key of the registration captcha, given to the client.
	turnstileSiteKey string
	// version is the release this server runs, given to the client so an old tab can tell (R-099).
	version string
	// admin checks the Cloudflare Access token of the admin page (R-064); nil: the page is off.
	admin *cfaccess.Verifier
	// adminDevOpen opens the admin page without Cloudflare for direct requests (local development).
	adminDevOpen bool
	// adminSecret signs the tickets that let the admin enter a board as the Administrator (R-065).
	adminSecret []byte
	// legal names the operator on /privacy and /terms (R-096).
	legal legalData
	// clientLog writes the errors browsers report (service "client"), and the two limiters keep a
	// person and an address from flooding it (R-098).
	clientLog                  *slog.Logger
	clientLimit, clientIPLimit *rateLimiter
	// imageIPLimit keeps one address from flooding the image upload (security audit 2026-11).
	imageIPLimit *rateLimiter
	// The stores of lesson recordings by name, the one that takes new recordings, the disk one in
	// particular, and the origin of the bucket if there is one (the page's CSP must allow it).
	recBackends  map[string]recstore.Backend
	recNew       string
	recDisk      *recstore.Disk
	bucketOrigin string
	// renderToken is the secret of the renderer, which renders videos of recordings (R-115,
	// ADR 0029); "" when there is none, and then no video is queued.
	renderToken string
	// minRecording is the shortest recording worth keeping; a shorter one is dropped when it ends.
	minRecording time.Duration
	// ai runs the AI analysis of boards through segmentsvc (R-121, ADR 0034).
	ai *ai.Service
}

// defaultSegmentsvcURL is where segmentsvc listens unless SEGMENTSVC_URL says otherwise.
const defaultSegmentsvcURL = "http://127.0.0.1:8090"

// newApp wires the services together. Call Close before closing the store.
func newApp(staticDir string, st *store.Store) *app {
	a := &app{
		st:            st,
		auth:          auth.New(st),
		hub:           room.NewHub(st, flushEvery),
		staticDir:     staticDir,
		version:       "dev",
		minRecording:  minRecordingLength,
		adminSecret:   newAdminSecret(),
		clientLog:     logx.For("client"),
		clientLimit:   newRateLimiter(time.Now, clientErrorsPerHour, time.Hour, clientLimiterKeys),
		clientIPLimit: newRateLimiter(time.Now, clientIPsPerHour, time.Hour, clientLimiterKeys),
		imageIPLimit:  newRateLimiter(time.Now, maxImageUploadsPerIP, imageUploadWindow, clientLimiterKeys),
	}
	a.ai = ai.New(st, defaultSegmentsvcURL, a.ownedBoard)
	return a
}

// configureCaptcha turns on the Cloudflare Turnstile check for registration (R-054, ADR 0013).
// Without a secret the check stays off and registration is refused.
func (a *app) configureCaptcha(siteKey, secret string) {
	a.turnstileSiteKey = siteKey
	if secret == "" {
		a.auth.Captcha = nil
		return
	}
	a.auth.Captcha = auth.Turnstile{Secret: secret}
}

// configureGoogle turns on signing in with Google (R-063, ADR 0018). Without both the client ID
// and the secret it stays off. publicURL is the site's address; empty: taken from the request.
func (a *app) configureGoogle(clientID, secret, publicURL string) {
	if clientID == "" || secret == "" {
		a.auth.Google = nil
		return
	}
	a.auth.Google = &auth.Google{ClientID: clientID, ClientSecret: secret, PublicURL: publicURL}
}

// Close stops running AI analyses, saves pending board changes and disconnects everyone.
func (a *app) Close() {
	a.ai.Close()
	a.hub.Close()
}

// Handler returns the HTTP handler: health check, accounts, boards, board WebSocket and
// static files (index.html also serves /b/<id>, the client route), inside the logging and
// metrics middleware (ADR 0022).
func (a *app) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("POST /api/register", a.auth.Register)
	mux.HandleFunc("POST /api/login", a.auth.Login)
	mux.HandleFunc("POST /api/logout", a.auth.Logout)
	mux.HandleFunc("GET /api/me", a.auth.Me)
	mux.HandleFunc("POST /api/account/password", a.changePassword)
	mux.HandleFunc("POST /api/account/delete", a.deleteAccount)
	mux.HandleFunc("GET /api/account/shortcuts", a.getShortcuts)
	mux.HandleFunc("PUT /api/account/shortcuts", a.putShortcuts)
	mux.HandleFunc("PUT /api/account/avatar", a.putAvatar)
	mux.HandleFunc("POST /api/boards", a.createBoard)
	mux.HandleFunc("GET /api/boards", a.listBoards)
	mux.HandleFunc("POST /api/boards/organize", a.bulkOrganizeBoards)
	mux.HandleFunc("POST /api/boards/transfer", a.bulkTransferBoards)
	mux.HandleFunc("PUT /api/boards/order", a.setBoardOrder)
	mux.HandleFunc("GET /api/boards/{id}", a.getBoard)
	mux.HandleFunc("PATCH /api/boards/{id}", a.renameBoard)
	mux.HandleFunc("PATCH /api/boards/{id}/meta", a.updateBoardMeta)
	mux.HandleFunc("GET /api/boards/{id}/owners", a.listBoardOwners)
	mux.HandleFunc("POST /api/boards/{id}/owners", a.addBoardOwner)
	mux.HandleFunc("DELETE /api/boards/{id}/owners/{userId}", a.removeBoardOwner)
	mux.HandleFunc("POST /api/boards/{id}/transfer", a.transferBoard)
	mux.HandleFunc("POST /api/folders", a.createFolder)
	mux.HandleFunc("PATCH /api/folders/{id}", a.updateFolder)
	mux.HandleFunc("DELETE /api/folders/{id}", a.deleteFolder)
	mux.HandleFunc("POST /api/markers", a.createMarker)
	mux.HandleFunc("PATCH /api/markers/{id}", a.updateMarker)
	mux.HandleFunc("DELETE /api/markers/{id}", a.deleteMarker)
	mux.HandleFunc("GET /api/contacts", a.listContacts)
	mux.HandleFunc("POST /api/contacts", a.addContact)
	mux.HandleFunc("DELETE /api/contacts/{userId}", a.removeContact)
	mux.HandleFunc("PUT /api/boards/{id}/background", a.setBackground)
	mux.HandleFunc("GET /api/boards/{id}/view", a.getView)
	mux.HandleFunc("PUT /api/boards/{id}/view", a.setView)
	mux.HandleFunc("POST /api/boards/{id}/copy", a.copyBoard)
	mux.HandleFunc("DELETE /api/boards/{id}/visit", a.forgetBoard)
	mux.HandleFunc("GET /api/boards/{id}/preview", a.boardPreview)
	mux.HandleFunc("GET /api/boards/{id}/preview.png", a.boardPreviewPicture)
	mux.HandleFunc("PUT /api/boards/{id}/preview.png", a.setBoardPreviewPicture)
	mux.HandleFunc("DELETE /api/boards/{id}", a.deleteBoard)
	mux.HandleFunc("POST /api/boards/{id}/analyze", a.ai.Start)
	mux.HandleFunc("GET /api/boards/{id}/analyze", a.ai.Status)
	mux.HandleFunc("POST /api/boards/{id}/images", a.uploadImage)
	mux.HandleFunc("GET /api/boards/{id}/images/{image}", a.getImage)
	mux.HandleFunc("POST /api/boards/{id}/recordings", a.startRecording)
	mux.HandleFunc("GET /api/boards/{id}/recordings", a.listRecordings)
	mux.HandleFunc("POST /api/boards/{id}/recordings/{rec}/parts/{n}", a.recordingPart)
	mux.HandleFunc("PUT /api/boards/{id}/recordings/{rec}/parts/{n}", a.putRecordingPart)
	mux.HandleFunc("POST /api/boards/{id}/recordings/{rec}/events/{n}", a.recordingEvents)
	mux.HandleFunc("PUT /api/boards/{id}/recordings/{rec}/events/{n}", a.putRecordingEvents)
	mux.HandleFunc("GET /api/boards/{id}/recordings/{rec}/play", a.playRecording)
	mux.HandleFunc("GET /api/boards/{id}/recordings/{rec}/files/{name...}", a.recordingFile)
	mux.HandleFunc("POST /api/boards/{id}/recordings/{rec}/finish", a.finishRecording)
	mux.HandleFunc("GET /api/boards/{id}/recordings/{rec}", a.downloadRecording)
	mux.HandleFunc("GET /api/boards/{id}/recordings/{rec}/video", a.downloadVideo)
	mux.HandleFunc("PATCH /api/boards/{id}/recordings/{rec}", a.renameRecording)
	mux.HandleFunc("DELETE /api/boards/{id}/recordings/{rec}", a.deleteRecording)
	mux.HandleFunc("GET /api/calendar", a.getCalendar)
	mux.HandleFunc("POST /api/lessons", a.createLesson)
	mux.HandleFunc("PATCH /api/lessons/{id}", a.updateLesson)
	mux.HandleFunc("DELETE /api/lessons/{id}", a.deleteLesson)
	mux.HandleFunc("POST /api/lessons/{id}/board", a.linkBoard)
	mux.HandleFunc("POST /api/lessons/{id}/requests", a.createRequest)
	mux.HandleFunc("POST /api/requests/{id}/accept", a.resolveRequest("accepted"))
	mux.HandleFunc("POST /api/requests/{id}/reject", a.resolveRequest("rejected"))
	mux.HandleFunc("POST /api/requests/{id}/cancel", a.resolveRequest("cancelled"))
	mux.HandleFunc("POST /api/series", a.createSeries)
	mux.HandleFunc("DELETE /api/series/{id}", a.deleteSeries)
	mux.HandleFunc("POST /api/unavailability", a.createUnavailable)
	mux.HandleFunc("DELETE /api/unavailability/{id}", a.deleteUnavailable)
	mux.HandleFunc("POST /api/feedback", a.sendFeedback)
	mux.HandleFunc("POST /api/client-error", a.clientError)
	mux.HandleFunc("GET /admin", a.adminOnly(a.adminPage))
	mux.HandleFunc("GET /api/admin/feedback", a.adminOnly(a.adminListFeedback))
	mux.HandleFunc("POST /api/admin/feedback/{id}/read", a.adminChange(a.adminMarkFeedback))
	mux.HandleFunc("DELETE /api/admin/feedback/{id}", a.adminChange(a.adminDeleteFeedback))
	mux.HandleFunc("GET /api/admin/users", a.adminOnly(a.adminListUsers))
	mux.HandleFunc("POST /api/admin/users/{id}/rename", a.adminChange(a.adminRenameUser))
	mux.HandleFunc("POST /api/admin/users/{id}/logout", a.adminChange(a.adminLogoutUser))
	mux.HandleFunc("DELETE /api/admin/users/{id}", a.adminChange(a.adminDeleteUser))
	mux.HandleFunc("GET /api/admin/boards", a.adminOnly(a.adminListBoards))
	mux.HandleFunc("POST /api/admin/boards/{id}/rename", a.adminChange(a.adminRenameBoard))
	mux.HandleFunc("POST /api/admin/boards/{id}/owner", a.adminChange(a.adminSetOwner))
	mux.HandleFunc("POST /api/admin/boards/{id}/copy", a.adminChange(a.adminCopyBoard))
	mux.HandleFunc("POST /api/admin/boards/{id}/enter", a.adminChange(a.adminEnterBoard))
	mux.HandleFunc("DELETE /api/admin/boards/{id}", a.adminChange(a.adminDeleteBoard))
	mux.HandleFunc("GET /api/auth/google/start", a.auth.GoogleStart)
	mux.HandleFunc("GET /api/auth/google/callback", a.auth.GoogleCallback)
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"turnstileSiteKey": a.turnstileSiteKey, "google": a.auth.GoogleEnabled(), "version": a.version})
	})
	mux.HandleFunc("GET /ws/{id}", a.serveWS)
	index := func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(a.staticDir, "index.html"))
	}
	mux.HandleFunc("GET /privacy", a.legalPage("privacy"))
	mux.HandleFunc("GET /terms", a.legalPage("terms"))
	mux.HandleFunc("GET /register", index)
	mux.HandleFunc("GET /b/{id}", index)
	mux.HandleFunc("GET /b/{id}/r/{rec}", index) // the player of a recording (R-114)
	mux.HandleFunc("GET /b/{id}/v/{rec}", index) // the player of its video (R-115)
	mux.HandleFunc("GET /calendar", index)
	mux.Handle("/", http.FileServer(http.Dir(a.staticDir)))
	return secureHeaders(pageCSP(a.bucketOrigin), logx.Middleware(mux, logx.Options{}))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
