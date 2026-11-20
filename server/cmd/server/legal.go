package main

import (
	"embed"
	"html/template"
	"log/slog"
	"net/http"
	"strings"
)

//go:embed legal/*.html
var legalFS embed.FS

// legalUpdated is the date shown as the last change of the texts; bump it when they change.
const legalUpdated = "18 listopada 2026"

// legalData is what the legal pages are filled with.
type legalData struct {
	Operator string // who runs the service (OPERATOR_NAME); empty: not set yet
	Contact  string // the contact e-mail (CONTACT_EMAIL)
	Updated  string
}

// configureLegal sets the operator named on /privacy and /terms (R-096). Both may be empty;
// the pages then say that the operator's details are still to be filled in.
func (a *app) configureLegal(operator, contact string) {
	a.legal = legalData{Operator: strings.TrimSpace(operator), Contact: strings.TrimSpace(contact), Updated: legalUpdated}
	if a.legal.Operator == "" || a.legal.Contact == "" {
		slog.Warn("OPERATOR_NAME or CONTACT_EMAIL is not set: /privacy and /terms show a placeholder instead of the operator")
	}
}

// legalPage serves one of the static legal texts as plain HTML, no login and no JavaScript.
func (a *app) legalPage(name string) http.HandlerFunc {
	t := template.Must(template.ParseFS(legalFS, "legal/layout.html", "legal/"+name+".html"))
	return func(w http.ResponseWriter, _ *http.Request) {
		d := a.legal
		if d.Updated == "" {
			d.Updated = legalUpdated
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=300")
		if err := t.ExecuteTemplate(w, "layout", d); err != nil {
			slog.Error("rendering a legal page", "page", name, "err", err)
		}
	}
}
