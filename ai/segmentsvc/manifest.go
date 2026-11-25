package main

// Point is one sample of a stroke: x and y in board units, p is pen pressure
// in 0..1. It matches the wire format of the web client, which packs stroke
// points as [x, y, p] (web/src/board/points.ts).
type Point [3]float64

// Element is the subset of the board Stroke (web/src/board/board.ts) that the
// segmentation service needs. Extra fields of the client stroke are ignored.
type Element struct {
	ID       string  `json:"id"`
	Kind     string  `json:"kind,omitempty"`
	Text     string  `json:"text,omitempty"`
	Color    string  `json:"color"`
	Size     float64 `json:"size"`
	Z        float64 `json:"z"`
	AuthorID string  `json:"authorId"`
	Points   []Point `json:"points"`
}

// Manifest is the export bundle the web client produces at lesson end: the
// full element list of one board. Text elements carry their string verbatim,
// so they never need OCR.
type Manifest struct {
	BoardID  string    `json:"boardId"`
	Title    string    `json:"title,omitempty"`
	Elements []Element `json:"elements"`
}

// Rect is an axis-aligned rectangle in board units.
type Rect struct {
	MinX float64 `json:"minX"`
	MinY float64 `json:"minY"`
	MaxX float64 `json:"maxX"`
	MaxY float64 `json:"maxY"`
}
