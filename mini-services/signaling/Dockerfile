# ---- ClassMeet signaling server (socket.io over WebRTC signaling) ----
FROM oven/bun:1.2-slim
WORKDIR /srv
COPY package.json ./
RUN bun install --production --frozen-lockfile
COPY index.ts ./
EXPOSE 3003
USER bun
CMD ["bun", "run", "index.ts"]
