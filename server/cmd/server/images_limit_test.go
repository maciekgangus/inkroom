package main

import (
	"net/http"
	"strings"
	"testing"
)

// A whole PDF of the largest size R-056 takes (60 pages, each an image) goes up from one address.
func TestUploadLimitTakesAWholePDF(t *testing.T) {
	srv, _, _ := testApp(t)
	id := newBoard(t, srv)
	for i := 0; i < 60; i++ {
		resp, err := http.Post(srv.URL+"/api/boards/"+id+"/images", "application/octet-stream", strings.NewReader(string(pngMagic)))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("page %d = %d, want 201", i+1, resp.StatusCode)
		}
	}
}

func TestImageUploadLimitFromEnv(t *testing.T) {
	for _, c := range []struct {
		in   string
		want int
	}{
		{"", maxImageUploadsPerIP},
		{"500", 500},
		{"0", maxImageUploadsPerIP},
		{"-3", maxImageUploadsPerIP},
		{"many", maxImageUploadsPerIP},
	} {
		if got := imageUploadLimit(c.in); got != c.want {
			t.Errorf("imageUploadLimit(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}
