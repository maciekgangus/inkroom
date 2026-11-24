package main

import (
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/auth"
	"github.com/maciekgangus/inkroom/server/internal/metrics"
)

const (
	maxClientBody       = 4 << 10 // bytes of a report
	maxClientMessage    = 300     // characters kept of each field
	maxClientSource     = 200
	maxClientStack      = 1500
	maxClientPage       = 100
	maxClientMeta       = 60
	maxClientUA         = 160
	clientErrorsPerHour = 20 // reports one person may send in an hour (as for feedback, R-062)
	clientIPsPerHour    = 60 // and one address, for guests who change their cookie
	clientLimiterKeys   = 10000
)

// clientError takes the report of an error that happened in a browser (R-098) and writes one log
// line for it (service "client"); nothing is stored in the database. The page and the script are
// reduced to their paths (board links are secrets), the account is named by its id only, and the
// address of the caller is used for the rate limit in memory but never logged.
func (a *app) clientError(w http.ResponseWriter, r *http.Request) {
	if !auth.RequireJSON(w, r) {
		return
	}
	var body struct {
		Message string `json:"message"`
		Source  string `json:"source"`
		Line    int    `json:"line"`
		Col     int    `json:"col"`
		Stack   string `json:"stack"`
		Page    string `json:"page"`
		Screen  string `json:"screen"`
		Release string `json:"release"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxClientBody)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	msg := maskIDs(clip(body.Message, maxClientMessage))
	if msg == "" {
		writeError(w, http.StatusBadRequest, "Brak opisu błędu")
		return
	}
	u, loggedIn := a.auth.User(r)
	who := "guest"
	if loggedIn {
		who = "u:" + strconv.FormatInt(u.ID, 10)
	}
	if !a.clientIPLimit.allow(a.auth.ClientIP(r)) || (loggedIn && !a.clientLimit.allow(who)) {
		writeError(w, http.StatusTooManyRequests, "Za dużo zgłoszeń")
		return
	}
	metrics.ClientErrors.Inc()
	a.clientLog.Warn("client error",
		"message", msg,
		"source", clip(maskIDs(pathOnly(body.Source)), maxClientSource),
		"line", clampInt(body.Line), "col", clampInt(body.Col),
		"stack", maskIDs(clip(body.Stack, maxClientStack)),
		"page", sanitizePage(body.Page),
		"screen", clip(body.Screen, maxClientMeta),
		"release", clip(body.Release, maxClientMeta),
		"ua", clip(r.UserAgent(), maxClientUA),
		"user", who,
	)
	w.WriteHeader(http.StatusNoContent)
}

// boardIDInPath matches the id in a board's link or API path: /b/<id>, /ws/<id>, /api/boards/<id>.
// A board id is the secret of its link, so it must not reach the logs, even from a message or a
// stack trace that mentions a URL.
var boardIDInPath = regexp.MustCompile(`(/(?:b|ws|api/boards)/)[^/\s?#:"'<>)]+`)

func maskIDs(s string) string { return boardIDInPath.ReplaceAllString(s, "${1}:id") }

func clampInt(n int) int {
	if n < 0 {
		return 0
	}
	if n > 10_000_000 {
		return 10_000_000
	}
	return n
}

// pathOnly keeps the path of a URL: no host, query or fragment.
func pathOnly(raw string) string {
	raw = strings.TrimSpace(raw)
	if u, err := url.Parse(raw); err == nil && (u.Path != "" || u.Host != "") {
		return u.Path
	}
	if i := strings.IndexAny(raw, "?#"); i >= 0 {
		raw = raw[:i]
	}
	return raw
}

// sanitizePage reduces the page a browser reports to its path, with the id of a board hidden
// (/b/<id> is a secret link): "https://x/b/abc?t=1" becomes "/b/:id".
func sanitizePage(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	p := u.Path
	if p == "" {
		p = "/"
	}
	if strings.HasPrefix(p, "/b/") {
		p = "/b/:id"
	}
	return clip(p, maxClientPage)
}

// rateLimiter lets each key do something at most max times in a window. It lives in memory and
// holds at most maxKeys keys, so a flood of different keys cannot grow it without bound.
type rateLimiter struct {
	now     func() time.Time
	max     int
	window  time.Duration
	maxKeys int

	mu   sync.Mutex
	hits map[string][]time.Time
}

func newRateLimiter(now func() time.Time, max int, window time.Duration, maxKeys int) *rateLimiter {
	return &rateLimiter{now: now, max: max, window: window, maxKeys: maxKeys, hits: map[string][]time.Time{}}
}

func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	recent := l.recentLocked(key, now)
	if len(recent) >= l.max {
		return false
	}
	l.hits[key] = append(recent, now)
	if len(l.hits) > l.maxKeys {
		l.evictLocked(now)
	}
	return true
}

func (l *rateLimiter) recentLocked(key string, now time.Time) []time.Time {
	cutoff := now.Add(-l.window)
	var keep []time.Time
	for _, t := range l.hits[key] {
		if t.After(cutoff) {
			keep = append(keep, t)
		}
	}
	return keep
}

// evictLocked drops the keys that have nothing in the window, then the longest silent ones.
func (l *rateLimiter) evictLocked(now time.Time) {
	cutoff := now.Add(-l.window)
	for k, ts := range l.hits {
		if len(ts) == 0 || !ts[len(ts)-1].After(cutoff) {
			delete(l.hits, k)
		}
	}
	for len(l.hits) > l.maxKeys {
		oldestKey, oldest := "", now.Add(time.Hour)
		for k, ts := range l.hits {
			if last := ts[len(ts)-1]; last.Before(oldest) {
				oldestKey, oldest = k, last
			}
		}
		delete(l.hits, oldestKey)
	}
}

func (l *rateLimiter) size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.hits)
}
