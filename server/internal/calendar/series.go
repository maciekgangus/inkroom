// Package calendar expands the repeat rule of a series of lessons (R-105) into single lessons.
package calendar

import (
	"errors"
	"fmt"
	"sort"
	"time"
)

// MaxLessons is the most lessons one series may make.
const MaxLessons = 200

// DefaultZone is the zone of a series that names none.
const DefaultZone = "Europe/Warsaw"

// Slot is one lesson in a week: Day is 0 (Monday) to 6 (Sunday), Time is "HH:MM" local time.
type Slot struct {
	Day     int    `json:"day"`
	Time    string `json:"time"`
	Minutes int    `json:"minutes"`
}

// Rule repeats Slots every IntervalWeeks weeks from Start (a date, "YYYY-MM-DD") until End (a
// date that still counts) or until Count lessons exist, whichever the rule gives. Local times
// are read in Zone (an IANA name), so a lesson keeps its hour across a change of clocks.
type Rule struct {
	Start         string `json:"start"`
	IntervalWeeks int    `json:"intervalWeeks"`
	Slots         []Slot `json:"slots"`
	End           string `json:"end,omitempty"`
	Count         int    `json:"count,omitempty"`
	Zone          string `json:"zone,omitempty"`
}

// Span is one lesson's time.
type Span struct{ Start, End time.Time }

const dateLayout = "2006-01-02"

// Expand lists the lessons the rule makes, in time order.
func (r Rule) Expand() ([]Span, error) {
	zone := r.Zone
	if zone == "" {
		zone = DefaultZone
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return nil, errors.New("nieznana strefa czasowa")
	}
	start, err := time.ParseInLocation(dateLayout, r.Start, loc)
	if err != nil {
		return nil, errors.New("nieprawidłowa data początku")
	}
	var end time.Time
	if r.End != "" {
		if end, err = time.ParseInLocation(dateLayout, r.End, loc); err != nil {
			return nil, errors.New("nieprawidłowa data końca")
		}
		if end.Before(start) {
			return nil, errors.New("koniec serii jest przed początkiem")
		}
	}
	switch {
	case r.End == "" && r.Count < 1:
		return nil, errors.New("podaj koniec serii: datę albo liczbę zajęć")
	case r.Count > MaxLessons:
		return nil, fmt.Errorf("seria może mieć najwyżej %d zajęć", MaxLessons)
	case r.IntervalWeeks < 1:
		return nil, errors.New("odstęp musi wynosić co najmniej 1 tydzień")
	case len(r.Slots) == 0:
		return nil, errors.New("podaj co najmniej jeden termin w tygodniu")
	}
	type local struct{ day, hour, min, minutes int }
	slots := make([]local, 0, len(r.Slots))
	for _, s := range r.Slots {
		t, err := time.Parse("15:04", s.Time)
		if err != nil || s.Day < 0 || s.Day > 6 || s.Minutes < 1 || s.Minutes >= 24*60 {
			return nil, errors.New("nieprawidłowy termin w tygodniu")
		}
		slots = append(slots, local{s.Day, t.Hour(), t.Minute(), s.Minutes})
	}
	sort.Slice(slots, func(i, j int) bool {
		a, b := slots[i], slots[j]
		return a.day != b.day && a.day < b.day || a.day == b.day && a.hour*60+a.min < b.hour*60+b.min
	})
	monday := start.AddDate(0, 0, -((int(start.Weekday()) + 6) % 7))
	limit := MaxLessons
	if r.Count > 0 {
		limit = r.Count
	}
	var out []Span
	for week := 0; ; week++ {
		first := monday.AddDate(0, 0, 7*week*r.IntervalWeeks)
		if !end.IsZero() && first.After(end) {
			return out, nil
		}
		for _, s := range slots {
			day := first.AddDate(0, 0, s.day)
			if day.Before(start) {
				continue
			}
			if !end.IsZero() && day.After(end) {
				return out, nil
			}
			at := time.Date(day.Year(), day.Month(), day.Day(), s.hour, s.min, 0, 0, loc)
			if len(out) == limit {
				if r.Count == 0 {
					return nil, fmt.Errorf("seria może mieć najwyżej %d zajęć, skróć ją", MaxLessons)
				}
				return out, nil
			}
			out = append(out, Span{at, at.Add(time.Duration(s.minutes) * time.Minute)})
		}
		if r.Count > 0 && len(out) == limit {
			return out, nil
		}
	}
}
