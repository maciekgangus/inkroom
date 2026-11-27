package store

import (
	"database/sql"
	"errors"
	"sort"
	"strings"
	"time"
)

// Personal contacts ("Znajomi") remembered for quick co-owner / transfer suggestions (R-123).
const contactsSchema = `
CREATE TABLE user_contacts (
	user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	contact_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (user_id, contact_id),
	CHECK (user_id != contact_id)
);
CREATE INDEX user_contacts_user ON user_contacts(user_id);
`

var (
	// ErrSelfContact means a user tried to add themselves as a contact.
	ErrSelfContact = errors.New("cannot add self as contact")
	// ErrAlreadyContact means the target account is already in user_contacts.
	ErrAlreadyContact = errors.New("already a contact")
)

// ContactSuggestion is one known collaborator or saved contact returned for user pickers.
// Never exposes e-mails or unrelated accounts on the server (R-053, R-123).
type ContactSuggestion struct {
	UserID   int64
	Username string
	Avatar   string
	Saved    bool
	Source   string // "contact", "coowner", "lesson", "visitor", "shared"
	Relation string // best non-contact collaboration source, if any
	LastSeen time.Time
}

// AddContact explicitly saves contactID into userID's personal contacts list.
func (s *Store) AddContact(userID, contactID int64, at time.Time) error {
	if userID == contactID {
		return ErrSelfContact
	}
	var one int
	if err := s.db.QueryRow("SELECT 1 FROM users WHERE id = ?", contactID).Scan(&one); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if err := s.db.QueryRow("SELECT 1 FROM user_contacts WHERE user_id = ? AND contact_id = ?", userID, contactID).Scan(&one); err == nil {
		return ErrAlreadyContact
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	_, err := s.db.Exec("INSERT INTO user_contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)",
		userID, contactID, unix(at))
	return err
}

// RememberContact idempotently saves contactID into userID's contacts after collaborating.
func (s *Store) RememberContact(userID, contactID int64, at time.Time) error {
	if userID == contactID || userID <= 0 || contactID <= 0 {
		return nil
	}
	_, err := s.db.Exec(`INSERT INTO user_contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)
		ON CONFLICT (user_id, contact_id) DO NOTHING`, userID, contactID, unix(at))
	return err
}

// RemoveContact removes contactID from userID's saved contacts list.
func (s *Store) RemoveContact(userID, contactID int64) error {
	return s.mustAffect(s.db.Exec("DELETE FROM user_contacts WHERE user_id = ? AND contact_id = ?", userID, contactID))
}

var sourceRank = map[string]int{
	"contact": 5,
	"coowner": 4,
	"lesson":  3,
	"visitor": 2,
	"shared":  1,
}

// ListContactSuggestions returns saved contacts and people the user has collaborated with
// (board co-owners, logged-in visitors to owned boards, owners of visited boards, and calendar
// lesson partners). Never includes self or unrelated server accounts.
func (s *Store) ListContactSuggestions(userID int64) ([]ContactSuggestion, error) {
	rows, err := s.db.Query(`
SELECT u.id, u.username, u.avatar, src.source, src.ts
FROM (
	SELECT uc.contact_id AS uid, 'contact' AS source, uc.created_at AS ts
	FROM user_contacts uc
	WHERE uc.user_id = ?

	UNION ALL

	SELECT other.user_id AS uid, 'coowner' AS source, MAX(other.added_at) AS ts
	FROM board_owners mine
	JOIN board_owners other ON other.board_id = mine.board_id AND other.user_id != mine.user_id
	WHERE mine.user_id = ?
	GROUP BY other.user_id

	UNION ALL

	SELECT v.user_id AS uid, 'visitor' AS source, MAX(v.last_opened) AS ts
	FROM board_owners mine
	JOIN visits v ON v.board_id = mine.board_id AND v.user_id != mine.user_id
	WHERE mine.user_id = ?
	GROUP BY v.user_id

	UNION ALL

	SELECT bo.user_id AS uid, 'shared' AS source, MAX(v.last_opened) AS ts
	FROM visits v
	JOIN board_owners bo ON bo.board_id = v.board_id AND bo.user_id != v.user_id
	WHERE v.user_id = ?
	GROUP BY bo.user_id

	UNION ALL

	SELECT CASE WHEN l.teacher_id = ? THEN l.student_id ELSE l.teacher_id END AS uid,
	       'lesson' AS source,
	       MAX(l.start_at) AS ts
	FROM lessons l
	WHERE l.teacher_id = ? OR l.student_id = ?
	GROUP BY uid
) src
JOIN users u ON u.id = src.uid
WHERE u.id != ?`,
		userID, userID, userID, userID, userID, userID, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byID := map[int64]ContactSuggestion{}
	for rows.Next() {
		var uid, ts int64
		var uname, avatar, source string
		if err := rows.Scan(&uid, &uname, &avatar, &source, &ts); err != nil {
			return nil, err
		}
		at := time.Unix(ts, 0)
		cur, exists := byID[uid]
		if !exists {
			rel := ""
			if source != "contact" {
				rel = source
			}
			byID[uid] = ContactSuggestion{
				UserID:   uid,
				Username: uname,
				Avatar:   avatar,
				Saved:    source == "contact",
				Source:   source,
				Relation: rel,
				LastSeen: at,
			}
			continue
		}
		if source == "contact" {
			cur.Saved = true
		} else if sourceRank[source] > sourceRank[cur.Relation] {
			cur.Relation = source
		}
		if sourceRank[source] > sourceRank[cur.Source] {
			cur.Source = source
		}
		if at.After(cur.LastSeen) {
			cur.LastSeen = at
		}
		byID[uid] = cur
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]ContactSuggestion, 0, len(byID))
	for _, c := range byID {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Saved != out[j].Saved {
			return out[i].Saved
		}
		if !out[i].LastSeen.Equal(out[j].LastSeen) {
			return out[i].LastSeen.After(out[j].LastSeen)
		}
		return strings.ToLower(out[i].Username) < strings.ToLower(out[j].Username)
	})
	return out, nil
}
