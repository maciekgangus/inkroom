package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/maciekgangus/inkroom/server/internal/room"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

const (
	maxMessageBytes = 256 << 10
	sendBuffer      = 256
	writeTimeout    = 10 * time.Second
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
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(maxMessageBytes)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	client := room.NewClient(sendBuffer)
	// Who is connecting, so the others can see who is on the board (R-046).
	client.Identify(r.URL.Query().Get("id"), r.URL.Query().Get("name"))
	// Drawing rights belong to the person the server recognises, not to the id the client states.
	user, loggedIn := a.auth.User(r)
	client.SetPerson(a.person(r, user, loggedIn, client.ID), loggedIn && user.ID == board.OwnerID)
	rm, err := a.hub.Join(boardID, client)
	if err != nil {
		log.Printf("joining board %s: %v", boardID, err)
		conn.Close(websocket.StatusInternalError, "cannot load board")
		return
	}
	defer a.hub.Leave(boardID, rm, client)

	if u, ok := a.auth.User(r); ok {
		if err := a.st.RecordVisit(u.ID, boardID, time.Now()); err != nil {
			log.Printf("recording visit: %v", err)
		}
	}

	go func() {
		defer cancel()
		for msg := range client.Send {
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

	for {
		_, msg, err := conn.Read(ctx)
		if err != nil {
			conn.Close(websocket.StatusNormalClosure, "")
			return
		}
		if err := rm.Handle(client, msg); err != nil {
			conn.Close(websocket.StatusPolicyViolation, "invalid message")
			return
		}
	}
}
