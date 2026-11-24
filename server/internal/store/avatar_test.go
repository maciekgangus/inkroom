package store

import (
	"testing"
	"time"
)

func TestAvatarIsKeptWithTheAccount(t *testing.T) {
	s := open(t)
	u := user(t, s, "a@example.com")
	if u.Avatar != "" {
		t.Fatalf("a new account has an avatar: %q", u.Avatar)
	}
	if err := s.SetAvatar(u.ID, "fox"); err != nil {
		t.Fatal(err)
	}
	got, err := s.UserByEmail("a@example.com")
	if err != nil || got.Avatar != "fox" {
		t.Fatalf("by e-mail: %+v %v", got, err)
	}
	if err := s.CreateSession("tok", u.ID, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	got, err = s.SessionUser("tok", time.Now())
	if err != nil || got.Avatar != "fox" {
		t.Fatalf("by session: %+v %v", got, err)
	}
	if err := s.SetAvatar(u.ID, ""); err != nil {
		t.Fatal(err)
	}
	if got, _ = s.UserByEmail("a@example.com"); got.Avatar != "" {
		t.Fatalf("not cleared: %q", got.Avatar)
	}
	if err := s.SetAvatar(u.ID+100, "fox"); err == nil {
		t.Fatal("an avatar for a missing account was accepted")
	}
}
