package main

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/maciekgangus/inkroom/server/internal/logx"
	"github.com/maciekgangus/inkroom/server/internal/metrics"
	"github.com/maciekgangus/inkroom/server/internal/room"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

const (
	maxMessageBytes = 256 << 10
	sendBuffer      = 256
	writeTimeout    = 10 * time.Second
	// One connection may send at most maxWSMessages per wsRateWindow (400 a second on average). A
	// 120-144 Hz screen sends a live stroke or the laser every frame plus the cursor 30 times a
	// second, and a paste sends one message per element; a flood sends far more (security audit
	// 2026-11).
	maxWSMessages = 4000
	wsRateWindow  = 10 * time.Second
)

// serveWS joins the caller to the board's room and pumps messages both ways.
func (a *app) serveWS(w http.ResponseWriter, r *http.Request) {
	boardID := r.PathValue("id")
	board, err := a.st.Board(boardID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			http.NotFound(w, r)
		} else {
			http.Error(w, "internal error", http.StatusInternalServerError)
		}
		return
	}
	// Big messages (a paste of hundreds of strokes, the whole board for a newcomer, tens of MB of
	// point lists) shrink several times when compressed; the small live and cursor messages are
	// under the library's threshold and go as they are. A new window per message keeps the memory
	// of each connection small.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		CompressionMode: websocket.CompressionNoContextTakeover,
	})
	if err != nil {
		return
	}
	defer conn.CloseNow() // also when a panic unwinds this handler
	metrics.WSConnections.Inc()
	defer metrics.WSConnections.Dec()
	conn.SetReadLimit(maxMessageBytes)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	client := room.NewClient(sendBuffer)
	// Who is connecting, so the others can see who is on the board (R-046).
	// The Administrator is told apart by a ticket the admin panel signed, never by the name given.
	if t := r.URL.Query().Get("admin"); t != "" && a.validAdminTicket(boardID, t, time.Now()) {
		client.IdentifyAdmin(r.URL.Query().Get("id"))
	} else {
		client.Identify(r.URL.Query().Get("id"), r.URL.Query().Get("name"))
	}
	// Drawing rights belong to the person the server recognises, not to the id the client states.
	user, loggedIn := a.auth.User(r)
	isOwner := false
	if loggedIn {
		isOwner, _ = a.st.IsBoardOwner(board.ID, user.ID)
	}
	client.SetPerson(a.person(r, user, loggedIn, client.ID), isOwner)
	if loggedIn && client.Name != store.ReservedName {
		client.Avatar = user.Avatar // the Administrator shows no account's picture
		client.UserID = user.ID
	}
	rm, err := a.hub.Join(boardID, client)
	if err != nil {
		logx.From(r.Context()).Error("joining board", "board", logx.Ref(boardID), "err", err)
		conn.Close(websocket.StatusInternalError, "cannot load board")
		return
	}
	defer a.hub.Leave(boardID, rm, client)

	if loggedIn {
		if err := a.st.RecordVisit(user.ID, boardID, time.Now()); err != nil {
			logx.From(r.Context()).Error("recording visit", "board", logx.Ref(boardID), "err", err)
		}
	}

	go func() {
		defer cancel()
		defer logx.Recover("ws-writer") // a panic here would otherwise take the whole process down
		for msg := range client.Send {
			metrics.WSMessage(metrics.DirOut, msg) // counted when handed to the socket
			wctx, wcancel := context.WithTimeout(ctx, writeTimeout)
			err := conn.Write(wctx, websocket.MessageText, msg)
			wcancel()
			if err != nil {
				return
			}
		}
		// The room dropped this client (too slow, or the board was deleted).
		conn.Close(websocket.StatusGoingAway, "disconnected")
	}()

	budget := newMsgBudget(time.Now, maxWSMessages, wsRateWindow)
	for {
		_, msg, err := conn.Read(ctx)
		if err != nil {
			conn.Close(websocket.StatusNormalClosure, "")
			return
		}
		if !budget.allow() {
			conn.Close(websocket.StatusPolicyViolation, "too many messages")
			return
		}
		metrics.WSMessage(metrics.DirIn, msg) // before Handle, which takes ownership of msg
		if err := rm.Handle(client, msg); err != nil {
			conn.Close(websocket.StatusPolicyViolation, "invalid message")
			return
		}
	}
}

// msgBudget lets one connection send at most max messages in each fixed window. It is on the path
// of every message, so it is two numbers and no allocation; only its own read loop uses it.
type msgBudget struct {
	now    func() time.Time
	max    int
	window time.Duration
	start  time.Time
	n      int
}

func newMsgBudget(now func() time.Time, max int, window time.Duration) *msgBudget {
	return &msgBudget{now: now, max: max, window: window}
}

func (b *msgBudget) allow() bool {
	if t := b.now(); t.Sub(b.start) >= b.window {
		b.start, b.n = t, 0
	}
	b.n++
	return b.n <= b.max
}
