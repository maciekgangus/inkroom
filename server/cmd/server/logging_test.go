package main

import (
	"io"
	"log/slog"
	"os"
	"testing"

	"github.com/maciekgangus/inkroom/server/internal/logx"
)

// TestMain keeps the logs of the tests off the screen; tests that look at them call captureLogs.
func TestMain(m *testing.M) {
	logx.Use(io.Discard, "app", slog.LevelError, true)
	os.Exit(m.Run())
}
