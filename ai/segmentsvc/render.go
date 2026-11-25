package main

import (
	"image"
	"image/color"
	"math"
	"strconv"
	"strings"
)

// RenderOptions controls rasterizing one segment to a PNG for the model.
type RenderOptions struct {
	// Scale is pixels per board unit. Zero picks it automatically so the
	// longest side fits MaxSide (capped at 8 px/unit for sharpness).
	Scale float64
	// MaxSide caps the longest image side in pixels. Default 2048.
	MaxSide int
	// Pad is empty space around the segment in board units. Default 12.
	Pad float64
}

// RenderSegment rasterizes the segment's elements onto a white background.
// Freehand strokes and shape outlines are drawn from their points; text and
// image elements are skipped — text travels verbatim in the manifest JSON.
func RenderSegment(seg Segment, elements []Element, opts RenderOptions) *image.RGBA {
	byID := make(map[string]Element, len(elements))
	for _, e := range elements {
		byID[e.ID] = e
	}
	maxSide := opts.MaxSide
	if maxSide <= 0 {
		maxSide = 2048
	}
	pad := opts.Pad
	if pad <= 0 {
		pad = 12
	}
	w := math.Max(seg.BBox.MaxX-seg.BBox.MinX, 1)
	h := math.Max(seg.BBox.MaxY-seg.BBox.MinY, 1)
	padded := math.Max(w, h) + 2*pad
	scale := opts.Scale
	if scale <= 0 {
		scale = float64(maxSide) / padded
	}
	if scale > 8 {
		scale = 8
	}
	if fit := float64(maxSide) / padded; scale > fit {
		scale = fit
	}
	width := min(int(math.Ceil((w+2*pad)*scale)), maxSide)
	height := min(int(math.Ceil((h+2*pad)*scale)), maxSide)

	img := image.NewRGBA(image.Rect(0, 0, width, height))
	fillRect(img, img.Bounds(), color.RGBA{0xff, 0xff, 0xff, 0xff})

	els := make([]Element, 0, len(seg.ElementIDs))
	for _, id := range seg.ElementIDs {
		if e, ok := byID[id]; ok {
			els = append(els, e)
		}
	}
	for _, e := range els {
		drawElement(img, e, seg.BBox, scale, pad)
	}
	return img
}

func drawElement(img *image.RGBA, e Element, bbox Rect, scale, pad float64) {
	col := parseColor(e.Color)
	lw := e.Size * scale
	if lw < 1 {
		lw = 1
	}
	switch e.Kind {
	case "text", "image":
		return
	case "rect":
		if pts := outlineRect(e.Points); pts != nil {
			drawStroke(img, pts, bbox, scale, pad, lw, col)
		}
	case "ellipse", "circle":
		if pts := outlineEllipse(e.Points); pts != nil {
			drawStroke(img, pts, bbox, scale, pad, lw, col)
		}
	default:
		if len(e.Points) >= 2 {
			drawStroke(img, e.Points, bbox, scale, pad, lw, col)
		}
	}
}

// outlineRect turns two corner points into a closed rectangle outline.
func outlineRect(pts []Point) []Point {
	if len(pts) < 2 {
		return nil
	}
	x0, y0 := pts[0][0], pts[0][1]
	x1, y1 := pts[1][0], pts[1][1]
	return []Point{{x0, y0, 0}, {x1, y0, 0}, {x1, y1, 0}, {x0, y1, 0}, {x0, y0, 0}}
}

// outlineEllipse samples an ellipse inscribed in the two-corner box (for
// "circle", the second point is on the circumference, so use it as radius).
func outlineEllipse(pts []Point) []Point {
	if len(pts) < 2 {
		return nil
	}
	cx, cy := pts[0][0], pts[0][1]
	var rx, ry float64
	if len(pts) >= 2 {
		rx = math.Abs(pts[1][0] - cx)
		ry = math.Abs(pts[1][1] - cy)
	}
	if rx < 1 {
		rx = 1
	}
	if ry < 1 {
		ry = 1
	}
	const n = 72
	out := make([]Point, 0, n+1)
	for i := 0; i <= n; i++ {
		a := 2 * math.Pi * float64(i) / n
		out = append(out, Point{cx + rx*math.Cos(a), cy + ry*math.Sin(a), 0})
	}
	return out
}

// drawStroke draws a polyline with round caps and joins by stamping filled
// circles along it (the board's own renderer does the same with freehand).
func drawStroke(img *image.RGBA, pts []Point, bbox Rect, scale, pad, w float64, col color.RGBA) {
	r := w / 2
	if r < 0.75 {
		r = 0.75
	}
	step := r / 2
	if step < 0.5 {
		step = 0.5
	}
	toPx := func(p Point) (float64, float64) {
		return (p[0] - bbox.MinX + pad) * scale, (p[1] - bbox.MinY + pad) * scale
	}
	for i, p := range pts {
		x, y := toPx(p)
		fillCircle(img, x, y, r, col)
		if i == 0 {
			continue
		}
		x0, y0 := toPx(pts[i-1])
		d := math.Hypot(x-x0, y-y0)
		n := int(d/step) + 1
		for j := 1; j < n; j++ {
			t := float64(j) / float64(n)
			fillCircle(img, x0+(x-x0)*t, y0+(y-y0)*t, r, col)
		}
	}
}

func fillCircle(img *image.RGBA, cx, cy, r float64, col color.RGBA) {
	b := img.Bounds()
	for y := int(math.Floor(cy - r)); y <= int(math.Ceil(cy+r)); y++ {
		for x := int(math.Floor(cx - r)); x <= int(math.Ceil(cx+r)); x++ {
			dx, dy := float64(x)-cx, float64(y)-cy
			if dx*dx+dy*dy <= r*r && image.Pt(x, y).In(b) {
				img.SetRGBA(x, y, col)
			}
		}
	}
}

func fillRect(img *image.RGBA, r image.Rectangle, col color.RGBA) {
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			img.SetRGBA(x, y, col)
		}
	}
}

// parseColor understands #rgb and #rrggbb; anything else is black.
func parseColor(s string) color.RGBA {
	s = strings.TrimPrefix(strings.TrimSpace(s), "#")
	if len(s) == 3 {
		s = string([]byte{s[0], s[0], s[1], s[1], s[2], s[2]})
	}
	if len(s) != 6 {
		return color.RGBA{0, 0, 0, 0xff}
	}
	v, err := strconv.ParseUint(s, 16, 32)
	if err != nil {
		return color.RGBA{0, 0, 0, 0xff}
	}
	return color.RGBA{byte(v >> 16), byte(v >> 8), byte(v), 0xff}
}
