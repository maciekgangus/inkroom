package metrics

import (
	"io"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func scrape(t *testing.T, r *Registry) string {
	t.Helper()
	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/plain; version=0.0.4") {
		t.Fatalf("content type = %q", ct)
	}
	b, _ := io.ReadAll(rec.Body)
	return string(b)
}

func TestCounterGaugeExposition(t *testing.T) {
	r := NewRegistry()
	c := r.Counter("x_total", "things counted")
	g := r.Gauge("x_now", "things now")
	c.Inc()
	c.Add(2)
	g.Inc()
	g.Inc()
	g.Dec()
	out := scrape(t, r)
	for _, want := range []string{
		"# HELP x_total things counted\n# TYPE x_total counter\nx_total 3\n",
		"# HELP x_now things now\n# TYPE x_now gauge\nx_now 1\n",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in\n%s", want, out)
		}
	}
}

func TestCounterVecLabelsAreEscapedAndSorted(t *testing.T) {
	r := NewRegistry()
	v := r.CounterVec("req_total", "requests", "route", "status")
	v.With("/b", "200").Inc()
	v.With("/a", "500").Add(4)
	v.With(`/q"x\y`+"\n", "200").Inc()
	out := scrape(t, r)
	a := strings.Index(out, `req_total{route="/a",status="500"} 4`)
	b := strings.Index(out, `req_total{route="/b",status="200"} 1`)
	if a < 0 || b < 0 || a > b {
		t.Fatalf("series missing or unsorted:\n%s", out)
	}
	if !strings.Contains(out, `req_total{route="/q\"x\\y\n",status="200"} 1`) {
		t.Errorf("label value not escaped:\n%s", out)
	}
}

func TestHistogramIsCumulativeWithInf(t *testing.T) {
	r := NewRegistry()
	h := r.HistogramVec("dur_seconds", "durations", []float64{0.1, 1}, "route")
	child := h.With("/a")
	child.Observe(0.05)
	child.Observe(0.5)
	child.Observe(5)
	out := scrape(t, r)
	for _, want := range []string{
		`dur_seconds_bucket{route="/a",le="0.1"} 1`,
		`dur_seconds_bucket{route="/a",le="1"} 2`,
		`dur_seconds_bucket{route="/a",le="+Inf"} 3`,
		`dur_seconds_count{route="/a"} 3`,
		`dur_seconds_sum{route="/a"} 5.55`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in\n%s", want, out)
		}
	}
}

func TestSameLabelsGiveTheSameSeries(t *testing.T) {
	r := NewRegistry()
	v := r.CounterVec("c_total", "c", "a")
	if v.With("x") != v.With("x") {
		t.Fatal("With must return the same child for the same labels")
	}
}

func TestConcurrentUseIsSafe(t *testing.T) {
	r := NewRegistry()
	v := r.CounterVec("c_total", "c", "a")
	g := r.Gauge("g", "g")
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 1000; j++ {
				v.With("x").Inc()
				g.Inc()
				g.Dec()
			}
		}()
	}
	wg.Wait()
	if !strings.Contains(scrape(t, r), `c_total{a="x"} 8000`) {
		t.Fatal("lost increments")
	}
}

func TestRuntimeCollectorExposesProcessAndGo(t *testing.T) {
	r := NewRegistry()
	r.AddRuntime()
	out := scrape(t, r)
	for _, name := range []string{"go_goroutines", "go_memstats_alloc_bytes", "go_memstats_heap_inuse_bytes", "go_gc_cycles_total", "process_cpu_seconds_total", "process_start_time_seconds"} {
		if !strings.Contains(out, "\n"+name+" ") && !strings.HasPrefix(out, name+" ") {
			t.Errorf("missing %s in\n%s", name, out)
		}
	}
}

func TestSniffTypeKnownAndUnknown(t *testing.T) {
	cases := map[string]string{
		`{"t":"add","stroke":{}}`:       "add",
		`{"id":"x","t":"live","p":[1]}`: "live",
		`{"t":"nonsense"}`:              "other",
		`not json`:                      "other",
		`{"t":"cursor_drop","id":"a"}`:  "cursor_drop",
		`{"id":"` + strings.Repeat("x", 200) + `","t":"add","z":"` + strings.Repeat("y", 200) + `"}`: "other",    // type in neither the head nor the tail
		`{"background":"x","strokes":[` + strings.Repeat("1,", 500) + `2],"t":"snapshot"}`:           "snapshot", // the server's maps put "t" last
	}
	for in, want := range cases {
		if got := SniffType([]byte(in)); got != want {
			t.Errorf("SniffType(%.40q) = %q, want %q", in, got, want)
		}
	}
}

func TestWSMessageCountsByTypeAndDirection(t *testing.T) {
	before := WSMessageCount("add", "in")
	WSMessage(DirIn, []byte(`{"t":"add"}`))
	WSMessage(DirIn, []byte(`{"t":"add"}`))
	WSMessage(DirOut, []byte(`{"t":"add"}`))
	if got := WSMessageCount("add", "in") - before; got != 2 {
		t.Errorf("in add = %d, want 2", got)
	}
}

func TestWSMessageHotPathDoesNotAllocate(t *testing.T) {
	msg := []byte(`{"t":"live","id":"abc","p":[1,2,3]}`)
	if n := testing.AllocsPerRun(100, func() { WSMessage(DirIn, msg) }); n != 0 {
		t.Fatalf("WSMessage allocates %v times per call", n)
	}
}
