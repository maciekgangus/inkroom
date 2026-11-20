package metrics

import "bytes"

// Default is the registry of this process.
var Default = NewRegistry()

// The metrics of the app (ADR 0022). Names are part of the contract the dashboards and alerts
// rely on; do not rename them.
var (
	HTTPRequests = Default.CounterVec("inkroom_http_requests_total", "HTTP requests by route, method and status.", "route", "method", "status")
	HTTPDuration = Default.HistogramVec("inkroom_http_request_duration_seconds", "HTTP request duration by route (WebSocket sessions excluded).",
		[]float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}, "route")
	WSConnections = Default.Gauge("inkroom_ws_connections", "Open WebSocket connections.")
	RoomsActive   = Default.Gauge("inkroom_rooms_active", "Boards with at least one person connected.")
	Panics        = Default.Counter("inkroom_panics_total", "Panics recovered in handlers and goroutines.")
	ClientErrors  = Default.Counter("inkroom_client_errors_total", "Errors reported by browsers to /api/client-error.")
	wsMessages    = Default.CounterVec("inkroom_ws_messages_total", "WebSocket messages by type and direction (in: from a client, out: to a client).", "type", "direction")
)

// Directions of a WebSocket message.
const (
	DirIn  = 0
	DirOut = 1
)

// wsTypes are the message types counted by name; everything else is "other", so a client cannot
// make the number of series grow.
var wsTypes = []string{"add", "update", "remove", "live", "perm", "cursor", "laser", "follow", "view", "invite",
	"background", "name", "peers", "snapshot", "followers", "follow_refused", "follow_end", "live_drop", "cursor_drop", "ping", "pong", "other"}

// wsEntry is the canonical name of a message type with its two counters.
type wsEntry struct {
	name string
	c    [2]*Counter
}

var wsByType = func() map[string]*wsEntry {
	m := make(map[string]*wsEntry, len(wsTypes))
	for _, t := range wsTypes {
		m[t] = &wsEntry{name: t, c: [2]*Counter{wsMessages.With(t, "in"), wsMessages.With(t, "out")}}
	}
	return m
}()

const (
	sniffHead = 96
	sniffTail = 64
)

var typeKey = []byte(`"t":"`)

// SniffType finds the "t" field of a JSON message without parsing it: in the first bytes, or, for
// the server's own maps (keys are sorted, so "t" comes last), in the last bytes. Unknown or
// missing: "other". It does not allocate.
func SniffType(msg []byte) string {
	head := msg
	if len(head) > sniffHead {
		head = head[:sniffHead]
	}
	if t, ok := typeAfterKey(head); ok {
		return t
	}
	if len(msg) > sniffHead {
		tail := msg[len(msg)-sniffTail:]
		if len(msg) < sniffHead+sniffTail {
			tail = msg[sniffHead:]
		}
		if t, ok := typeAfterKey(tail); ok {
			return t
		}
	}
	return "other"
}

func typeAfterKey(b []byte) (string, bool) {
	i := bytes.Index(b, typeKey)
	if i < 0 {
		return "", false
	}
	rest := b[i+len(typeKey):]
	j := bytes.IndexByte(rest, '"')
	if j < 0 {
		return "", false
	}
	if e, ok := wsByType[string(rest[:j])]; ok { // the conversion in a map index does not allocate
		return e.name, true
	}
	return "other", true
}

// WSMessage counts one WebSocket message. It allocates nothing and takes no lock.
func WSMessage(dir int, msg []byte) {
	wsByType[SniffType(msg)].c[dir].Inc()
}

// WSMessageCount returns how many messages of a type went in ("in") or out ("out") so far.
func WSMessageCount(t, dir string) uint64 {
	i := 0
	if dir == "out" {
		i = 1
	}
	return wsByType[t].c[i].Value()
}

func init() { Default.AddRuntime() }
