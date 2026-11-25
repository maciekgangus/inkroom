package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"strings"
)

// Recognizer turns one segment image into LaTeX.
type Recognizer interface {
	Recognize(ctx context.Context, img image.Image, segmentID string) (string, error)
	Name() string
}

// latexPrompt is kept short and strict: the answer is parsed mechanically.
const latexPrompt = "Recognize the handwritten mathematical expression in this image. " +
	"Reply with ONLY the LaTeX source of the expression. No commentary, no markdown fences."

// UniMuMER calls an OpenAI-compatible chat endpoint (vLLM serving a Uni-MuMER
// checkpoint, e.g. phxember/Uni-MuMER-Qwen2.5-VL-3B on Hugging Face).
type UniMuMER struct {
	BaseURL string
	Model   string
	APIKey  string
	Client  *http.Client
}

func (u *UniMuMER) Name() string { return u.Model }

type chatRequest struct {
	Model       string    `json:"model"`
	Messages    []chatMsg `json:"messages"`
	MaxTokens   int       `json:"max_tokens"`
	Temperature float64   `json:"temperature"`
}

type chatMsg struct {
	Role    string        `json:"role"`
	Content []contentPart `json:"content"`
}

type contentPart struct {
	Type     string    `json:"type"`
	Text     string    `json:"text,omitempty"`
	ImageURL *imageURL `json:"image_url,omitempty"`
}

type imageURL struct {
	URL string `json:"url"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (u *UniMuMER) Recognize(ctx context.Context, img image.Image, segmentID string) (string, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return "", fmt.Errorf("encode segment %s: %w", segmentID, err)
	}
	reqBody := chatRequest{
		Model: u.Model,
		Messages: []chatMsg{{
			Role: "user",
			Content: []contentPart{
				{Type: "text", Text: latexPrompt},
				{Type: "image_url", ImageURL: &imageURL{
					URL: "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()),
				}},
			},
		}},
		MaxTokens:   1024,
		Temperature: 0,
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.BaseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if u.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+u.APIKey)
	}
	resp, err := u.Client.Do(req)
	if err != nil {
		return "", fmt.Errorf("segment %s: %w", segmentID, err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("segment %s: model endpoint %s: %s", segmentID, resp.Status, strings.TrimSpace(string(respBody)))
	}
	var cr chatResponse
	if err := json.Unmarshal(respBody, &cr); err != nil {
		return "", fmt.Errorf("segment %s: decode response: %w", segmentID, err)
	}
	if cr.Error != nil {
		return "", fmt.Errorf("segment %s: model error: %s", segmentID, cr.Error.Message)
	}
	if len(cr.Choices) == 0 {
		return "", fmt.Errorf("segment %s: empty choices in model response", segmentID)
	}
	return trimLatex(cr.Choices[0].Message.Content), nil
}

// trimLatex strips whitespace and markdown fences a chatty model may add.
func trimLatex(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		if i := strings.Index(s, "\n"); i >= 0 {
			s = s[i+1:]
		}
		s = strings.TrimSuffix(strings.TrimSpace(s), "```")
		s = strings.TrimSpace(s)
	}
	return s
}
