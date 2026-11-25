package main

import (
	"reflect"
	"testing"
)

func stroke(id string, z float64, pts ...Point) Element {
	return Element{ID: id, Kind: "stroke", Color: "#000", Size: 4, Z: z, Points: pts}
}

func ids(seg Segment) []string { return seg.ElementIDs }

func TestSegmentSplitsDistantClusters(t *testing.T) {
	m := Manifest{BoardID: "b1", Elements: []Element{
		stroke("a", 1, Point{0, 0, 1}, Point{10, 1, 1}),
		stroke("b", 2, Point{0, 12, 1}, Point{10, 13, 1}),
		stroke("c", 3, Point{500, 500, 1}, Point{510, 500, 1}),
	}}
	segs := SegmentManifest(m, SegmentOptions{})
	if len(segs) != 2 {
		t.Fatalf("want 2 segments, got %d: %+v", len(segs), segs)
	}
	if !reflect.DeepEqual(ids(segs[0]), []string{"a", "b"}) {
		t.Errorf("reading order: first segment should be a,b, got %v", ids(segs[0]))
	}
	if !reflect.DeepEqual(ids(segs[1]), []string{"c"}) {
		t.Errorf("second segment should be c, got %v", ids(segs[1]))
	}
}

func TestSegmentFractionIsOneSegment(t *testing.T) {
	m := Manifest{BoardID: "b1", Elements: []Element{
		stroke("num", 1, Point{0, 0, 1}, Point{20, 2, 1}),
		{ID: "bar", Kind: "line", Color: "#000", Size: 4, Z: 2, Points: []Point{{-5, 10, 1}, {25, 10, 1}}},
		stroke("den", 3, Point{0, 20, 1}, Point{20, 22, 1}),
	}}
	segs := SegmentManifest(m, SegmentOptions{})
	if len(segs) != 1 {
		t.Fatalf("fraction should be one segment, got %d: %+v", len(segs), segs)
	}
	if !reflect.DeepEqual(ids(segs[0]), []string{"num", "bar", "den"}) {
		t.Errorf("element ids in drawing order, got %v", ids(segs[0]))
	}
}

func TestSegmentOrderZ(t *testing.T) {
	m := Manifest{BoardID: "b1", Elements: []Element{
		stroke("low", 5, Point{0, 500, 1}, Point{10, 500, 1}),
		stroke("top", 1, Point{0, 0, 1}, Point{10, 0, 1}),
	}}
	segs := SegmentManifest(m, SegmentOptions{Order: "z"})
	if len(segs) != 2 || ids(segs[0])[0] != "top" {
		t.Fatalf("order=z should put the element drawn first first, got %+v", segs)
	}
	segs = SegmentManifest(m, SegmentOptions{Order: "reading"})
	if len(segs) != 2 || ids(segs[0])[0] != "top" {
		t.Fatalf("reading order should put the upper element first, got %+v", segs)
	}
}

func TestSegmentTextJoinsNearbyStroke(t *testing.T) {
	m := Manifest{BoardID: "b1", Elements: []Element{
		stroke("eq", 1, Point{0, 0, 1}, Point{30, 2, 1}),
		{ID: "note", Kind: "text", Text: "wynik", Color: "#b00", Size: 24, Z: 2, Points: []Point{{40, 0, 0}}},
	}}
	segs := SegmentManifest(m, SegmentOptions{})
	if len(segs) != 1 || !reflect.DeepEqual(ids(segs[0]), []string{"eq", "note"}) {
		t.Fatalf("text near a stroke should join its segment, got %+v", segs)
	}
}

func TestSegmentEmpty(t *testing.T) {
	if segs := SegmentManifest(Manifest{}, SegmentOptions{}); len(segs) != 0 {
		t.Fatalf("empty manifest should give no segments, got %+v", segs)
	}
}
