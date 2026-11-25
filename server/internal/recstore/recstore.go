// Package recstore keeps the video of lesson recordings (R-094, R-112): in an S3-compatible
// bucket (Cloudflare R2 by default), where the browser sends the parts straight to the bucket
// through signed addresses, or, when no bucket is configured, in a directory on the app server.
package recstore

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	// PartSize is the size of every part but the last. S3 wants at least 5 MiB, and R2 wants all
	// parts but the last of one size; the disk store relies on it to place a part by its number.
	PartSize = 5 << 20
	// MaxParts is the most parts S3 takes for one object (10000 parts are 48 GiB: far beyond the
	// longest recording).
	MaxParts = 10000
)

var (
	// ErrNoParts is returned by Complete when no part arrived: there is no recording to keep.
	ErrNoParts = errors.New("no parts uploaded")
	// ErrBadPart is a part number outside 1..MaxParts.
	ErrBadPart = errors.New("bad part number")
	// ErrPartTooBig is a part larger than PartSize.
	ErrPartTooBig = errors.New("part too big")
	// ErrBadKey is an object name that would leave the store's directory.
	ErrBadKey = errors.New("bad key")
)

// Backend is what the app needs from a store. A store that takes parts straight from the browser
// (S3) answers PartURL and DownloadURL with addresses; the disk store answers "", and the app
// then takes the parts and sends the file itself.
type Backend interface {
	// Name is "s3" or "disk"; it is kept with each recording, so both can be in use.
	Name() string
	// Start prepares the upload of an object; the id it returns names the upload in later calls.
	Start(ctx context.Context, key, mime string) (uploadID string, err error)
	// PartURL is where the browser PUTs part n (1-based), valid for ttl.
	PartURL(ctx context.Context, key, uploadID string, n int, ttl time.Duration) (string, error)
	// Complete joins the parts that arrived (the unbroken run from part 1) into the object and
	// returns its size. ErrNoParts when none arrived; the upload is then dropped.
	Complete(ctx context.Context, key, uploadID string) (size int64, err error)
	// Remove deletes the object, or the unfinished upload when `completed` is false.
	Remove(ctx context.Context, key, uploadID string, completed bool) error
	// DownloadURL is where the browser GETs the object as an attachment named `filename`.
	DownloadURL(ctx context.Context, key, filename, mime string, ttl time.Duration) (string, error)
}

// Disk keeps each recording as one file in Dir; a part is written at its place in the file.
type Disk struct{ Dir string }

func (d *Disk) Name() string { return "disk" }

func (d *Disk) path(key string) (string, error) {
	if key == "" || key == "." || key == ".." || strings.ContainsAny(key, `/\`) {
		return "", ErrBadKey
	}
	return filepath.Join(d.Dir, key), nil
}

func (d *Disk) Start(context.Context, string, string) (string, error) {
	return "", os.MkdirAll(d.Dir, 0o755)
}

func (d *Disk) PartURL(context.Context, string, string, int, time.Duration) (string, error) {
	return "", nil
}

func (d *Disk) DownloadURL(context.Context, string, string, string, time.Duration) (string, error) {
	return "", nil
}

// WritePart puts part n (read from r, at most PartSize bytes) at its place in the file. Parts may
// come in any order and the same part again (a retry) overwrites itself.
func (d *Disk) WritePart(key string, n int, r io.Reader) error {
	p, err := d.path(key)
	if err != nil {
		return err
	}
	if n < 1 || n > MaxParts {
		return ErrBadPart
	}
	data, err := io.ReadAll(io.LimitReader(r, PartSize+1))
	if err != nil {
		return err
	}
	if len(data) > PartSize {
		return ErrPartTooBig
	}
	if err := os.MkdirAll(d.Dir, 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.WriteAt(data, int64(n-1)*PartSize); err != nil {
		return err
	}
	return f.Close()
}

func (d *Disk) Complete(_ context.Context, key, _ string) (int64, error) {
	p, err := d.path(key)
	if err != nil {
		return 0, err
	}
	info, err := os.Stat(p)
	if errors.Is(err, os.ErrNotExist) || (err == nil && info.Size() == 0) {
		_ = os.Remove(p)
		return 0, ErrNoParts
	}
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

func (d *Disk) Remove(_ context.Context, key, _ string, _ bool) error {
	p, err := d.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// Open opens the file of a recording for download.
func (d *Disk) Open(key string) (*os.File, error) {
	p, err := d.path(key)
	if err != nil {
		return nil, err
	}
	return os.Open(p)
}
