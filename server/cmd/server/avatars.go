package main

import (
	"net/http"
	"strconv"
)

// avatarIDs are the pictures an account may show (R-111): the files in web/public/avatars, from
// Microsoft Fluent Emoji (Flat, MIT). A test keeps this list and the files the same.
var avatarIDs = map[string]bool{}

func init() {
	for _, id := range []string{
		"dog", "cat", "fox", "panda", "koala", "tiger", "lion", "frog", "monkey", "rabbit", "bear", "pig",
		"cow", "unicorn", "octopus", "penguin", "owl", "hamster", "wolf", "raccoon", "hedgehog", "turtle",
		"whale", "butterfly", "ladybug", "bee", "dragon", "sloth",
		"cool", "starstruck", "nerd", "party", "cowboy", "robot", "alien", "ghost",
	} {
		avatarIDs[id] = true
	}
}

// putAvatar sets the account's picture, or none with "", and shows it at once on every board the
// account is on.
func (a *app) putAvatar(w http.ResponseWriter, r *http.Request) {
	u, ok := a.accountUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Avatar string `json:"avatar"`
	}
	if !readBody(w, r, &body) {
		return
	}
	if body.Avatar != "" && !avatarIDs[body.Avatar] {
		writeError(w, http.StatusBadRequest, "Nieznany awatar")
		return
	}
	if err := a.st.SetAvatar(u.ID, body.Avatar); err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	a.hub.SetAvatar("u:"+strconv.FormatInt(u.ID, 10), body.Avatar)
	w.WriteHeader(http.StatusNoContent)
}
