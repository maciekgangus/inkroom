package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/auth"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

type boardOwnerJSON struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Avatar   string `json:"avatar,omitempty"`
}

func ownersToJSON(owners []store.BoardOwner) []boardOwnerJSON {
	out := make([]boardOwnerJSON, 0, len(owners))
	for _, o := range owners {
		out = append(out, boardOwnerJSON{
			ID:       o.UserID,
			Username: o.Username,
			Avatar:   o.Avatar,
		})
	}
	return out
}

func userPerson(userID int64) string {
	return "u:" + strconv.FormatInt(userID, 10)
}

func (a *app) listBoardOwners(w http.ResponseWriter, r *http.Request) {
	b, _, ok := a.ownedBoardUser(w, r)
	if !ok {
		return
	}
	owners, err := a.st.ListBoardOwners(b.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"owners": ownersToJSON(owners)})
}

func (a *app) addBoardOwner(w http.ResponseWriter, r *http.Request) {
	b, caller, ok := a.ownedBoardUser(w, r)
	if !ok || !auth.RequireJSON(w, r) {
		return
	}
	var body struct {
		Login string `json:"login"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	login := strings.TrimSpace(body.Login)
	if login == "" {
		writeError(w, http.StatusBadRequest, "Podaj nazwę użytkownika lub adres e-mail")
		return
	}
	target, err := a.st.UserByLogin(login)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Nie ma takiego konta")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	now := time.Now()
	if err := a.st.AddBoardOwner(b.ID, target.ID, now); err != nil {
		if errors.Is(err, store.ErrAlreadyOwner) {
			writeError(w, http.StatusConflict, "Ta osoba jest już właścicielem tej tablicy")
			return
		}
		storeFail(w, err, "Nie ma takiej tablicy")
		return
	}
	_ = a.st.RememberContact(caller.ID, target.ID, now)
	a.hub.SetOwner(b.ID, userPerson(target.ID), true)
	owners, err := a.st.ListBoardOwners(b.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"added":  boardOwnerJSON{ID: target.ID, Username: target.Username, Avatar: target.Avatar},
		"owners": ownersToJSON(owners),
	})
}

func (a *app) removeBoardOwner(w http.ResponseWriter, r *http.Request) {
	b, caller, ok := a.ownedBoardUser(w, r)
	if !ok {
		return
	}
	targetID, err := strconv.ParseInt(r.PathValue("userId"), 10, 64)
	if err != nil || targetID <= 0 {
		writeError(w, http.StatusBadRequest, "Nieprawidłowy identyfikator użytkownika")
		return
	}
	if err := a.st.RemoveBoardOwner(b.ID, targetID, time.Now()); err != nil {
		switch {
		case errors.Is(err, store.ErrLastOwner):
			writeError(w, http.StatusBadRequest, "Tablica musi mieć co najmniej jednego właściciela")
		case errors.Is(err, store.ErrNotFound):
			writeError(w, http.StatusNotFound, "Ta osoba nie jest właścicielem tej tablicy")
		default:
			writeError(w, http.StatusInternalServerError, "Błąd serwera")
		}
		return
	}
	a.hub.SetOwner(b.ID, userPerson(targetID), false)
	owners, err := a.st.ListBoardOwners(b.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"owners":      ownersToJSON(owners),
		"selfRemoved": targetID == caller.ID,
	})
}

func (a *app) transferBoard(w http.ResponseWriter, r *http.Request) {
	b, caller, ok := a.ownedBoardUser(w, r)
	if !ok || !auth.RequireJSON(w, r) {
		return
	}
	var body struct {
		Login string `json:"login"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	login := strings.TrimSpace(body.Login)
	if login == "" {
		writeError(w, http.StatusBadRequest, "Podaj nazwę użytkownika lub adres e-mail")
		return
	}
	target, err := a.st.UserByLogin(login)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Nie ma takiego konta")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	now := time.Now()
	if err := a.st.TransferBoardOwnership(b.ID, target.ID, now); err != nil {
		if errors.Is(err, store.ErrAlreadyOwner) {
			writeError(w, http.StatusBadRequest, "Ta osoba jest już jedynym właścicielem tej tablicy")
			return
		}
		storeFail(w, err, "Nie ma takiej tablicy")
		return
	}
	_ = a.st.RememberContact(caller.ID, target.ID, now)
	a.hub.SetSoleOwner(b.ID, userPerson(target.ID))
	owners, err := a.st.ListBoardOwners(b.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"owner":  target.Username,
		"owners": ownersToJSON(owners),
	})
}

func (a *app) bulkTransferBoards(w http.ResponseWriter, r *http.Request) {
	u, ok := a.accountUser(w, r)
	if !ok {
		return
	}
	var body struct {
		BoardIDs []string `json:"boardIds"`
		Login    string   `json:"login"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	if len(body.BoardIDs) == 0 || len(body.BoardIDs) > 200 {
		writeError(w, http.StatusBadRequest, "Wybierz od 1 do 200 tablic")
		return
	}
	login := strings.TrimSpace(body.Login)
	if login == "" {
		writeError(w, http.StatusBadRequest, "Podaj nazwę użytkownika lub adres e-mail")
		return
	}
	target, err := a.st.UserByLogin(login)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Nie ma takiego konta")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	now := time.Now()
	if err := a.st.TransferBoardsOwnership(body.BoardIDs, u.ID, target.ID, now); err != nil {
		if errors.Is(err, store.ErrForbidden) {
			writeError(w, http.StatusForbidden, "Możesz przekazać tylko tablice, których jesteś właścicielem")
			return
		}
		storeFail(w, err, "Nie ma takiej tablicy")
		return
	}
	_ = a.st.RememberContact(u.ID, target.ID, now)
	person := userPerson(target.ID)
	for _, bid := range body.BoardIDs {
		a.hub.SetSoleOwner(bid, person)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"owner":       target.Username,
		"transferred": len(body.BoardIDs),
	})
}
