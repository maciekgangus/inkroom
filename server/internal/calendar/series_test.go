package calendar

import (
	"strings"
	"testing"
	"time"
)

func warsaw(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Europe/Warsaw")
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

func TestWeeklyOnTwoDaysStopsAtCount(t *testing.T) {
	rule := Rule{
		Start:         "2026-11-23", // a Monday
		IntervalWeeks: 1,
		Slots:         []Slot{{Day: 0, Time: "16:00", Minutes: 60}, {Day: 3, Time: "18:30", Minutes: 45}},
		Count:         5,
		Zone:          "Europe/Warsaw",
	}
	got, err := rule.Expand()
	if err != nil {
		t.Fatal(err)
	}
	loc := warsaw(t)
	want := []time.Time{
		time.Date(2026, 11, 23, 16, 0, 0, 0, loc),
		time.Date(2026, 11, 26, 18, 30, 0, 0, loc),
		time.Date(2026, 11, 30, 16, 0, 0, 0, loc),
		time.Date(2026, 12, 3, 18, 30, 0, 0, loc),
		time.Date(2026, 12, 7, 16, 0, 0, 0, loc),
	}
	if len(got) != len(want) {
		t.Fatalf("got %d spans, want %d", len(got), len(want))
	}
	for i, w := range want {
		if !got[i].Start.Equal(w) {
			t.Errorf("span %d starts %v, want %v", i, got[i].Start, w)
		}
	}
	if d := got[1].End.Sub(got[1].Start); d != 45*time.Minute {
		t.Errorf("duration %v", d)
	}
}

func TestSlotsBeforeTheStartDateAreSkipped(t *testing.T) {
	// Start on a Wednesday: the Monday slot of that week is already past.
	rule := Rule{Start: "2026-11-25", IntervalWeeks: 1, Slots: []Slot{{Day: 0, Time: "10:00", Minutes: 60}}, Count: 1, Zone: "Europe/Warsaw"}
	got, err := rule.Expand()
	if err != nil {
		t.Fatal(err)
	}
	if want := time.Date(2026, 11, 30, 10, 0, 0, 0, warsaw(t)); !got[0].Start.Equal(want) {
		t.Fatalf("got %v, want %v", got[0].Start, want)
	}
}

func TestEveryOtherWeekUntilADate(t *testing.T) {
	rule := Rule{Start: "2026-11-23", IntervalWeeks: 2, Slots: []Slot{{Day: 0, Time: "16:00", Minutes: 60}}, End: "2026-12-21", Zone: "Europe/Warsaw"}
	got, err := rule.Expand()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 { // Nov 23, Dec 7, Dec 21 (the end date counts)
		t.Fatalf("got %d spans: %v", len(got), got)
	}
}

func TestLocalTimeHoldsAcrossDaylightSaving(t *testing.T) {
	// Clocks go back on 2026-10-25: 16:00 local is 14:00 UTC before and 15:00 UTC after.
	rule := Rule{Start: "2026-10-19", IntervalWeeks: 1, Slots: []Slot{{Day: 0, Time: "16:00", Minutes: 60}}, Count: 2, Zone: "Europe/Warsaw"}
	got, err := rule.Expand()
	if err != nil {
		t.Fatal(err)
	}
	if h := got[0].Start.UTC().Hour(); h != 14 {
		t.Errorf("before: %d UTC", h)
	}
	if h := got[1].Start.UTC().Hour(); h != 15 {
		t.Errorf("after: %d UTC", h)
	}
}

func TestBadRulesAreRefused(t *testing.T) {
	ok := Rule{Start: "2026-11-23", IntervalWeeks: 1, Slots: []Slot{{Day: 0, Time: "16:00", Minutes: 60}}, Count: 3, Zone: "Europe/Warsaw"}
	cases := map[string]func(r *Rule){
		"no end":           func(r *Rule) { r.Count = 0 },
		"too many":         func(r *Rule) { r.Count = MaxLessons + 1 },
		"zero interval":    func(r *Rule) { r.IntervalWeeks = 0 },
		"no slots":         func(r *Rule) { r.Slots = nil },
		"bad day":          func(r *Rule) { r.Slots = []Slot{{Day: 7, Time: "16:00", Minutes: 60}} },
		"bad time":         func(r *Rule) { r.Slots = []Slot{{Day: 0, Time: "25:00", Minutes: 60}} },
		"bad duration":     func(r *Rule) { r.Slots = []Slot{{Day: 0, Time: "16:00", Minutes: 0}} },
		"bad zone":         func(r *Rule) { r.Zone = "Mars/Base" },
		"bad start":        func(r *Rule) { r.Start = "tomorrow" },
		"end before start": func(r *Rule) { r.Count = 0; r.End = "2026-11-01" },
	}
	for name, mutate := range cases {
		r := ok
		mutate(&r)
		if _, err := r.Expand(); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
	if _, err := ok.Expand(); err != nil {
		t.Fatalf("valid rule refused: %v", err)
	}
}

func TestEndDateAloneCannotExceedTheLimit(t *testing.T) {
	r := Rule{Start: "2026-11-23", IntervalWeeks: 1, Slots: []Slot{{Day: 0, Time: "16:00", Minutes: 60}}, End: "2040-01-01", Zone: "Europe/Warsaw"}
	_, err := r.Expand()
	if err == nil || !strings.Contains(err.Error(), "200") {
		t.Fatalf("got %v", err)
	}
}
