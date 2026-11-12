package main

import (
	"strings"
	"testing"
	"time"
)

func TestAdminTicketBelongsToOneBoardAndExpires(t *testing.T) {
	a := &app{adminSecret: []byte("0123456789abcdef0123456789abcdef")}
	now := time.Now()
	tk := a.makeAdminTicket("board1", now.Add(time.Hour))
	if !a.validAdminTicket("board1", tk, now) {
		t.Fatal("a fresh ticket is refused")
	}
	if a.validAdminTicket("board2", tk, now) {
		t.Error("a ticket works on another board")
	}
	if a.validAdminTicket("board1", tk, now.Add(2*time.Hour)) {
		t.Error("an expired ticket works")
	}
	parts := strings.SplitN(tk, ".", 2)
	flipped := "0"
	if parts[1][0] == '0' {
		flipped = "1"
	}
	for name, bad := range map[string]string{
		"empty":         "",
		"no dot":        "abc",
		"other expiry":  "99999999999." + parts[1],
		"other mac":     parts[0] + "." + flipped + parts[1][1:],
		"junk":          "x.y",
		"mac cut short": parts[0] + "." + parts[1][:10],
	} {
		if a.validAdminTicket("board1", bad, now) {
			t.Errorf("%s: accepted", name)
		}
	}
	other := &app{adminSecret: []byte("ffffffffffffffffffffffffffffffff")}
	if other.validAdminTicket("board1", tk, now) {
		t.Error("a ticket made by another server (another secret) works")
	}
}

func TestEachAppHasItsOwnSecret(t *testing.T) {
	srv1, a1, _ := testApp(t)
	srv2, a2, _ := testApp(t)
	_, _ = srv1, srv2
	if len(a1.adminSecret) < 32 || string(a1.adminSecret) == string(a2.adminSecret) {
		t.Fatal("the ticket secret is short or shared")
	}
}
