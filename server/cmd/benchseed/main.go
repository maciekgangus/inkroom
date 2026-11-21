// Command benchseed fills a board with many realistic strokes through the real store, for the
// client memory benchmark (web/bench, R-100). It is a development tool: the server image does not
// contain it. It prints the id of the new board.
//
//	go run ./cmd/benchseed -db <data dir>/inkroom.db -email test@example.test -n 20000
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	mrand "math/rand"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

// World area the strokes are spread over: it fits a 1600x900 window at the smallest zoom (0.1), so
// "the whole board in view" is a state the benchmark can reach.
const (
	worldW = 15000.0
	worldH = 8000.0
)

type stroke struct {
	ID       string       `json:"id"`
	AuthorID string       `json:"authorId"`
	Kind     string       `json:"kind,omitempty"`
	Text     string       `json:"text,omitempty"`
	Dash     string       `json:"dash,omitempty"`
	Color    string       `json:"color"`
	Size     float64      `json:"size"`
	Z        int64        `json:"z"`
	Points   [][3]float64 `json:"points"`
}

var colors = []string{"#111111", "#d32f2f", "#1976d2", "#388e3c", "#f57c00"}

func r2(v float64) float64 { return math.Round(v*100) / 100 }
func r3(v float64) float64 { return math.Round(v*1000) / 1000 }

func newID() string { return newHex(8) }

// newHex is n random bytes as hex; a board id is 16 bytes, like the server makes them.
func newHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		log.Fatal(err)
	}
	return hex.EncodeToString(b)
}

// handwriting is a smooth wandering line of 100 to 300 points with changing pressure, like a pen
// on a tablet: the heading turns a little each step and the step is about one board unit.
func handwriting(rng *mrand.Rand, z int64) stroke {
	n := 100 + rng.Intn(201)
	x, y := rng.Float64()*worldW, rng.Float64()*worldH
	heading := rng.Float64() * 2 * math.Pi
	turn := 0.0
	pressure := 0.3 + rng.Float64()*0.5
	pts := make([][3]float64, n)
	for i := range pts {
		pts[i] = [3]float64{r2(x), r2(y), r3(pressure)}
		turn = turn*0.9 + (rng.Float64()-0.5)*0.35
		heading += turn
		step := 0.6 + rng.Float64()*1.6
		x += math.Cos(heading) * step
		y += math.Sin(heading) * step
		pressure = math.Min(1, math.Max(0.1, pressure+(rng.Float64()-0.5)*0.06))
	}
	dash := "natural"
	if rng.Intn(10) < 3 {
		dash = ""
	}
	return stroke{
		ID: newID(), AuthorID: "bench", Dash: dash, Color: colors[rng.Intn(len(colors))],
		Size: []float64{1, 2.5, 5}[rng.Intn(3)], Z: z, Points: pts,
	}
}

func shape(rng *mrand.Rand, z int64) stroke {
	x, y := rng.Float64()*worldW, rng.Float64()*worldH
	w, h := 20+rng.Float64()*200, 20+rng.Float64()*120
	s := stroke{ID: newID(), AuthorID: "bench", Color: colors[rng.Intn(len(colors))], Size: 2.5, Z: z}
	switch rng.Intn(4) {
	case 0:
		s.Kind = "line"
		s.Points = [][3]float64{{r2(x), r2(y), 0.5}, {r2(x + w), r2(y + h), 0.5}}
	case 1:
		s.Kind = "rect"
		s.Points = [][3]float64{{r2(x), r2(y), 0.5}, {r2(x + w), r2(y + h), 0.5}}
	case 2:
		s.Kind = "ellipse"
		s.Points = [][3]float64{{r2(x), r2(y), 0.5}, {r2(x + w), r2(y + h), 0.5}}
	default:
		s.Kind = "text"
		s.Text = "Równanie x² + 2x − 3 = 0"
		s.Points = [][3]float64{{r2(x), r2(y), 0.5}}
	}
	return s
}

func main() {
	db := flag.String("db", "", "path of the SQLite database of the server (inkroom.db)")
	email := flag.String("email", "test@example.test", "owner of the new board")
	name := flag.String("name", "bench", "name of the board")
	n := flag.Int("n", 5000, "number of elements (about 93% freehand strokes, the rest shapes and text)")
	seed := flag.Int64("seed", 1, "random seed, so every run makes the same board")
	flag.Parse()
	if *db == "" {
		log.Fatal("-db is required")
	}
	st, err := store.Open(*db)
	if err != nil {
		log.Fatal(err)
	}
	defer st.Close()
	u, err := st.UserByEmail(*email)
	if err != nil {
		log.Fatalf("user %s: %v", *email, err)
	}
	id := newHex(16)
	if _, err := st.CreateBoard(id, u.ID, *name); err != nil {
		log.Fatal(err)
	}
	rng := mrand.New(mrand.NewSource(*seed))
	z := time.Now().UnixMilli() - int64(*n)
	const batch = 500
	var ops []store.Op
	flush := func() {
		if len(ops) == 0 {
			return
		}
		if err := st.Apply(id, ops, time.Now()); err != nil {
			log.Fatal(err)
		}
		ops = ops[:0]
	}
	for i := 0; i < *n; i++ {
		z++
		var s stroke
		if rng.Intn(100) < 93 {
			s = handwriting(rng, z)
		} else {
			s = shape(rng, z)
		}
		data, err := json.Marshal(s)
		if err != nil {
			log.Fatal(err)
		}
		ops = append(ops, store.Op{Add: true, ID: s.ID, Data: data})
		if len(ops) == batch {
			flush()
		}
	}
	flush()
	fmt.Println(id)
}
