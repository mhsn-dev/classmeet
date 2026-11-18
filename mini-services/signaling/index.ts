/**
 * ClassMeet Signaling Server
 *
 * Lightweight WebRTC signaling relay for mesh video-conferencing.
 * Designed for very low resource usage (1 CPU core / 2GB RAM):
 *  - no media ever passes through this server (pure P2P mesh)
 *  - only SDP offers/answers and ICE candidates are relayed
 *  - in-memory rooms, zero persistence, tiny CPU footprint
 */
import { Server, Socket } from 'socket.io'

const PORT = 3003
const MAX_PARTICIPANTS = 18
const MAX_NAME_LENGTH = 40
const MAX_MESSAGE_LENGTH = 1200
const CHAT_MIN_INTERVAL_MS = 250

interface PeerUser {
  id: string
  name: string
  color: string
  seq: number // join order inside the room (0-based). Lower = joined earlier
  micOn: boolean
  camOn: boolean
  screenSharing: boolean
  handRaised: boolean
  joinedAt: number
}

interface Room {
  id: string
  hostId: string
  createdAt: number
  seqCounter: number
  users: Map<string, PeerUser>
}

const AVATAR_COLORS = [
  '#14b8a6', // teal
  '#22c55e', // green
  '#eab308', // yellow
  '#f97316', // orange
  '#ec4899', // pink
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f43f5e', // rose
  '#2dd4bf', // turquoise
]

const rooms = new Map<string, Room>()
const socketRoom = new Map<string, string>()
const lastChatAt = new Map<string, number>()

function sanitizeRoomId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const clean = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (clean.length < 4 || clean.length > 24) return null
  return clean
}

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const clean = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH)
  if (!clean) return null
  return clean
}

function publicUser(u: PeerUser) {
  return {
    id: u.id,
    name: u.name,
    color: u.color,
    seq: u.seq,
    micOn: u.micOn,
    camOn: u.camOn,
    screenSharing: u.screenSharing,
    handRaised: u.handRaised,
    joinedAt: u.joinedAt,
    isHost: false, // filled below when compared to room.hostId
  }
}

function publicUsers(room: Room) {
  return Array.from(room.users.values()).map((u) => ({
    ...publicUser(u),
    isHost: u.id === room.hostId,
  }))
}

function createRoom(id: string): Room {
  const room: Room = {
    id,
    hostId: '',
    createdAt: Date.now(),
    seqCounter: 0,
    users: new Map(),
  }
  rooms.set(id, room)
  return room
}

function leaveRoom(socket: Socket, notify = true): void {
  const roomId = socketRoom.get(socket.id)
  if (!roomId) return
  const room = rooms.get(roomId)
  socketRoom.delete(socket.id)
  lastChatAt.delete(socket.id)
  if (!room) return

  const user = room.users.get(socket.id)
  room.users.delete(socket.id)

  if (room.users.size === 0) {
    rooms.delete(roomId)
    return
  }

  if (notify && user) {
    socket.to(roomId).emit('peer-left', { id: user.id, name: user.name })
  }

  // Host migration: hand over to the earliest remaining participant
  if (room.hostId === socket.id) {
    const next = Array.from(room.users.values()).sort((a, b) => a.seq - b.seq)[0]
    if (next) {
      room.hostId = next.id
      io.to(roomId).emit('host-changed', { id: next.id, name: next.name })
    }
  }
}

const io = new Server(PORT, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 2e5, // signaling payloads only; keeps memory bounded
})

io.on('connection', (socket) => {
  socket.on('join-room', (payload: unknown, ack?: (res: unknown) => void) => {
    const data = (payload ?? {}) as {
      roomId?: unknown
      name?: unknown
      micOn?: unknown
      camOn?: unknown
    }
    const roomId = sanitizeRoomId(data.roomId)
    const name = sanitizeName(data.name)
    const reply = (res: Record<string, unknown>) => {
      if (typeof ack === 'function') ack(res)
    }

    if (!roomId) return reply({ ok: false, reason: 'invalid-room' })
    if (!name) return reply({ ok: false, reason: 'invalid-name' })

    let room = rooms.get(roomId)
    if (!room) room = createRoom(roomId)

    // Idempotent re-join from the same socket: never duplicate or bump seq
    const existingSelf = room.users.get(socket.id)
    if (existingSelf) {
      return reply({
        ok: true,
        self: { ...publicUser(existingSelf), isHost: room.hostId === socket.id },
        users: publicUsers(room).filter((u) => u.id !== socket.id),
        maxParticipants: MAX_PARTICIPANTS,
      })
    }

    if (room.users.size >= MAX_PARTICIPANTS) {
      return reply({ ok: false, reason: 'room-full' })
    }

    const user: PeerUser = {
      id: socket.id,
      name,
      color: AVATAR_COLORS[room.seqCounter % AVATAR_COLORS.length],
      seq: room.seqCounter++,
      micOn: data.micOn !== false,
      camOn: data.camOn !== false,
      screenSharing: false,
      handRaised: false,
      joinedAt: Date.now(),
    }

    const isHost = room.users.size === 0
    if (isHost) room.hostId = socket.id

    room.users.set(socket.id, user)
    socketRoom.set(socket.id, roomId)
    socket.join(roomId)

    const existing = publicUsers(room).filter((u) => u.id !== socket.id)

    socket.to(roomId).emit('user-joined', {
      user: { ...publicUser(user), isHost: false },
    })

    reply({
      ok: true,
      self: { ...publicUser(user), isHost },
      users: existing,
      maxParticipants: MAX_PARTICIPANTS,
    })
  })

  // Relay SDP / ICE between two peers (mesh P2P)
  socket.on('signal', (payload: unknown) => {
    const data = (payload ?? {}) as { to?: unknown; data?: unknown }
    if (typeof data.to !== 'string' || !data.data) return
    const roomId = socketRoom.get(socket.id)
    if (!roomId) return
    const room = rooms.get(roomId)
    if (!room || !room.users.has(data.to)) return
    io.to(data.to).emit('signal', { from: socket.id, data: data.data })
  })

  socket.on('media-state', (payload: unknown) => {
    const data = (payload ?? {}) as {
      micOn?: unknown
      camOn?: unknown
      screenSharing?: unknown
    }
    const roomId = socketRoom.get(socket.id)
    if (!roomId) return
    const room = rooms.get(roomId)
    const user = room?.users.get(socket.id)
    if (!room || !user) return
    if (typeof data.micOn === 'boolean') user.micOn = data.micOn
    if (typeof data.camOn === 'boolean') user.camOn = data.camOn
    if (typeof data.screenSharing === 'boolean') user.screenSharing = data.screenSharing
    socket.to(roomId).emit('peer-state', {
      id: socket.id,
      micOn: user.micOn,
      camOn: user.camOn,
      screenSharing: user.screenSharing,
    })
  })

  socket.on('chat-message', (payload: unknown) => {
    const data = (payload ?? {}) as { text?: unknown }
    if (typeof data.text !== 'string') return
    const text = data.text.trim().slice(0, MAX_MESSAGE_LENGTH)
    if (!text) return

    const now = Date.now()
    const last = lastChatAt.get(socket.id) ?? 0
    if (now - last < CHAT_MIN_INTERVAL_MS) return
    lastChatAt.set(socket.id, now)

    const roomId = socketRoom.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    const user = room?.users.get(socket.id)
    if (!room || !user) return

    io.to(roomId).emit('chat-message', {
      id: `${socket.id}-${now}`,
      from: socket.id,
      name: user.name,
      color: user.color,
      text,
      ts: now,
    })
  })

  socket.on('raise-hand', (payload: unknown) => {
    const data = (payload ?? {}) as { handRaised?: unknown }
    if (typeof data.handRaised !== 'boolean') return
    const roomId = socketRoom.get(socket.id)
    if (!roomId) return
    const room = rooms.get(roomId)
    const user = room?.users.get(socket.id)
    if (!room || !user) return
    user.handRaised = data.handRaised
    io.to(roomId).emit('peer-hand', { id: socket.id, handRaised: user.handRaised })
  })

  socket.on('reaction', (payload: unknown) => {
    const data = (payload ?? {}) as { icon?: unknown }
    const allowed = ['thumbsUp', 'heart', 'party', 'laugh', 'lightbulb', 'smile']
    if (typeof data.icon !== 'string' || !allowed.includes(data.icon)) return
    const roomId = socketRoom.get(socket.id)
    if (!roomId) return
    const room = rooms.get(roomId)
    const user = room?.users.get(socket.id)
    if (!room || !user) return
    io.to(roomId).emit('peer-reaction', {
      id: socket.id,
      name: user.name,
      icon: data.icon,
      ts: Date.now(),
    })
  })

  socket.on('host-mute-all', (_payload: unknown, ack?: (res: unknown) => void) => {
    const roomId = socketRoom.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    if (!room || room.hostId !== socket.id) {
      if (typeof ack === 'function') ack({ ok: false })
      return
    }
    let count = 0
    for (const [id, u] of room.users) {
      if (id !== socket.id) {
        u.micOn = false
        count++
      }
    }
    socket.to(roomId).emit('force-mute', { by: room.hostId })
    if (typeof ack === 'function') ack({ ok: true, count })
  })

  socket.on('host-remove', (payload: unknown, ack?: (res: unknown) => void) => {
    const data = (payload ?? {}) as { targetId?: unknown }
    if (typeof data.targetId !== 'string') return
    const roomId = socketRoom.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    if (!room || room.hostId !== socket.id || !room.users.has(data.targetId)) {
      if (typeof ack === 'function') ack({ ok: false })
      return
    }
    if (typeof ack === 'function') ack({ ok: true })
    io.to(data.targetId).emit('removed-by-host', { by: room.hostId })
    io.sockets.sockets.get(data.targetId)?.disconnect(true)
  })

  socket.on('leave-room', () => {
    leaveRoom(socket)
  })

  socket.on('disconnecting', () => {
    leaveRoom(socket)
  })

  socket.on('error', (err) => {
    console.error(`socket error ${socket.id}:`, err?.message ?? err)
  })
})

console.log(`ClassMeet signaling server running on port ${PORT} (max ${MAX_PARTICIPANTS} per room)`)

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...')
  io.close()
  process.exit(0)
})
process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...')
  io.close()
  process.exit(0)
})
