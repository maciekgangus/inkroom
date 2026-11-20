package metrics

import (
	"fmt"
	"io"
	"os"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var startTime = time.Now()

// AddRuntime registers the Go runtime and process metrics (goroutines, memory, GC, CPU, open
// files), read at every scrape. ReadMemStats stops the world for a moment, which is fine at the
// pace of a scrape every 15 seconds or so.
func (r *Registry) AddRuntime() {
	r.Func("go_goroutines", "Number of goroutines.", "gauge", func(w io.Writer) {
		fmt.Fprintf(w, "go_goroutines %d\n", runtime.NumGoroutine())
	})
	mem := func(name, help, kind string, pick func(*runtime.MemStats) uint64) {
		r.Func(name, help, kind, func(w io.Writer) {
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			fmt.Fprintf(w, "%s %d\n", name, pick(&m))
		})
	}
	mem("go_memstats_alloc_bytes", "Bytes of allocated heap objects.", "gauge", func(m *runtime.MemStats) uint64 { return m.Alloc })
	mem("go_memstats_heap_inuse_bytes", "Bytes in in-use heap spans.", "gauge", func(m *runtime.MemStats) uint64 { return m.HeapInuse })
	mem("go_memstats_sys_bytes", "Bytes obtained from the system.", "gauge", func(m *runtime.MemStats) uint64 { return m.Sys })
	mem("go_gc_cycles_total", "Completed GC cycles.", "counter", func(m *runtime.MemStats) uint64 { return uint64(m.NumGC) })
	r.Func("go_gc_pause_seconds_total", "Total time paused by GC.", "counter", func(w io.Writer) {
		var m runtime.MemStats
		runtime.ReadMemStats(&m)
		fmt.Fprintf(w, "go_gc_pause_seconds_total %s\n", formatFloat(float64(m.PauseTotalNs)/1e9))
	})
	r.Func("process_cpu_seconds_total", "User and system CPU time of the process.", "counter", func(w io.Writer) {
		var ru syscall.Rusage
		if err := syscall.Getrusage(syscall.RUSAGE_SELF, &ru); err != nil {
			fmt.Fprintf(w, "process_cpu_seconds_total 0\n")
			return
		}
		sec := float64(ru.Utime.Sec) + float64(ru.Utime.Usec)/1e6 + float64(ru.Stime.Sec) + float64(ru.Stime.Usec)/1e6
		fmt.Fprintf(w, "process_cpu_seconds_total %s\n", formatFloat(sec))
	})
	r.Func("process_start_time_seconds", "Start time of the process, seconds since the Unix epoch.", "gauge", func(w io.Writer) {
		fmt.Fprintf(w, "process_start_time_seconds %d\n", startTime.Unix())
	})
	r.Func("process_resident_memory_bytes", "Resident memory size in bytes (Linux).", "gauge", func(w io.Writer) {
		if b, err := os.ReadFile("/proc/self/statm"); err == nil {
			if f := strings.Fields(string(b)); len(f) > 1 {
				if pages, err := strconv.ParseUint(f[1], 10, 64); err == nil {
					fmt.Fprintf(w, "process_resident_memory_bytes %d\n", pages*uint64(os.Getpagesize()))
				}
			}
		}
	})
	r.Func("process_open_fds", "Number of open file descriptors (Linux).", "gauge", func(w io.Writer) {
		if ents, err := os.ReadDir("/proc/self/fd"); err == nil {
			fmt.Fprintf(w, "process_open_fds %d\n", len(ents))
		}
	})
}
