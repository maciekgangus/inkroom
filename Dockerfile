# syntax=docker/dockerfile:1
# The release (image tag or commit), told to the browser and the server so an old tab notices (R-099).
ARG VERSION=dev

# Pinned patch version, not the floating 22-alpine tag (security audit 2026-11; multi-arch, so local builds on arm64 still work).
FROM node:22.23.5-alpine AS web
ARG VERSION
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN VITE_APP_VERSION=$VERSION npm run build

FROM golang:1.26.11-alpine AS server
ARG VERSION
WORKDIR /server
COPY server/go.mod server/go.sum* ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.buildVersion=$VERSION" -o /out/server ./cmd/server \
 && mkdir -p /out/data

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /out/server /app/server
# Owned by the non-root user so the named volume mounted here is writable.
COPY --from=server --chown=nonroot:nonroot /out/data /data
COPY --from=web /web/dist /app/static
ENV STATIC_DIR=/app/static DATA_DIR=/data PORT=8080
EXPOSE 8080
ENTRYPOINT ["/app/server"]
