package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"time"
)

// adminTicketTTL is how long a ticket to enter a board as the Administrator stays valid: a
// working session, so a reconnecting page still has it.
const adminTicketTTL = 12 * time.Hour

func newAdminSecret() []byte {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}

func (a *app) adminMAC(boardID, expiry string) string {
	m := hmac.New(sha256.New, a.adminSecret)
	m.Write([]byte(boardID + "|" + expiry))
	return hex.EncodeToString(m.Sum(nil))
}

// makeAdminTicket signs that its holder may appear on the board under the name Administrator
// until `until`. The key is made when the server starts, so a restart cancels every ticket.
func (a *app) makeAdminTicket(boardID string, until time.Time) string {
	exp := strconv.FormatInt(until.Unix(), 10)
	return exp + "." + a.adminMAC(boardID, exp)
}

// validAdminTicket checks a ticket for the board: made by this server, for this board, not expired.
func (a *app) validAdminTicket(boardID, ticket string, now time.Time) bool {
	exp, mac, ok := strings.Cut(ticket, ".")
	if !ok {
		return false
	}
	until, err := strconv.ParseInt(exp, 10, 64)
	if err != nil || now.Unix() > until {
		return false
	}
	return hmac.Equal([]byte(mac), []byte(a.adminMAC(boardID, exp)))
}
