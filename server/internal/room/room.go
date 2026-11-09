// Package room holds the in-memory state of collaborative boards and relays
// operations between connected clients (ADR 0004).
package room

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"sync"
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
	clients map[*Client]map[string]struct{} // client -> ids of its unfinished "live" strokes
}

// New returns an empty room.
func New() *Room {
	return &Room{strokes: map[string]entry{}, clients: map[*Client]map[string]struct{}{}}
}

type message struct {
	T      string          `json:"t"`
	ID     string          `json:"id"`
	Stroke json.RawMessage `json:"stroke"`
}

// Join registers c and queues the current snapshot for it.
func (r *Room) Join(c *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.clients[c] = map[string]struct{}{}
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
		}
		delete(r.clients[c], id)
		r.broadcastLocked(msg, nil)
	case "remove":
		if err := checkID(m.ID); err != nil {
			return err
		}
		delete(r.strokes, m.ID)
		r.broadcastLocked(msg, nil)
	case "live":
		if err := checkID(m.ID); err != nil {
			return err
		}
		if live, ok := r.clients[c]; ok {
			live[m.ID] = struct{}{}
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
	live, ok := r.clients[c]
	if !ok {
		c.drop()
		return
	}
	delete(r.clients, c)
	c.drop()
	if len(live) == 0 {
		return
	}
	ids := make([]string, 0, len(live))
	for id := range live {
		ids = append(ids, id)
	}
	b, _ := json.Marshal(map[string]any{"t": "live_drop", "ids": ids})
	r.broadcastLocked(b, nil)
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

// Hub maps board identifiers to rooms.
type Hub struct {
	mu    sync.Mutex
	rooms map[string]*Room
}

// NewHub returns an empty hub.
func NewHub() *Hub { return &Hub{rooms: map[string]*Room{}} }

// Create makes a new room and returns its 128-bit random hex identifier.
func (h *Hub) Create() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	id := hex.EncodeToString(b)
	h.mu.Lock()
	h.rooms[id] = New()
	h.mu.Unlock()
	return id
}

// Get returns the room with the given id, or nil.
func (h *Hub) Get(id string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.rooms[id]
}
