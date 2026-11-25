package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func decodePNG(t *testing.T, img image.Image) image.Image {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	out, err := png.Decode(&buf)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func nonWhite(img image.Image) int {
	n := 0
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			if r != 0xffff || g != 0xffff || bl != 0xffff {
				n++
			}
		}
	}
	return n
}

func TestRenderDrawsInk(t *testing.T) {
	els := []Element{
		stroke("a", 1, Point{0, 0, 1}, Point{50, 0, 1}, Point{50, 50, 1}),
	}
	seg := Segment{ID: "seg-1", ElementIDs: []string{"a"}, BBox: Rect{MaxX: 50, MaxY: 50}}
	img := RenderSegment(seg, els, RenderOptions{Scale: 4, MaxSide: 2048})
	out := decodePNG(t, img)
	if n := nonWhite(out); n < 500 {
		t.Fatalf("expected visible ink, got %d non-white pixels", n)
	}
}

func TestRenderFitsMaxSide(t *testing.T) {
	els := []Element{
		stroke("a", 1, Point{0, 0, 1}, Point{4000, 0, 1}, Point{4000, 2000, 1}),
	}
	seg := Segment{ID: "seg-1", ElementIDs: []string{"a"}, BBox: Rect{MaxX: 4000, MaxY: 2000}}
	img := RenderSegment(seg, els, RenderOptions{MaxSide: 512})
	b := img.Bounds()
	if b.Dx() > 512 || b.Dy() > 512 {
		t.Fatalf("image %dx%d exceeds maxSide 512", b.Dx(), b.Dy())
	}
	if b.Dx() < 100 {
		t.Fatalf("image suspiciously small: %dx%d", b.Dx(), b.Dy())
	}
}

func TestRenderAutoScaleSharpOnSmallSegment(t *testing.T) {
	els := []Element{stroke("a", 1, Point{0, 0, 1}, Point{20, 0, 1})}
	seg := Segment{ID: "seg-1", ElementIDs: []string{"a"}, BBox: Rect{MaxX: 20, MaxY: 1}}
	img := RenderSegment(seg, els, RenderOptions{MaxSide: 2048})
	if img.Bounds().Dx() < 100 {
		t.Fatalf("small segment should be scaled up for the model, got width %d", img.Bounds().Dx())
	}
}

func TestRenderSkipsTextAndImage(t *testing.T) {
	els := []Element{
		{ID: "t", Kind: "text", Text: "hello", Size: 24, Z: 1, Points: []Point{{0, 0, 0}}},
		{ID: "im", Kind: "image", Z: 2, Points: []Point{{0, 0, 0}, {100, 100, 0}}},
	}
	seg := Segment{ID: "seg-1", ElementIDs: []string{"t", "im"}, BBox: Rect{MaxX: 100, MaxY: 100}}
	img := RenderSegment(seg, els, RenderOptions{Scale: 2, MaxSide: 2048})
	if n := nonWhite(decodePNG(t, img)); n != 0 {
		t.Fatalf("text/image elements must not be rasterized, got %d ink pixels", n)
	}
}

func TestParseColor(t *testing.T) {
	cases := map[string]color.RGBA{
		"#000":      {0, 0, 0, 0xff},
		"#ffffff":   {0xff, 0xff, 0xff, 0xff},
		"#1a2B3c":   {0x1a, 0x2b, 0x3c, 0xff},
		"":          {0, 0, 0, 0xff},
		"notacolor": {0, 0, 0, 0xff},
	}
	for in, want := range cases {
		if got := parseColor(in); got != want {
			t.Errorf("parseColor(%q) = %v, want %v", in, got, want)
		}
	}
}
