package main

import (
	"context"
	"log"
	"log/slog"
	"net/http"

	"github.com/acoshift/configfile"
	"github.com/moonrhythm/httpmux"
	"github.com/moonrhythm/parapet"
	"gocloud.dev/blob"
	_ "gocloud.dev/blob/gcsblob"
)

func main() {
	config := configfile.NewEnvReader()
	port := config.StringDefault("PORT", "8080")
	bucketURL := config.MustString("BUCKET")

	srv := parapet.NewBackend()
	srv.Addr = ":" + port

	ctx := context.Background()

	var err error
	bucket, err = blob.OpenBucket(ctx, bucketURL)
	if err != nil {
		log.Fatal(err)
	}

	mux := httpmux.New()
	mux.Handle("/v2/", http.StripPrefix("/v2", Registry{}))

	srv.Handler = mux

	slog.Info("start server", "addr", srv.Addr)

	err = srv.ListenAndServe()
	if err != nil {
		log.Fatal(err)
	}
}
