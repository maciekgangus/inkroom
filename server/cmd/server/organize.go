package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/maciekgangus/inkroom/server/internal/auth"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

const (
	maxOrgName         = 48
	maxBulkBoards      = 200
	maxMarkersPerBoard = 20
	maxOrgBodyBytes    = 32 << 10
)

type folderJSON struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Color    string `json:"color,omitempty"`
	Position int    `json:"position"`
}

type markerJSON struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color,omitempty"`
}

func foldersToJSON(folders []store.Folder) []folderJSON {
	out := make([]folderJSON, 0, len(folders))
	for _, f := range folders {
		out = append(out, folderJSON{ID: f.ID, Name: f.Name, Color: f.Color, Position: f.Position})
	}
	return out
}

func markersToJSON(markers []store.Marker) []markerJSON {
	out := make([]markerJSON, 0, len(markers))
	for _, m := range markers {
		out = append(out, markerJSON{ID: m.ID, Name: m.Name, Color: m.Color})
	}
	return out
}

func validOrgName(raw string) (string, bool) {
	name := strings.TrimSpace(raw)
	n := utf8.RuneCountInString(name)
	return name, n >= 1 && n <= maxOrgName
}

func (a *app) createFolder(w http.ResponseWriter, r *http.Request) {
	u, ok := a.accountUser(w, r)
	if !ok || !auth.RequireJSON(w, r) {
		return
	}
	var body struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	name, ok := validOrgName(body.Name)
	if !ok {
		writeError(w, http.StatusBadRequest, "Nazwa folderu musi mieć od 1 do 48 znaków")
		return
	}
	if !store.ValidOrgColor(body.Color) {
		writeError(w, http.StatusBadRequest, "Nieznany kolor")
		return
	}
	f, err := a.st.CreateFolder(newBoardID(), u.ID, name, body.Color)
	if errors.Is(err, store.ErrDuplicateName) {
		writeError(w, http.StatusConflict, "Folder o tej nazwie już istnieje")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusCreated, folderJSON{ID: f.ID, Name: f.Name, Color: f.Color, Position: f.Position})
}

func (a *app) updateFolder(w http.ResponseWriter, r *http.Request) {
	u, ok := a.accountUser(w, r)
	if !ok || !auth.RequireJSON(w, r) {
		return
	}
	var body struct {
		Name     *string `json:"name"`
		Color    *string `json:"color"`
		Position *int    `json:"position"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	var namePtr *string
	if body.Name != nil {
		name, valid := validOrgName(*body.Name)
		if !valid {
			writeError(w, http.StatusBadRequest, "Nazwa folderu musi mieć od 1 do 48 znaków")
			return
		}
		namePtr = &name
	}
	if body.Color != nil && !store.ValidOrgColor(*body.Color) {
		writeError(w, http.StatusBadRequest, "Nieznany kolor")
		return
	}
	f, err := a.st.UpdateFolder(u.ID, r.PathValue("id"), namePtr, body.Color, body.Position)
	if errors.Is(err, store.ErrDuplicateName) {
		writeError(w, http.StatusConflict, "Folder o tej nazwie już istnieje")
		return
	}
	if err != nil {
		storeFail(w, err, "Nie ma takiego folderu")
		return
	}
	writeJSON(w, http.StatusOK, folderJSON{ID: f.ID, Name: f.Name, Color: f.Color, Position: f.Position})
}

func (a *app) deleteFolder(w http.ResponseWriter, r *http.Request) {
	u, ok := a.accountUser(w, r)
	if !ok {
		return
	}
	if err := a.st.DeleteFolder(u.ID, r.PathValue("id")); err != nil {
		storeFail(w, err, "Nie ma takiego folderu")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) createMarker(w http.ResponseWriter, r *http.Request) {
	u, ok := a.accountUser(w, r)
	if !ok || !auth.RequireJSON(w, r) {
		return
	}
	var body struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	name, ok := validOrgName(body.Name)
	if !ok {
		writeError(w, http.StatusBadRequest, "Nazwa markera musi mieć od 1 do 48 znaków")
		return
	}
	if !store.ValidOrgColor(body.Color) {
		writeError(w, http.StatusBadRequest, "Nieznany kolor")
		return
	}
	m, err := a.st.CreateMarker(newBoardID(), u.ID, name, body.Color)
	if errors.Is(err, store.ErrDuplicateName) {
		writeError(w, http.StatusConflict, "Marker o tej nazwie już istnieje")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	writeJSON(w, http.StatusCreated, markerJSON{ID: m.ID, Name: m.Name, Color: m.Color})
}

func (a *app) updateMarker(w http.ResponseWriter, r *http.Request) {
	u, ok := a.accountUser(w, r)
	if !ok || !auth.RequireJSON(w, r) {
		return
	}
	var body struct {
		Name  *string `json:"name"`
		Color *string `json:"color"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	var namePtr *string
	if body.Name != nil {
		name, valid := validOrgName(*body.Name)
		if !valid {
			writeError(w, http.StatusBadRequest, "Nazwa markera musi mieć od 1 do 48 znaków")
			return
		}
		namePtr = &name
	}
	if body.Color != nil && !store.ValidOrgColor(*body.Color) {
		writeError(w, http.StatusBadRequest, "Nieznany kolor")
		return
	}
	m, err := a.st.UpdateMarker(u.ID, r.PathValue("id"), namePtr, body.Color)
	if errors.Is(err, store.ErrDuplicateName) {
		writeError(w, http.StatusConflict, "Marker o tej nazwie już istnieje")
		return
	}
	if err != nil {
		storeFail(w, err, "Nie ma takiego markera")
		return
	}
	writeJSON(w, http.StatusOK, markerJSON{ID: m.ID, Name: m.Name, Color: m.Color})
}

func (a *app) deleteMarker(w http.ResponseWriter, r *http.Request) {
	u, ok := a.accountUser(w, r)
	if !ok {
		return
	}
	if err := a.st.DeleteMarker(u.ID, r.PathValue("id")); err != nil {
		storeFail(w, err, "Nie ma takiego markera")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) updateBoardMeta(w http.ResponseWriter, r *http.Request) {
	u, ok := a.accountUser(w, r)
	if !ok || !auth.RequireJSON(w, r) {
		return
	}
	var body struct {
		FolderID  *string   `json:"folderId"`
		Pinned    *bool     `json:"pinned"`
		Position  *int      `json:"position"`
		MarkerIDs *[]string `json:"markerIds"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	if body.MarkerIDs != nil && len(*body.MarkerIDs) > maxMarkersPerBoard {
		writeError(w, http.StatusBadRequest, "Za dużo markerów na jednej tablicy")
		return
	}
	patch := store.BoardMetaPatch{
		FolderID:  body.FolderID,
		Pinned:    body.Pinned,
		Position:  body.Position,
		MarkerIDs: body.MarkerIDs,
	}
	if err := a.st.UpdateBoardMeta(u.ID, r.PathValue("id"), patch); err != nil {
		storeFail(w, err, "Nie znaleziono")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) bulkOrganizeBoards(w http.ResponseWriter, r *http.Request) {
	u, ok := a.accountUser(w, r)
	if !ok || !auth.RequireJSON(w, r) {
		return
	}
	var body struct {
		BoardIDs        []string `json:"boardIds"`
		FolderID        *string  `json:"folderId"`
		Pinned          *bool    `json:"pinned"`
		AddMarkerIDs    []string `json:"addMarkerIds"`
		RemoveMarkerIDs []string `json:"removeMarkerIds"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxOrgBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	if len(body.BoardIDs) == 0 || len(body.BoardIDs) > maxBulkBoards {
		writeError(w, http.StatusBadRequest, "Podaj od 1 do 200 tablic")
		return
	}
	if len(body.AddMarkerIDs) > maxMarkersPerBoard || len(body.RemoveMarkerIDs) > maxMarkersPerBoard {
		writeError(w, http.StatusBadRequest, "Za dużo markerów")
		return
	}
	patch := store.BulkOrganizePatch{
		BoardIDs:        body.BoardIDs,
		FolderID:        body.FolderID,
		Pinned:          body.Pinned,
		AddMarkerIDs:    body.AddMarkerIDs,
		RemoveMarkerIDs: body.RemoveMarkerIDs,
	}
	if err := a.st.BulkOrganize(u.ID, patch); err != nil {
		storeFail(w, err, "Nie znaleziono")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) setBoardOrder(w http.ResponseWriter, r *http.Request) {
	u, ok := a.accountUser(w, r)
	if !ok || !auth.RequireJSON(w, r) {
		return
	}
	var body struct {
		BoardIDs []string `json:"boardIds"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxOrgBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	if len(body.BoardIDs) == 0 || len(body.BoardIDs) > maxBulkBoards {
		writeError(w, http.StatusBadRequest, "Podaj od 1 do 200 tablic")
		return
	}
	if err := a.st.SetBoardOrder(u.ID, body.BoardIDs); err != nil {
		storeFail(w, err, "Nie znaleziono")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
