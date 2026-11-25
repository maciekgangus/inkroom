package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config comes from the environment:
//
//	PORT                      listen port, default 8090
//	UNIMUMER_BASE_URL         OpenAI-compatible endpoint, e.g. http://gpu-box:8000 (vLLM)
//	UNIMUMER_MODEL            model name, default phxember/Uni-MuMER-Qwen2.5-VL-3B
//	UNIMUMER_API_KEY          bearer token, if the endpoint requires one
//	UNIMUMER_TIMEOUT_SECONDS  per-segment request timeout, default 120
func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}
	var rec Recognizer
	if base := os.Getenv("UNIMUMER_BASE_URL"); base != "" {
		model := os.Getenv("UNIMUMER_MODEL")
		if model == "" {
			model = "phxember/Uni-MuMER-Qwen2.5-VL-3B"
		}
		timeout := 120 * time.Second
		if v := os.Getenv("UNIMUMER_TIMEOUT_SECONDS"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				timeout = time.Duration(n) * time.Second
			}
		}
		rec = &UniMuMER{
			BaseURL: strings.TrimRight(base, "/"),
			Model:   model,
			APIKey:  os.Getenv("UNIMUMER_API_KEY"),
			Client:  &http.Client{Timeout: timeout},
		}
		log.Printf("recognizer: %s (model %s)", base, model)
	} else {
		log.Print("UNIMUMER_BASE_URL not set: /api/segment works, /api/analyze returns 503")
	}
	srv := &Server{Rec: rec}
	log.Printf("segmentsvc listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, srv.routes()))
}
