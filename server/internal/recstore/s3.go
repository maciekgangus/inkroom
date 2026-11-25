package recstore

import (
	"context"
	"mime"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// S3 keeps recordings in a bucket of any S3-compatible service: R2, Google Cloud Storage (its S3
// interoperability mode), MinIO. The server only starts, joins and removes uploads; the video
// itself goes between the browser and the bucket.
type S3 struct {
	core   *minio.Core
	bucket string
	// Origin is the scheme and host of the bucket's addresses: the page's CSP must allow it.
	Origin string
}

// NewS3 connects to the bucket. `endpoint` is a host (R2: <account>.r2.cloudflarestorage.com),
// with "http://" in front for a service without TLS (a local MinIO); region may be empty (R2
// takes "auto"). It does not call the service, so a wrong address shows at the first recording.
func NewS3(endpoint, bucket, accessKey, secretKey, region string) (*S3, error) {
	secure := true
	switch {
	case strings.HasPrefix(endpoint, "http://"):
		secure = false
		endpoint = strings.TrimPrefix(endpoint, "http://")
	case strings.HasPrefix(endpoint, "https://"):
		endpoint = strings.TrimPrefix(endpoint, "https://")
	}
	endpoint = strings.TrimSuffix(endpoint, "/")
	if region == "" {
		region = "auto"
	}
	core, err := minio.NewCore(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: secure,
		Region: region,
	})
	if err != nil {
		return nil, err
	}
	scheme := "https://"
	if !secure {
		scheme = "http://"
	}
	return &S3{core: core, bucket: bucket, Origin: scheme + endpoint}, nil
}

func (s *S3) Name() string { return "s3" }

func (s *S3) Start(ctx context.Context, key, mimeType string) (string, error) {
	return s.core.NewMultipartUpload(ctx, s.bucket, key, minio.PutObjectOptions{ContentType: mimeType})
}

func (s *S3) PartURL(ctx context.Context, key, uploadID string, n int, ttl time.Duration) (string, error) {
	if n < 1 || n > MaxParts {
		return "", ErrBadPart
	}
	u, err := s.core.Presign(ctx, "PUT", s.bucket, key, ttl, url.Values{
		"uploadId":   {uploadID},
		"partNumber": {strconv.Itoa(n)},
	})
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

// Complete joins the parts 1..k that arrived, where k+1 is the first missing one: a hole would
// leave a gap in the video, so what comes after it is left out.
func (s *S3) Complete(ctx context.Context, key, uploadID string) (int64, error) {
	var parts []minio.CompletePart
	var size int64
	marker := 0
	for {
		res, err := s.core.ListObjectParts(ctx, s.bucket, key, uploadID, marker, 1000)
		if err != nil {
			return 0, err
		}
		for _, p := range res.ObjectParts {
			if p.PartNumber != len(parts)+1 {
				res.IsTruncated = false // a hole: stop here
				break
			}
			parts = append(parts, minio.CompletePart{PartNumber: p.PartNumber, ETag: p.ETag})
			size += p.Size
		}
		if !res.IsTruncated {
			break
		}
		marker = res.NextPartNumberMarker
	}
	if len(parts) == 0 {
		_ = s.core.AbortMultipartUpload(ctx, s.bucket, key, uploadID)
		return 0, ErrNoParts
	}
	if _, err := s.core.CompleteMultipartUpload(ctx, s.bucket, key, uploadID, parts, minio.PutObjectOptions{}); err != nil {
		return 0, err
	}
	return size, nil
}

func (s *S3) Remove(ctx context.Context, key, uploadID string, completed bool) error {
	var err error
	if completed {
		err = s.core.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
	} else {
		err = s.core.AbortMultipartUpload(ctx, s.bucket, key, uploadID)
	}
	// Gone already is as good as removed.
	if code := minio.ToErrorResponse(err).Code; code == "NoSuchUpload" || code == "NoSuchKey" {
		return nil
	}
	return err
}

func (s *S3) DownloadURL(ctx context.Context, key, filename, mimeType string, ttl time.Duration) (string, error) {
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": filename})
	if disposition == "" {
		disposition = "attachment"
	}
	u, err := s.core.Presign(ctx, "GET", s.bucket, key, ttl, url.Values{
		"response-content-disposition": {disposition},
		"response-content-type":        {mimeType},
	})
	if err != nil {
		return "", err
	}
	return u.String(), nil
}
