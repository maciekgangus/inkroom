// Package metrics is a small, dependency-free implementation of the Prometheus text format
// (version 0.0.4): counters, gauges and histograms with labels, plus Go runtime and process
// collectors. It is written by hand so the hot paths stay lock-free and allocation-free
// (ADR 0022); the services of Inkroom (the app now, later the recorder) share it.
package metrics

import (
	"bytes"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

// Counter only goes up.
type Counter struct{ v atomic.Uint64 }

// Inc adds one.
func (c *Counter) Inc() { c.v.Add(1) }

// Add adds n.
func (c *Counter) Add(n uint64) { c.v.Add(n) }

// Value returns the current count.
func (c *Counter) Value() uint64 { return c.v.Load() }

// Gauge goes up and down.
type Gauge struct{ v atomic.Int64 }

// Inc adds one.
func (g *Gauge) Inc() { g.v.Add(1) }

// Dec subtracts one.
func (g *Gauge) Dec() { g.v.Add(-1) }

// Add adds n (negative to subtract).
func (g *Gauge) Add(n int64) { g.v.Add(n) }

// Set replaces the value.
func (g *Gauge) Set(n int64) { g.v.Store(n) }

// Value returns the current value.
func (g *Gauge) Value() int64 { return g.v.Load() }

// Histogram counts observations into fixed buckets (upper bounds in seconds).
type Histogram struct {
	bounds  []float64
	buckets []atomic.Uint64 // len(bounds)+1: the last one is +Inf
	sumNs   atomic.Int64    // the sum, in nanoseconds, so it can be kept in an integer
	count   atomic.Uint64
}

// Observe records a value in seconds.
func (h *Histogram) Observe(seconds float64) {
	i := sort.SearchFloat64s(h.bounds, seconds) // the first bound >= seconds
	h.buckets[i].Add(1)
	h.count.Add(1)
	h.sumNs.Add(int64(seconds * 1e9))
}

// CounterVec is a family of counters told apart by label values.
type CounterVec struct {
	labels   []string
	children sync.Map // joined label values -> *Counter
}

// With returns the counter for the label values (created on first use).
func (v *CounterVec) With(values ...string) *Counter {
	key := joinKey(values)
	if c, ok := v.children.Load(key); ok {
		return c.(*Counter)
	}
	c, _ := v.children.LoadOrStore(key, &Counter{})
	return c.(*Counter)
}

// HistogramVec is a family of histograms told apart by label values.
type HistogramVec struct {
	bounds   []float64
	labels   []string
	children sync.Map // joined label values -> *Histogram
}

// With returns the histogram for the label values (created on first use).
func (v *HistogramVec) With(values ...string) *Histogram {
	key := joinKey(values)
	if h, ok := v.children.Load(key); ok {
		return h.(*Histogram)
	}
	h, _ := v.children.LoadOrStore(key, &Histogram{bounds: v.bounds, buckets: make([]atomic.Uint64, len(v.bounds)+1)})
	return h.(*Histogram)
}

func joinKey(values []string) string {
	if len(values) == 1 {
		return values[0]
	}
	return strings.Join(values, "\xff")
}

type collector struct {
	name, help, kind string
	write            func(w *bytes.Buffer)
}

// Registry holds the metrics of one process and serves them.
type Registry struct {
	mu         sync.Mutex
	collectors []collector
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry { return &Registry{} }

func (r *Registry) add(c collector) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.collectors = append(r.collectors, c)
}

// Counter registers a counter without labels.
func (r *Registry) Counter(name, help string) *Counter {
	c := &Counter{}
	r.add(collector{name, help, "counter", func(w *bytes.Buffer) { fmt.Fprintf(w, "%s %d\n", name, c.Value()) }})
	return c
}

// Gauge registers a gauge without labels.
func (r *Registry) Gauge(name, help string) *Gauge {
	g := &Gauge{}
	r.add(collector{name, help, "gauge", func(w *bytes.Buffer) { fmt.Fprintf(w, "%s %d\n", name, g.v.Load()) }})
	return g
}

// CounterVec registers a family of counters with the given label names.
func (r *Registry) CounterVec(name, help string, labels ...string) *CounterVec {
	v := &CounterVec{labels: labels}
	r.add(collector{name, help, "counter", func(w *bytes.Buffer) {
		for _, k := range sortedKeys(&v.children) {
			c, _ := v.children.Load(k)
			fmt.Fprintf(w, "%s%s %d\n", name, labelSet(labels, k, ""), c.(*Counter).Value())
		}
	}})
	return v
}

// HistogramVec registers a family of histograms with the given bucket bounds (seconds, ascending).
func (r *Registry) HistogramVec(name, help string, bounds []float64, labels ...string) *HistogramVec {
	v := &HistogramVec{bounds: bounds, labels: labels}
	r.add(collector{name, help, "histogram", func(w *bytes.Buffer) {
		for _, k := range sortedKeys(&v.children) {
			c, _ := v.children.Load(k)
			h := c.(*Histogram)
			var cum uint64
			for i, b := range bounds {
				cum += h.buckets[i].Load()
				fmt.Fprintf(w, "%s_bucket%s %d\n", name, labelSet(labels, k, formatFloat(b)), cum)
			}
			cum += h.buckets[len(bounds)].Load()
			fmt.Fprintf(w, "%s_bucket%s %d\n", name, labelSet(labels, k, "+Inf"), cum)
			fmt.Fprintf(w, "%s_sum%s %s\n", name, labelSet(labels, k, ""), formatFloat(float64(h.sumNs.Load())/1e9))
			fmt.Fprintf(w, "%s_count%s %d\n", name, labelSet(labels, k, ""), h.count.Load())
		}
	}})
	return v
}

// Func registers a metric whose lines come from write at every scrape (the runtime collector).
func (r *Registry) Func(name, help, kind string, write func(w io.Writer)) {
	r.add(collector{name, help, kind, func(w *bytes.Buffer) { write(w) }})
}

// Handler serves the registry in the Prometheus text format.
func (r *Registry) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		r.mu.Lock()
		cs := append([]collector(nil), r.collectors...)
		r.mu.Unlock()
		sort.SliceStable(cs, func(i, j int) bool { return cs[i].name < cs[j].name })
		var buf bytes.Buffer
		for _, c := range cs {
			fmt.Fprintf(&buf, "# HELP %s %s\n# TYPE %s %s\n", c.name, c.help, c.name, c.kind)
			c.write(&buf)
		}
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		_, _ = w.Write(buf.Bytes())
	})
}

func sortedKeys(m *sync.Map) []string {
	var keys []string
	m.Range(func(k, _ any) bool { keys = append(keys, k.(string)); return true })
	sort.Strings(keys)
	return keys
}

// labelSet renders {a="x",b="y"} for a joined key, with an optional le label for buckets.
func labelSet(labels []string, key, le string) string {
	values := []string{key}
	if len(labels) > 1 {
		values = strings.Split(key, "\xff")
	}
	var b strings.Builder
	b.WriteByte('{')
	for i, l := range labels {
		if i > 0 {
			b.WriteByte(',')
		}
		v := ""
		if i < len(values) {
			v = values[i]
		}
		b.WriteString(l + `="` + escape(v) + `"`)
	}
	if le != "" {
		if len(labels) > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`le="` + le + `"`)
	}
	b.WriteByte('}')
	return b.String()
}

func escape(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return strings.ReplaceAll(s, "\n", `\n`)
}

func formatFloat(f float64) string {
	if math.IsInf(f, 1) {
		return "+Inf"
	}
	return strconv.FormatFloat(f, 'g', -1, 64)
}
