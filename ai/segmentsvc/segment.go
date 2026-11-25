package main

import (
	"fmt"
	"math"
	"sort"
)

// Segment is a group of elements that belong together (one expression, one
// annotation). It is the unit rendered to an image and sent to the
// recognition model.
type Segment struct {
	ID         string   `json:"id"`
	ElementIDs []string `json:"elementIds"` // in drawing order (z, then id)
	BBox       Rect     `json:"bbox"`
}

// SegmentOptions controls clustering.
type SegmentOptions struct {
	// Gap is the largest empty space (board units) between two elements that
	// still keeps them in one segment. Zero picks a default derived from the
	// median element size.
	Gap float64 `json:"gap"`
	// Order sorts the segments: "reading" (top to bottom, left to right) or
	// "z" (drawing order of the first element). Default "reading".
	Order string `json:"order"`
}

// Segment groups the manifest elements into segments. Two elements land in
// one segment when their bounding boxes, each expanded by half the gap,
// intersect (union-find over all pairs).
func SegmentManifest(m Manifest, opts SegmentOptions) []Segment {
	n := len(m.Elements)
	if n == 0 {
		return nil
	}
	gap := opts.Gap
	if gap <= 0 {
		gap = defaultGap(m.Elements)
	}
	boxes := make([]Rect, n)
	kept := make([]int, 0, n) // indices of elements with geometry
	for i, e := range m.Elements {
		if b, ok := elementBBox(e); ok {
			boxes[i] = b
			kept = append(kept, i)
		}
	}
	if len(kept) == 0 {
		return nil
	}

	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	union := func(a, b int) {
		parent[find(a)] = find(b)
	}
	for _, i := range kept {
		for _, j := range kept {
			if i >= j {
				continue
			}
			if expandedIntersect(boxes[i], boxes[j], gap) {
				union(i, j)
			}
		}
	}

	groups := map[int][]int{}
	for _, i := range kept {
		groups[find(i)] = append(groups[find(i)], i)
	}
	segs := make([]Segment, 0, len(groups))
	for _, members := range groups {
		sort.Slice(members, func(a, b int) bool {
			x, y := m.Elements[members[a]], m.Elements[members[b]]
			if x.Z != y.Z {
				return x.Z < y.Z
			}
			return x.ID < y.ID
		})
		seg := Segment{BBox: boxes[members[0]]}
		for _, mi := range members {
			seg.ElementIDs = append(seg.ElementIDs, m.Elements[mi].ID)
			seg.BBox = unionRect(seg.BBox, boxes[mi])
		}
		segs = append(segs, seg)
	}

	order := opts.Order
	if order == "" {
		order = "reading"
	}
	sort.Slice(segs, func(a, b int) bool {
		if order == "z" {
			return firstZ(m, segs[a]) < firstZ(m, segs[b])
		}
		if segs[a].BBox.MinY != segs[b].BBox.MinY {
			return segs[a].BBox.MinY < segs[b].BBox.MinY
		}
		return segs[a].BBox.MinX < segs[b].BBox.MinX
	})
	for i := range segs {
		segs[i].ID = fmt.Sprintf("seg-%d", i+1)
	}
	return segs
}

// elementBBox returns the bounding box of one element. Text has only its
// anchor point on the board, so its box is estimated from the string length
// and font size. Elements without any geometry (empty text) are skipped.
func elementBBox(e Element) (Rect, bool) {
	if len(e.Points) > 0 {
		r := Rect{MinX: e.Points[0][0], MinY: e.Points[0][1], MaxX: e.Points[0][0], MaxY: e.Points[0][1]}
		for _, p := range e.Points[1:] {
			if p[0] < r.MinX {
				r.MinX = p[0]
			}
			if p[0] > r.MaxX {
				r.MaxX = p[0]
			}
			if p[1] < r.MinY {
				r.MinY = p[1]
			}
			if p[1] > r.MaxY {
				r.MaxY = p[1]
			}
		}
		if len(e.Points) == 1 {
			// A lone anchor point (text): grow the box by the estimated text size.
			w, h := textExtent(e)
			r.MaxX += w
			r.MaxY += h
		}
		return r, true
	}
	if e.Text != "" {
		w, h := textExtent(e)
		return Rect{MaxX: w, MaxY: h}, true
	}
	return Rect{}, false
}

// textExtent estimates the size of a text element in board units.
func textExtent(e Element) (w, h float64) {
	size := e.Size
	if size <= 0 {
		size = 18
	}
	h = size * 1.25
	w = size * 0.55 * float64(len([]rune(e.Text)))
	return w, h
}

// defaultGap derives the clustering gap from the median element size: strokes
// of a typical pen width are ~3..6 board units, and symbols of one expression
// sit within a few stroke widths of each other.
func defaultGap(els []Element) float64 {
	sizes := make([]float64, 0, len(els))
	for _, e := range els {
		s := e.Size
		if s <= 0 {
			s = 4
		}
		sizes = append(sizes, s)
	}
	sort.Float64s(sizes)
	median := sizes[len(sizes)/2]
	gap := 3 * median
	if gap < 24 {
		gap = 24
	}
	if gap > 120 {
		gap = 120
	}
	return gap
}

func expandedIntersect(a, b Rect, gap float64) bool {
	h := gap / 2
	return a.MinX-h <= b.MaxX+h && b.MinX-h <= a.MaxX+h &&
		a.MinY-h <= b.MaxY+h && b.MinY-h <= a.MaxY+h
}

func unionRect(a, b Rect) Rect {
	return Rect{
		MinX: math.Min(a.MinX, b.MinX),
		MinY: math.Min(a.MinY, b.MinY),
		MaxX: math.Max(a.MaxX, b.MaxX),
		MaxY: math.Max(a.MaxY, b.MaxY),
	}
}

func firstZ(m Manifest, seg Segment) float64 {
	byID := make(map[string]Element, len(m.Elements))
	for _, e := range m.Elements {
		byID[e.ID] = e
	}
	z := math.Inf(1)
	for _, id := range seg.ElementIDs {
		if e, ok := byID[id]; ok && e.Z < z {
			z = e.Z
		}
	}
	return z
}
