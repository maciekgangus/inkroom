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

// errRecipient is the one answer for an account that does not exist and one the caller may not
// hand boards to, so nobody can probe which e-mails have an account (R-122).
const errRecipient = "Nie możesz wybrać tej osoby. Dodaj ją najpierw do znajomych albo zaproś na swoją tablicę"

// recipient finds the account a caller names (by id, or by username or e-mail) to make a co-owner
// or hand boards to. Only people the caller is connected to qualify (R-122); it writes the error
// and reports false otherwise.
func (a *app) recipient(w http.ResponseWriter, caller store.User, userID int64, login string) (store.User, bool) {
	login = strings.TrimSpace(login)
	var target store.User
	var err error
	switch {
	case userID > 0:
		target, err = a.st.UserByID(userID)
	case login != "":
		target, err = a.st.UserByLogin(login)
	default:
		writeError(w, http.StatusBadRequest, "Podaj nazwę użytkownika lub adres e-mail")
		return store.User{}, false
	}
	if err == nil && target.ID != caller.ID {
		var ok bool
		if ok, err = a.connectedTo(caller.ID, target.ID); err == nil && !ok {
			err = store.ErrNotFound
		}
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, errRecipient)
		return store.User{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return store.User{}, false
	}
	return target, true
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
		Login  string `json:"login"`
		UserID int64  `json:"userId"` // the person card names the account, not its shown name
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	target, ok := a.recipient(w, caller, body.UserID, body.Login)
	if !ok {
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
	target, ok := a.recipient(w, caller, 0, body.Login)
	if !ok {
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
	target, ok := a.recipient(w, u, 0, body.Login)
	if !ok {
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
