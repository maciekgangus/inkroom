package main

import (
	"context"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/maciekgangus/inkroom/server/internal/room"
)

const (
	maxMessageBytes = 256 << 10
	sendBuffer      = 256
	writeTimeout    = 10 * time.Second
)

// serveWS joins the caller to the room named in the URL and pumps messages both ways.
func serveWS(hub *room.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rm := hub.Get(r.PathValue("id"))
		if rm == nil {
			http.NotFound(w, r)
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
		rm.Join(client)
		defer rm.Leave(client)

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
}
