export const MAX_PARTICIPANTS = 18

/**
 * Socket endpoint configuration.
 * - Sandbox/gateway: relative URL with XTransformPort (Caddy routes it).
 * - Production: set NEXT_PUBLIC_SIGNALING_URL='' (same origin) and
 *   NEXT_PUBLIC_SOCKET_PATH='/socket.io' behind a reverse proxy.
 */
const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL ?? '/?XTransformPort=3003'
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH ?? '/'

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
      ],
    },
  ],
  iceCandidatePoolSize: 4,
}

export function getSignalingUrl(): string {
  return SIGNALING_URL
}

export function getSocketPath(): string {
  return SOCKET_PATH
}

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
