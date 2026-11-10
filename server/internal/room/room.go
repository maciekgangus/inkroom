// Package room holds the in-memory state of collaborative boards and relays
// operations between connected clients (ADR 0004).
package room

import (
	"encoding/json"
	"errors"
	"sort"
	"sync"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

const maxIDLen = 64

// Client is one connected participant. Messages for it are queued on Send.
type Client struct {
	// Send carries outgoing JSON messages; it is closed when the client is dropped.
	Send chan []byte

	once    sync.Once
	mu      sync.Mutex
	dropped bool
}

// NewClient returns a client whose outgoing queue holds up to buffer messages.
func NewClient(buffer int) *Client {
	return &Client{Send: make(chan []byte, buffer)}
}

// Dropped reports whether the client was removed (too slow or left).
func (c *Client) Dropped() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.dropped
}

func (c *Client) drop() {
	c.once.Do(func() {
		c.mu.Lock()
		c.dropped = true
		c.mu.Unlock()
		close(c.Send)
	})
}

// trySend queues msg without blocking; it reports false if the queue is full.
func (c *Client) trySend(msg []byte) bool {
	select {
	case c.Send <- msg:
		return true
	default:
		return false
	}
}

type entry struct {
	seq int
	raw json.RawMessage
}

// Room is one board: its strokes and the clients currently connected to it.
type Room struct {
	mu      sync.Mutex
	strokes map[string]entry
	seq     int
	clients map[*Client]*presence

	// Persistence (only for rooms created by a Hub): changes wait in pending until flushed.
	track   bool
	pending []store.Op
	flushMu sync.Mutex // serializes flushes so batches reach the store in order
	closed  bool
}

// presence is what a connected client has shown to the others and must be taken back on leaving.
type presence struct {
	live    map[string]struct{} // ids of its unfinished "live" strokes
	cursors map[string]struct{} // ids under which it published a cursor
}

func newPresence() *presence {
	return &presence{live: map[string]struct{}{}, cursors: map[string]struct{}{}}
}

// New returns an empty room that is not persisted.
func New() *Room {
	return &Room{strokes: map[string]entry{}, clients: map[*Client]*presence{}}
}

// newPersisted returns a room holding the saved strokes, recording further changes for the store.
func newPersisted(saved [][]byte) *Room {
	r := New()
	r.track = true
	for _, raw := range saved {
		id, err := strokeID(raw)
		if err != nil {
			continue
		}
		r.seq++
		r.strokes[id] = entry{seq: r.seq, raw: append(json.RawMessage(nil), raw...)}
	}
	return r
}

type message struct {
	T      string          `json:"t"`
	ID     string          `json:"id"`
	Name   string          `json:"name"`
	Hidden bool            `json:"hidden"`
	Stroke json.RawMessage `json:"stroke"`
}

// Join registers c and queues the current snapshot for it.
func (r *Room) Join(c *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.clients[c] = newPresence()
	if !c.trySend(r.snapshotLocked()) {
		r.leaveLocked(c)
	}
}

// Leave removes c and tells the others to drop its unfinished live strokes.
func (r *Room) Leave(c *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.leaveLocked(c)
}

// Handle applies one message from c. An error means the client misbehaved.
func (r *Room) Handle(c *Client, raw []byte) error {
	var m message
	if err := json.Unmarshal(raw, &m); err != nil {
		return err
	}
	msg := append([]byte(nil), raw...)

	r.mu.Lock()
	defer r.mu.Unlock()

	switch m.T {
	case "add":
		id, err := strokeID(m.Stroke)
		if err != nil {
			return err
		}
		if _, ok := r.strokes[id]; !ok {
			r.seq++
			r.strokes[id] = entry{seq: r.seq, raw: m.Stroke}
			if r.track {
				r.pending = append(r.pending, store.Op{Add: true, ID: id, Data: m.Stroke})
			}
		}
		if p := r.clients[c]; p != nil {
			delete(p.live, id)
		}
		r.broadcastLocked(msg, nil)
	case "update":
		id, err := strokeID(m.Stroke)
		if err != nil {
			return err
		}
		e, ok := r.strokes[id]
		if !ok {
			return nil // deleted meanwhile: an update never brings an element back
		}
		e.raw = m.Stroke // same place in the snapshot, new content
		r.strokes[id] = e
		if r.track {
			r.pending = append(r.pending, store.Op{Replace: true, ID: id, Data: m.Stroke})
		}
		r.broadcastLocked(msg, nil)
	case "remove":
		if err := checkID(m.ID); err != nil {
			return err
		}
		if _, ok := r.strokes[m.ID]; ok {
			delete(r.strokes, m.ID)
			if r.track {
				r.pending = append(r.pending, store.Op{ID: m.ID})
			}
		}
		r.broadcastLocked(msg, nil)
	case "live":
		if err := checkID(m.ID); err != nil {
			return err
		}
		if p := r.clients[c]; p != nil {
			p.live[m.ID] = struct{}{}
		}
		r.broadcastLocked(msg, c)
	case "cursor":
		if err := checkID(m.ID); err != nil {
			return err
		}
		if len(m.Name) > maxIDLen {
			return errors.New("name too long")
		}
		if p := r.clients[c]; p != nil {
			if m.Hidden {
				delete(p.cursors, m.ID)
			} else {
				p.cursors[m.ID] = struct{}{}
			}
		}
		r.broadcastLocked(msg, c)
	default:
		return errors.New("unknown message type")
	}
	return nil
}

func (r *Room) snapshotLocked() []byte {
	entries := make([]entry, 0, len(r.strokes))
	for _, e := range r.strokes {
		entries = append(entries, e)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].seq < entries[j].seq })
	strokes := make([]json.RawMessage, len(entries))
	for i, e := range entries {
		strokes[i] = e.raw
	}
	b, _ := json.Marshal(map[string]any{"t": "snapshot", "strokes": strokes})
	return b
}

// broadcastLocked queues msg for every client except skip. Clients with a full queue are dropped.
func (r *Room) broadcastLocked(msg []byte, skip *Client) {
	for c := range r.clients {
		if c == skip {
			continue
		}
		if !c.trySend(msg) {
			r.leaveLocked(c)
		}
	}
}

func (r *Room) leaveLocked(c *Client) {
	p, ok := r.clients[c]
	if !ok {
		c.drop()
		return
	}
	delete(r.clients, c)
	c.drop()
	if len(p.live) > 0 {
		r.broadcastLocked(dropMessage("live_drop", p.live), nil)
	}
	if len(p.cursors) > 0 {
		r.broadcastLocked(dropMessage("cursor_drop", p.cursors), nil)
	}
}

func dropMessage(kind string, set map[string]struct{}) []byte {
	ids := make([]string, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	b, _ := json.Marshal(map[string]any{"t": kind, "ids": ids})
	return b
}

func checkID(id string) error {
	if id == "" || len(id) > maxIDLen {
		return errors.New("invalid id")
	}
	return nil
}

func strokeID(raw json.RawMessage) (string, error) {
	var s struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", err
	}
	return s.ID, checkID(s.ID)
}
