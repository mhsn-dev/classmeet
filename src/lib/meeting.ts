export const MAX_PARTICIPANTS = 18

/**
 * Serverless signaling via Trystero (https://trystero.dev).
 * Peer discovery happens over public relays (Nostr by default, MQTT as a
 * fallback) — no backend is ever needed, so the app runs on GitHub Pages
 * or any static file server with ~0 CPU/RAM usage. All media and data is
 * peer-to-peer (WebRTC), end-to-end encrypted.
 */
export const TRYSTERO_APP_ID = 'classmeet-turquoise-v1'

export type SignalingStrategy = 'nostr' | 'mqtt'

export const SIGNALING_STRATEGY_LABELS: Record<SignalingStrategy, string> = {
  nostr: 'رله‌های عمومی Nostr (پیش‌فرض)',
  mqtt: 'بروکر عمومی MQTT / EMQX',
}

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun.cloudflare.com:3478',
      ],
    },
  ],
  iceCandidatePoolSize: 4,
}

/** Free public TURN relays so peers behind strict NATs can still connect. */
export const TURN_SERVERS = [
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
]

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** Google-Meet-like room code: xxx-xxxx-xxx */
export function generateRoomCode(): string {
  const pick = (n: number) =>
    Array.from(crypto.getRandomValues(new Uint32Array(n)))
      .map((v) => CODE_ALPHABET[v % CODE_ALPHABET.length])
      .join('')
  return `${pick(3)}-${pick(4)}-${pick(3)}`
}

export function normalizeRoomCode(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function isValidRoomCode(raw: string): boolean {
  const clean = normalizeRoomCode(raw)
  return clean.length >= 4 && clean.length <= 24
}

export function formatRoomCode(clean: string): string {
  if (clean.length === 10) return `${clean.slice(0, 3)}-${clean.slice(3, 7)}-${clean.slice(7)}`
  return clean
}

export function formatElapsedTime(startedAt: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  const pad = (v: number) => v.toString().padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export const REACTION_ICONS = ['thumbsUp', 'heart', 'party', 'laugh', 'lightbulb', 'smile'] as const
export type ReactionIcon = (typeof REACTION_ICONS)[number]

export const REACTION_META: Record<ReactionIcon, { iconKey: string; label: string }> = {
  thumbsUp: { iconKey: 'thumbsUp', label: 'پسندیدم' },
  heart: { iconKey: 'heart', label: 'قلب' },
  party: { iconKey: 'party', label: 'تبریک' },
  laugh: { iconKey: 'laugh', label: 'خنده' },
  lightbulb: { iconKey: 'lightbulb', label: 'ایده' },
  smile: { iconKey: 'smile', label: 'لبخند' },
}

const AVATAR_COLORS = [
  '#2dd4bf', // turquoise
  '#14b8a6', // teal
  '#22c55e', // green
  '#eab308', // yellow
  '#f97316', // orange
  '#ec4899', // pink
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f43f5e', // rose
]

/** Deterministic color for a peer id — every client derives the same color. */
export function colorForId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
