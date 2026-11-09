package room

import (
	"log"
	"sync"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

// Persister is where rooms are loaded from and saved to.
type Persister interface {
	LoadStrokes(boardID string) ([][]byte, error)
	Apply(boardID string, ops []store.Op, at time.Time) error
}

// Hub keeps the rooms that currently have people in them. A room is loaded from the
// store on first join, written back in batches, and dropped when the last person leaves.
type Hub struct {
	p     Persister
	mu    sync.Mutex
	rooms map[string]*Room

	stop chan struct{}
	done chan struct{}
	once sync.Once
}

// NewHub starts a hub that flushes pending changes every flushEvery.
func NewHub(p Persister, flushEvery time.Duration) *Hub {
	h := &Hub{p: p, rooms: map[string]*Room{}, stop: make(chan struct{}), done: make(chan struct{})}
	go h.loop(flushEvery)
	return h
}

func (h *Hub) loop(every time.Duration) {
	defer close(h.done)
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			h.Flush()
		case <-h.stop:
			return
		}
	}
}

// Join adds c to the board's room, loading the room from the store if needed.
func (h *Hub) Join(boardID string, c *Client) (*Room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r := h.rooms[boardID]
	if r == nil {
		saved, err := h.p.LoadStrokes(boardID)
		if err != nil {
			return nil, err
		}
		r = newPersisted(saved)
		h.rooms[boardID] = r
	}
	r.Join(c)
	return r, nil
}

// Leave removes c; when the room is empty it is saved and dropped from memory.
func (h *Hub) Leave(boardID string, r *Room, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r.Leave(c)
	if h.rooms[boardID] == r && r.empty() {
		h.flushRoom(boardID, r)
		delete(h.rooms, boardID)
	}
}

// Delete disconnects everyone from the board and discards unsaved changes.
func (h *Hub) Delete(boardID string) {
	h.mu.Lock()
	r := h.rooms[boardID]
	delete(h.rooms, boardID)
	h.mu.Unlock()
	if r != nil {
		r.shutdown()
	}
}

// Flush writes all pending changes now.
func (h *Hub) Flush() {
	h.mu.Lock()
	rooms := make(map[string]*Room, len(h.rooms))
	for id, r := range h.rooms {
		rooms[id] = r
	}
	h.mu.Unlock()
	for id, r := range rooms {
		h.flushRoom(id, r)
	}
}

// Close stops the periodic flush, saves everything and disconnects everyone.
func (h *Hub) Close() {
	h.once.Do(func() {
		close(h.stop)
		<-h.done
		h.Flush()
		h.mu.Lock()
		rooms := h.rooms
		h.rooms = map[string]*Room{}
		h.mu.Unlock()
		for _, r := range rooms {
			r.shutdown()
		}
	})
}

func (h *Hub) flushRoom(boardID string, r *Room) {
	r.flushMu.Lock()
	defer r.flushMu.Unlock()
	r.mu.Lock()
	ops := r.pending
	r.pending = nil
	closed := r.closed
	r.mu.Unlock()
	if len(ops) == 0 || closed {
		return
	}
	if err := h.p.Apply(boardID, ops, time.Now()); err != nil {
		log.Printf("saving board %s: %v", boardID, err)
		r.mu.Lock()
		if !r.closed {
			r.pending = append(ops, r.pending...) // retry on the next flush
		}
		r.mu.Unlock()
	}
}

func (r *Room) empty() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.clients) == 0
}

// shutdown drops every client and discards unsaved changes.
func (r *Room) shutdown() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closed = true
	r.pending = nil
	for c := range r.clients {
		c.drop()
	}
	r.clients = map[*Client]*presence{}
}
