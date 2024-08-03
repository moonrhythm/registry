package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"gocloud.dev/blob"
)

var bucket *blob.Bucket

type registryError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Detail  string `json:"detail"`
}

type registryErrorResult struct {
	Errors []registryError `json:"errors"`
}

var (
	ErrBlobUnknown = registryError{ // code-1
		"BLOB_UNKNOWN",
		"blob unknown to registry",
		"blob unknown to registry",
	}

	ErrBlobUploadUnknown = registryError{ // code-3
		"BLOB_UPLOAD_UNKNOWN",
		"blob upload unknown to registry",
		"blob upload unknown to registry",
	}

	ErrManifestUnknown = registryError{ // code-7
		"MANIFEST_UNKNOWN",
		"manifest unknown to registry",
		"manifest unknown to registry",
	}

	ErrUnauthorized = registryError{ // code-11
		"UNAUTHORIZED",
		"authentication required",
		"authentication required",
	}

	ErrUnsupported = registryError{ // code-13
		"UNSUPPORTED",
		"the operation is unsupported",
		"the operation is unsupported",
	}
)

// https://github.com/opencontainers/distribution-spec/blob/main/spec.md

type Registry struct {
	name   string
	digest string
}

func (reg Registry) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// /{name}/blobs/{digest}
	if i := strings.Index(r.URL.Path, "/blobs/"); i != -1 {
		reg.name = r.URL.Path[1:i]
		reg.digest = r.URL.Path[i+7:]

		switch r.Method {
		case http.MethodGet:
			reg.GetBlob(ctx, w)
		case http.MethodHead:
			reg.HeadBlob(ctx, w)
		}
	}

	reg.OK(ctx, w)
}

func (reg Registry) OK(_ context.Context, w http.ResponseWriter) {
	w.Write([]byte("ok"))
}

func (reg Registry) GetBlob(ctx context.Context, w http.ResponseWriter) {
	log.Println("name:", reg.name)
	log.Println("digest:", reg.digest)

	obj, err := bucket.NewReader(ctx, reg.name+"/blobs/"+reg.digest, nil)
	if err != nil {
		registryErrorResponse(w, http.StatusNotFound, ErrBlobUnknown)
		return
	}
	defer obj.Close()

	// TODO: get shasum from db ?
	s := sha256.New()
	_, err = io.Copy(s, obj)
	if err != nil {
		registryErrorResponse(w, http.StatusInternalServerError, ErrBlobUploadUnknown)
		return
	}
	_, err = obj.Seek(0, io.SeekStart)
	if err != nil {
		registryErrorResponse(w, http.StatusInternalServerError, ErrBlobUploadUnknown)
		return
	}

	w.Header().Set("Docker-Content-Digest", hexToDigest(s.Sum(nil)))
	w.Header().Set("Content-Length", objSize(obj.Size()))
	w.Header().Set("Cache-Control", "public, max-age=31536000; immutable")
	io.Copy(w, obj)
}

func (reg Registry) HeadBlob(ctx context.Context, w http.ResponseWriter) {
	log.Println("name:", reg.name)
	log.Println("digest:", reg.digest)

	obj, err := bucket.NewReader(ctx, reg.name+"/blobs/"+reg.digest, nil)
	if err != nil {
		registryErrorResponse(w, http.StatusNotFound, ErrBlobUnknown)
		return
	}
	defer obj.Close()

	// TODO: get shasum from db ?
	s := sha256.New()
	_, err = io.Copy(s, obj)
	if err != nil {
		registryErrorResponse(w, http.StatusInternalServerError, ErrBlobUploadUnknown)
		return
	}

	w.Header().Set("Docker-Content-Digest", hexToDigest(s.Sum(nil)))
	w.Header().Set("Content-Length", objSize(obj.Size()))
}

func registryErrorResponse(w http.ResponseWriter, status int, errors ...registryError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(registryErrorResult{Errors: errors})
}

func hexToDigest(hexData []byte) string {
	return "sha256:" + hex.EncodeToString(hexData)
}

func objSize(i int64) string {
	return strconv.FormatInt(i, 10)
}
