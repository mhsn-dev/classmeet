# syntax=docker/dockerfile:1

# ---- ClassMeet — fully static build ----
# Signaling is serverless (Trystero over public relays) and all media flows
# peer-to-peer, so the whole app is static files. This image runs comfortably
# on a 2GB RAM / 1 CPU core VPS (nginx uses only a few MB).

FROM oven/bun:1.2 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV STATIC_BUILD=1
RUN bun run build:static

FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/out /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
