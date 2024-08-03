COMMIT_SHA := $(shell git rev-parse HEAD)

build:
	buildctl build \
            --frontend dockerfile.v0 \
            --local dockerfile=. \
            --local context=. \
            --output type=image,name=asia-southeast1-docker.pkg.dev/moonrhythm-core/moonrhythm/registry:$(COMMIT_SHA),push=true
