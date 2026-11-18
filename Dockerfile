# syntax=docker/dockerfile:1

# ---- ClassMeet web app (Next.js) ----
FROM oven/bun:1.2 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.2 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM oven/bun:1.2-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 classmeet && \
    adduser --system --uid 1001 classmeet

COPY --from=builder --chown=classmeet:classmeet /app/.next/standalone ./
COPY --from=builder --chown=classmeet:classmeet /app/.next/static ./.next/static
COPY --from=builder --chown=classmeet:classmeet /app/public ./public

USER classmeet
EXPOSE 3000

CMD ["bun", "server.js"]
