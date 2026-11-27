package room

import (
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/logx"
	"github.com/maciekgangus/inkroom/server/internal/metrics"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

// Persister is where rooms are loaded from and saved to.
type Persister interface {
	LoadStrokes(boardID string) ([][]byte, error)
	LoadBackground(boardID string) (string, error)
	ImageBytes(boardID string) (int64, error)
	Apply(boardID string, ops []store.Op, at time.Time) error
	LoadRevoked(boardID string) ([]string, error)
	SetRevoked(boardID, person string, revoked bool) error
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
			h.flushSafely()
		case <-h.stop:
			return
		}
	}
}

// flushSafely is Flush that survives a panic: it is logged and the loop goes on, because a
// flush that never comes again would silently stop saving every board.
func (h *Hub) flushSafely() {
	defer logx.Recover("hub-flush")
	h.Flush()
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
		background, err := h.p.LoadBackground(boardID)
		if err != nil {
			return nil, err
		}
		revoked, err := h.p.LoadRevoked(boardID)
		if err != nil {
			return nil, err
		}
		imageBytes, err := h.p.ImageBytes(boardID)
		if err != nil {
			return nil, err
		}
		r = newPersisted(saved, background, imageBytes)
		r.setRevoked(revoked)
		r.OnRevoke = func(person string, on bool) {
			if err := h.p.SetRevoked(boardID, person, on); err != nil {
				slog.Error("saving drawing rights of a board", "board", logx.Ref(boardID), "err", err)
			}
		}
		h.rooms[boardID] = r
		metrics.RoomsActive.Inc()
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
		metrics.RoomsActive.Dec()
	}
}

// AddImageBytes counts an image just saved to the board in its room, if anyone is in it, so the
// room refuses strokes where the store would.
func (h *Hub) AddImageBytes(boardID string, n int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r := h.rooms[boardID]; r != nil {
		r.addImageBytes(n)
	}
}

// SetBackground passes a saved background change to the board's room, if anyone is in it.
func (h *Hub) SetBackground(boardID, value string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r := h.rooms[boardID]; r != nil {
		r.SetBackground(value)
	}
}

// SetName passes a saved rename to the board's room, if anyone is in it.
func (h *Hub) SetName(boardID, value string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r := h.rooms[boardID]; r != nil {
		r.SetName(value)
	}
}

// SetAvatar passes a person's saved new picture to every board they are on (R-111).
func (h *Hub) SetAvatar(person, avatar string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, r := range h.rooms {
		r.SetAvatar(person, avatar)
	}
}

// SetOwner updates live ownership for one person on a board room, if active (R-122).
func (h *Hub) SetOwner(boardID, person string, owner bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r := h.rooms[boardID]; r != nil {
		r.SetOwner(person, owner)
	}
}

// SetSoleOwner updates live ownership on a board room after a transfer, if active (R-122).
func (h *Hub) SetSoleOwner(boardID, person string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r := h.rooms[boardID]; r != nil {
		r.SetSoleOwner(person)
	}
}

// Delete disconnects everyone from the board and discards unsaved changes.
func (h *Hub) Delete(boardID string) {
	h.mu.Lock()
	r := h.rooms[boardID]
	delete(h.rooms, boardID)
	if r != nil {
		metrics.RoomsActive.Dec()
	}
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
		metrics.RoomsActive.Add(-int64(len(rooms)))
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
	err := h.apply(boardID, ops)
	if errors.Is(err, store.ErrQuota) {
		// The room and the store count alike, so this is rare (an image uploaded meanwhile). Retrying
		// the batch would fail forever and keep every later change, deletes too, from being saved:
		// save it op by op and leave out what does not fit.
		ops, err = h.applyEach(boardID, ops)
	}
	if err != nil {
		slog.Error("saving board", "board", logx.Ref(boardID), "err", err)
		r.mu.Lock()
		if !r.closed {
			r.pending = append(ops, r.pending...) // retry on the next flush
		}
		r.mu.Unlock()
	}
}

// applyEach saves ops one at a time, dropping those over the quota. It returns the ops left
// unsaved by another error, with that error, so they can be retried.
func (h *Hub) applyEach(boardID string, ops []store.Op) ([]store.Op, error) {
	dropped := 0
	for i, op := range ops {
		err := h.apply(boardID, []store.Op{op})
		if errors.Is(err, store.ErrQuota) {
			dropped++
			continue
		}
		if err != nil {
			return ops[i:], err
		}
	}
	if dropped > 0 {
		slog.Warn("board over quota: changes not saved", "board", logx.Ref(boardID), "dropped", dropped)
	}
	return nil, nil
}

// apply saves ops. A panic in the persistence code is logged and returned as an error, so the
// batch goes back to pending and is retried instead of being lost with the panic.
func (h *Hub) apply(boardID string, ops []store.Op) (err error) {
	defer func() {
		if v := recover(); v != nil {
			logx.Panic("hub-apply", v)
			err = fmt.Errorf("panic while saving: %v", v)
		}
	}()
	return h.p.Apply(boardID, ops, time.Now())
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
