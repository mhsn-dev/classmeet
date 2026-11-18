'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MessageAction, Room, UserState } from 'trystero'
import { useToast } from '@/hooks/use-toast'
import {
  colorForId,
  MAX_PARTICIPANTS,
  normalizeRoomCode,
  REACTION_ICONS,
  RTC_CONFIG,
  TURN_SERVERS,
  TRYSTERO_APP_ID,
  type ReactionIcon,
  type SignalingStrategy,
} from '@/lib/meeting'

/* ------------------------------- types ------------------------------- */

export type PeerConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'failed'

export interface Peer {
  id: string
  name: string
  color: string
  seq: number
  micOn: boolean
  camOn: boolean
  screenSharing: boolean
  handRaised: boolean
  isHost: boolean
  connection: PeerConnectionStatus
}

export interface ChatMessage {
  id: string
  from: string
  name: string
  color: string
  text: string
  ts: number
  mine: boolean
  kind: 'chat' | 'system'
}

export interface FloatingReaction {
  key: string
  icon: ReactionIcon
  name: string
}

export type MeetingPhase = 'idle' | 'joining' | 'joined' | 'error'

interface JoinOptions {
  roomId: string
  name: string
  micOn: boolean
  camOn: boolean
  strategy?: SignalingStrategy
}

/** Signed per-user state that syncs automatically to late joiners. */
interface ProfileState {
  name: string
  color: string
  micOn: boolean
  camOn: boolean
  screenSharing: boolean
  handRaised: boolean
  joinedAt: number
}

interface ChatPayload {
  text: string
  ts: number
}

interface SysPayload {
  t: 'kick' | 'mute-all'
  target?: string
}

type StrategyModule = {
  joinRoom: typeof import('trystero')['joinRoom']
  getRelaySockets?: () => Record<string, WebSocket>
}

type JoinResult = { ok: boolean; reason?: string }

const VIDEO_MAX_BITRATE = 260_000 // 260 kbps — friendly for weak links
const SCREEN_MAX_BITRATE = 500_000
const MAX_CHAT_LENGTH = 1200

/* ------------------------------- hook ------------------------------- */

export function useMeeting() {
  const { toast } = useToast()

  const [phase, setPhase] = useState<MeetingPhase>('idle')
  const [roomId, setRoomId] = useState<string>('')
  const [self, setSelf] = useState<Peer | null>(null)
  const [peers, setPeers] = useState<Peer[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [reactions, setReactions] = useState<FloatingReaction[]>([])
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null)

  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [screenSharing, setScreenSharing] = useState(false)
  const [handRaised, setHandRaised] = useState(false)
  const [hasMicDevice, setHasMicDevice] = useState(true)
  const [hasCamDevice, setHasCamDevice] = useState(true)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [kicked, setKicked] = useState(false)
  const [socketConnected, setSocketConnected] = useState(false)
  const [startedAt, setStartedAt] = useState<number>(0)

  const roomRef = useRef<Room | null>(null)
  const moduleRef = useRef<StrategyModule | null>(null)
  const profileRef = useRef<UserState<ProfileState> | null>(null)
  const chatRef = useRef<MessageAction<ChatPayload> | null>(null)
  const rxnRef = useRef<MessageAction<string> | null>(null)
  const sysRef = useRef<MessageAction<SysPayload> | null>(null)
  const unsubsRef = useRef<Array<() => void>>([])
  const resolveJoinRef = useRef<((res: JoinResult) => void) | null>(null)
  const selfInfoRef = useRef<{ peerId: string; userId: string } | null>(null)

  const profilesRef = useRef<Map<string, ProfileState>>(new Map()) // userId → profile
  const userIdByPeerRef = useRef<Map<string, string>>(new Map()) // peerId → userId
  const connRef = useRef<Map<string, PeerConnectionStatus>>(new Map()) // peerId → status
  const camStreamsRef = useRef<Map<string, MediaStream>>(new Map()) // peerId → camera stream
  const screenStreamsRef = useRef<Map<string, MediaStream>>(new Map()) // peerId → screen stream

  const cameraStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const cameraVideoTrackRef = useRef<MediaStreamTrack | null>(null)
  const micTrackRef = useRef<MediaStreamTrack | null>(null)
  const joinOptsRef = useRef<JoinOptions | null>(null)
  const joinedRef = useRef(false)
  const selfJoinedAtRef = useRef<number>(Number.MAX_SAFE_INTEGER)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const analysersRef = useRef<Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode }>>(new Map())
  const speakerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mediaVersionRef = useRef(0)
  const [, forceTick] = useState(0)

  const bumpMedia = useCallback(() => {
    mediaVersionRef.current += 1
    forceTick((t) => t + 1)
  }, [])

  /* ------------------------- active speaker ------------------------- */

  const stopSpeakerDetection = useCallback(() => {
    if (speakerIntervalRef.current) {
      clearInterval(speakerIntervalRef.current)
      speakerIntervalRef.current = null
    }
    for (const { source } of analysersRef.current.values()) {
      try { source.disconnect() } catch { /* noop */ }
    }
    analysersRef.current.clear()
    if (audioCtxRef.current) {
      try { void audioCtxRef.current.close() } catch { /* noop */ }
      audioCtxRef.current = null
    }
    setActiveSpeakerId(null)
  }, [])

  const attachAnalyser = useCallback((id: string, stream: MediaStream) => {
    if (stream.getAudioTracks().length === 0) return
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
      void audioCtxRef.current.resume()
      const source = audioCtxRef.current.createMediaStreamSource(stream)
      const analyser = source.context.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      analysersRef.current.set(id, { analyser, source })
    } catch { /* audio analysis is best-effort */ }
  }, [])

  useEffect(() => {
    speakerIntervalRef.current = setInterval(() => {
      if (analysersRef.current.size === 0) return
      let loudestId: string | null = null
      let loudest = 0
      const buf = new Float32Array(512)
      for (const [id, { analyser }] of analysersRef.current) {
        try {
          analyser.getFloatTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
          const rms = Math.sqrt(sum / buf.length)
          if (rms > 0.025 && rms > loudest) {
            loudest = rms
            loudestId = id
          }
        } catch { /* noop */ }
      }
      setActiveSpeakerId((prev) => (prev === loudestId ? prev : loudestId))
    }, 500)
    return () => {
      if (speakerIntervalRef.current) clearInterval(speakerIntervalRef.current)
    }
  }, [])

  /* --------------------------- media helpers --------------------------- */

  const ensureLocalMedia = useCallback(async (withVideo: boolean): Promise<void> => {
    if (cameraStreamRef.current) return
    setMediaError(null)
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }
    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 15, max: 24 },
      facingMode: 'user',
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: withVideo ? videoConstraints : false,
      })
      cameraStreamRef.current = stream
      cameraVideoTrackRef.current = stream.getVideoTracks()[0] ?? null
      micTrackRef.current = stream.getAudioTracks()[0] ?? null
      setHasMicDevice(!!micTrackRef.current)
      setHasCamDevice(!!cameraVideoTrackRef.current)
      if (!cameraVideoTrackRef.current) setCamOn(false)
      setLocalStream(stream)
      return
    } catch {
      // fall through to audio-only
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      cameraStreamRef.current = stream
      cameraVideoTrackRef.current = null
      micTrackRef.current = stream.getAudioTracks()[0] ?? null
      setHasMicDevice(!!micTrackRef.current)
      setHasCamDevice(false)
      setCamOn(false)
      setMediaError('دسترسی به دوربین ممکن نشد؛ فقط صدا فعال است.')
      setLocalStream(stream)
      return
    } catch {
      // no media at all — view-only mode
    }
    cameraStreamRef.current = new MediaStream()
    cameraVideoTrackRef.current = null
    micTrackRef.current = null
    setHasMicDevice(false)
    setHasCamDevice(false)
    setCamOn(false)
    setMicOn(false)
    setMediaError('دسترسی به میکروفون و دوربین ممکن نشد؛ به حالت تماشا وارد می‌شوید.')
    setLocalStream(new MediaStream())
  }, [])

  const stopPreview = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop())
    cameraStreamRef.current = null
    cameraVideoTrackRef.current = null
    micTrackRef.current = null
    setLocalStream(null)
  }, [])

  /* ------------------------------ helpers ------------------------------ */

  const pushSystemMessage = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev.slice(-200),
      { id: `sys-${Date.now()}-${Math.random()}`, from: 'system', name: 'سیستم', color: '#94a3b8', text, ts: Date.now(), mine: false, kind: 'system' },
    ])
  }, [])

  const getPeerStream = useCallback((id: string): MediaStream | null => {
    return screenStreamsRef.current.get(id) ?? camStreamsRef.current.get(id) ?? null
  }, [])

  const isHostUser = useCallback((userId: string): boolean => {
    // The host is the participant with the earliest join time (ties broken by userId).
    let earliestUserId = selfInfoRef.current?.userId
    let earliestTs = selfJoinedAtRef.current
    for (const [uid, prof] of profilesRef.current) {
      if (prof.joinedAt < earliestTs || (prof.joinedAt === earliestTs && uid < (earliestUserId ?? ''))) {
        earliestTs = prof.joinedAt
        earliestUserId = uid
      }
    }
    return !!earliestUserId && earliestUserId === userId
  }, [])

  const rebuildPeers = useCallback(() => {
    const selfUserId = selfInfoRef.current?.userId
    const selfPeerId = selfInfoRef.current?.peerId

    const ordered: Array<{ peerId: string; userId: string }> = []
    for (const [peerId, userId] of userIdByPeerRef.current) {
      if (peerId !== selfPeerId) ordered.push({ peerId, userId })
    }
    if (selfPeerId && selfUserId) ordered.push({ peerId: selfPeerId, userId: selfUserId })
    ordered.sort((a, b) => {
      const ta = a.userId === selfUserId ? selfJoinedAtRef.current : profilesRef.current.get(a.userId)?.joinedAt ?? Number.MAX_SAFE_INTEGER
      const tb = b.userId === selfUserId ? selfJoinedAtRef.current : profilesRef.current.get(b.userId)?.joinedAt ?? Number.MAX_SAFE_INTEGER
      return ta - tb || a.peerId.localeCompare(b.peerId)
    })

    const nextPeers: Peer[] = []
    let selfSeq = 0
    ordered.forEach((entry, index) => {
      const prof = profilesRef.current.get(entry.userId)
      const isSelf = entry.peerId === selfPeerId
      const peer: Peer = {
        id: entry.peerId,
        name: prof?.name ?? 'مهمان',
        color: prof?.color ?? colorForId(entry.peerId),
        seq: index,
        micOn: prof?.micOn ?? true,
        camOn: prof?.camOn ?? true,
        screenSharing: prof?.screenSharing ?? false,
        handRaised: prof?.handRaised ?? false,
        isHost: index === 0,
        connection: isSelf ? 'connected' : connRef.current.get(entry.peerId) ?? 'connecting',
      }
      if (isSelf) {
        selfSeq = index
        setSelf((prev) => (prev ? { ...prev, seq: index, isHost: index === 0 } : prev))
      } else {
        nextPeers.push(peer)
      }
    })
    if (!selfPeerId) setSelf((prev) => (prev ? { ...prev, isHost: false } : prev))
    setPeers((prev) => {
      const same =
        prev.length === nextPeers.length &&
        prev.every((p, i) => {
          const q = nextPeers[i]
          return p.id === q.id && p.name === q.name && p.color === q.color && p.seq === q.seq &&
            p.micOn === q.micOn && p.camOn === q.camOn && p.screenSharing === q.screenSharing &&
            p.handRaised === q.handRaised && p.isHost === q.isHost && p.connection === q.connection
        })
      return same ? prev : nextPeers
    })
    return selfSeq
  }, [])

  /* --------------------------- peer lifecycle --------------------------- */

  const destroyPeer = useCallback((peerId: string, userId?: string) => {
    connRef.current.delete(peerId)
    userIdByPeerRef.current.delete(peerId)
    camStreamsRef.current.delete(peerId)
    screenStreamsRef.current.delete(peerId)
    if (userId) profilesRef.current.delete(userId)
    const a = analysersRef.current.get(peerId)
    if (a) {
      try { a.source.disconnect() } catch { /* noop */ }
      analysersRef.current.delete(peerId)
    }
    rebuildPeers()
    bumpMedia()
  }, [bumpMedia, rebuildPeers])

  const teardownRef = useRef<((silent: boolean) => void) | null>(null)

  /** Cap outgoing video bitrate so mesh calls stay usable on weak links. */
  const applySenderCaps = useCallback(() => {
    const room = roomRef.current
    if (!room) return
    try {
      const peers = room.getPeers()
      for (const info of Object.values(peers)) {
        const pc = info.connection
        if (!pc) continue
        for (const sender of pc.getSenders()) {
          const track = sender.track
          if (!track || track.kind !== 'video') continue
          const isScreen = track.contentHint === 'detail'
          const params = sender.getParameters()
          if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
          params.encodings[0].maxBitrate = isScreen ? SCREEN_MAX_BITRATE : VIDEO_MAX_BITRATE
          params.encodings[0].maxFramerate = isScreen ? 10 : 15
          try { params.degradationPreference = isScreen ? 'maintain-resolution' : 'balanced' } catch { /* optional */ }
          void sender.setParameters(params).catch(() => { /* optional */ })
        }
      }
    } catch { /* best effort */ }
  }, [])

  const wireRoom = useCallback((room: Room) => {
    const unsubs = unsubsRef.current

    unsubs.push(room.onUserJoin(({ peerId, userId }) => {
      userIdByPeerRef.current.set(peerId, userId)
      connRef.current.set(peerId, 'connecting')
      // Send our camera stream to the newcomer (targeted, per Trystero docs).
      const cam = cameraStreamRef.current
      if (cam && cam.getTracks().length > 0) {
        void room.addStream(cam, { target: userId, metadata: { kind: 'camera' } })
      }
      applySenderCaps()
      rebuildPeers()
    }))

    unsubs.push(room.onUserLeave(({ peerId, userId }) => {
      const name = profilesRef.current.get(userId)?.name
      destroyPeer(peerId, userId)
      pushSystemMessage(`${name ?? 'شرکت‌کننده'} جلسه را ترک کرد`)
      toast({ title: `${name ?? 'شرکت‌کننده'} جلسه را ترک کرد` })
    }))

    unsubs.push(room.onPeerJoin(({ peerId }) => {
      connRef.current.set(peerId, 'connected')
      applySenderCaps()
      rebuildPeers()
      bumpMedia()
    }))

    unsubs.push(room.onPeerStream((stream, { peerId, userId, metadata }) => {
      userIdByPeerRef.current.set(peerId, userId)
      const kind = (metadata as { kind?: string } | undefined)?.kind
      if (kind === 'screen') {
        screenStreamsRef.current.set(peerId, stream)
      } else {
        camStreamsRef.current.set(peerId, stream)
      }
      attachAnalyser(peerId, stream)
      rebuildPeers()
      bumpMedia()
    }, { replay: true }))

    unsubs.push(room.onError((err) => {
      if (err.code === 'room-full') {
        resolveJoinRef.current?.({ ok: false, reason: 'room-full' })
        teardownRef.current?.(true)
        setPhase('error')
        return
      }
      if (err.code === 'relay-failed') {
        setSocketConnected(false)
        return
      }
      if (err.code === 'peer-connect-failed' || err.code === 'peer-error' || err.code === 'handshake-failed') {
        if (err.peerId) {
          connRef.current.set(err.peerId, 'failed')
          rebuildPeers()
          bumpMedia()
        }
      }
    }))
  }, [applySenderCaps, attachAnalyser, bumpMedia, destroyPeer, pushSystemMessage, rebuildPeers, toast])

  /* ------------------------------ teardown ------------------------------ */

  const teardown = useCallback((silent: boolean) => {
    joinedRef.current = false
    joinOptsRef.current = null
    for (const unsub of unsubsRef.current) {
      try { unsub() } catch { /* noop */ }
    }
    unsubsRef.current = []
    try {
      void roomRef.current?.leave().catch(() => { /* noop */ })
    } catch { /* noop */ }
    roomRef.current = null
    moduleRef.current = null
    profileRef.current = null
    chatRef.current = null
    rxnRef.current = null
    sysRef.current = null
    selfInfoRef.current = null
    selfJoinedAtRef.current = Number.MAX_SAFE_INTEGER
    profilesRef.current.clear()
    userIdByPeerRef.current.clear()
    connRef.current.clear()
    camStreamsRef.current.clear()
    screenStreamsRef.current.clear()
    screenStreamRef.current?.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    if (!silent) {
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop())
      cameraStreamRef.current = null
      cameraVideoTrackRef.current = null
      micTrackRef.current = null
    }
    stopSpeakerDetection()
    setPeers([])
    setMessages([])
    setReactions([])
    setSelf(null)
    setScreenSharing(false)
    setHandRaised(false)
    setActiveSpeakerId(null)
    setSocketConnected(false)
    setStartedAt(0)
    if (!silent) setLocalStream(null)
  }, [stopSpeakerDetection])

  useEffect(() => {
    teardownRef.current = teardown
  }, [teardown])

  /* ------------------------------- join ------------------------------- */

  const joinRoom = useCallback(async (opts: JoinOptions): Promise<JoinResult> => {
    if (joinedRef.current) return { ok: true }
    // Normalize once here so every entry point (create, join, deep link)
    // maps to the exact same Trystero room topic.
    opts = { ...opts, roomId: normalizeRoomCode(opts.roomId) }
    setPhase('joining')
    setKicked(false)
    joinOptsRef.current = opts
    setMicOn(opts.micOn)
    setCamOn(opts.camOn)

    await ensureLocalMedia(opts.camOn)
    const stream = cameraStreamRef.current
    if (micTrackRef.current) micTrackRef.current.enabled = opts.micOn
    if (cameraVideoTrackRef.current) cameraVideoTrackRef.current.enabled = opts.camOn

    return await new Promise<JoinResult>((resolve) => {
      let settled = false
      const finish = (res: JoinResult) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolveJoinRef.current = null
        resolve(res)
      }
      const timeout = setTimeout(() => {
        teardown(false)
        setPhase('error')
        finish({ ok: false, reason: 'timeout' })
      }, 20000)
      resolveJoinRef.current = finish

      void (async () => {
        try {
          const strategy: SignalingStrategy = opts.strategy ?? 'nostr'
          const mod: StrategyModule = strategy === 'mqtt'
            ? await import('@trystero-p2p/mqtt')
            : await import('trystero')
          if (settled) return
          moduleRef.current = mod

          const room = mod.joinRoom(
            {
              appId: TRYSTERO_APP_ID,
              maxUsers: MAX_PARTICIPANTS,
              identity: 'none', // fresh throwaway identity per tab
              rtcConfig: RTC_CONFIG,
              turnConfig: TURN_SERVERS,
            },
            opts.roomId,
          )
          roomRef.current = room
          wireRoom(room)

          const selfInfo = await room.getSelf()
          if (settled) return
          selfInfoRef.current = { peerId: selfInfo.peerId, userId: selfInfo.userId }

          await room.ready
          if (settled) return
          setSocketConnected(true)

          const joinedAt = Date.now()
          selfJoinedAtRef.current = joinedAt
          const myColor = colorForId(selfInfo.peerId)

          const profile = room.makeUserState<ProfileState>('profile', {
            name: opts.name,
            color: myColor,
            micOn: opts.micOn && !!micTrackRef.current,
            camOn: opts.camOn && !!cameraVideoTrackRef.current,
            screenSharing: false,
            handRaised: false,
            joinedAt,
          })
          profileRef.current = profile

          unsubsRef.current.push(profile.onChange((value, ctx) => {
            if (ctx.self) return
            if (value === undefined || ctx.removed) {
              rebuildPeers()
              return
            }
            profilesRef.current.set(ctx.userId, value)
            if (ctx.peerId) userIdByPeerRef.current.set(ctx.peerId, ctx.userId)
            // If a peer stopped sharing their screen, drop the stale stream.
            if (!value.screenSharing) {
              for (const [pid, uid] of userIdByPeerRef.current) {
                if (uid === ctx.userId && screenStreamsRef.current.has(pid)) {
                  screenStreamsRef.current.delete(pid)
                  bumpMedia()
                }
              }
            }
            rebuildPeers()
          }, { replay: true }))

          const chat = room.makeAction<ChatPayload>('chat')
          const rxn = room.makeAction<string>('rxn')
          const sys = room.makeAction<SysPayload>('sys')
          chatRef.current = chat
          rxnRef.current = rxn
          sysRef.current = sys

          unsubsRef.current.push(chat.onMessage((data, ctx) => {
            const prof = profilesRef.current.get(ctx.userId)
            setMessages((prev) => [
              ...prev.slice(-200),
              {
                id: `${ctx.peerId}-${data.ts}-${Math.random()}`,
                from: ctx.peerId,
                name: prof?.name ?? 'مهمان',
                color: prof?.color ?? colorForId(ctx.peerId),
                text: data.text,
                ts: data.ts,
                mine: false,
                kind: 'chat',
              },
            ])
          }))

          unsubsRef.current.push(rxn.onMessage((icon, ctx) => {
            if (!REACTION_ICONS.includes(icon as ReactionIcon)) return
            const key = `${ctx.peerId}-${Date.now()}-${Math.random()}`
            setReactions((prev) => [
              ...prev,
              { key, icon: icon as ReactionIcon, name: profilesRef.current.get(ctx.userId)?.name ?? 'مهمان' },
            ])
            setTimeout(() => setReactions((prev) => prev.filter((r) => r.key !== key)), 4200)
          }))

          unsubsRef.current.push(sys.onMessage((payload, ctx) => {
            if (!isHostUser(ctx.userId)) return
            if (payload.t === 'kick' && payload.target === selfInfoRef.current?.userId) {
              setKicked(true)
              teardown(true)
              toast({ title: 'شما از جلسه اخراج شدید' })
              return
            }
            if (payload.t === 'mute-all') {
              const track = micTrackRef.current
              if (track) track.enabled = false
              setMicOn(false)
              void profileRef.current?.set((prev) => (prev ? { ...prev, micOn: false } : prev))
              toast({ title: 'میزبان صدای همه را قطع کرد', description: 'برای صحبت، میکروفون را دوباره فعال کنید.' })
            }
          }))

          // Publish presence + media.
          void profile.set((prev) => prev ?? {
            name: opts.name,
            color: myColor,
            micOn: opts.micOn && !!micTrackRef.current,
            camOn: opts.camOn && !!cameraVideoTrackRef.current,
            screenSharing: false,
            handRaised: false,
            joinedAt,
          })

          if (stream && stream.getTracks().length > 0) {
            await room.addStream(stream, { metadata: { kind: 'camera' } })
          }

          setSelf({
            id: selfInfo.peerId,
            name: opts.name,
            color: myColor,
            seq: 0,
            micOn: opts.micOn && !!micTrackRef.current,
            camOn: opts.camOn && !!cameraVideoTrackRef.current,
            screenSharing: false,
            handRaised: false,
            isHost: false,
            connection: 'connected',
          })
          if (stream && stream.getAudioTracks().length > 0) {
            attachAnalyser(selfInfo.peerId, stream)
          }
          setRoomId(opts.roomId)
          setStartedAt(Date.now())
          rebuildPeers()
          pushSystemMessage('شما به جلسه پیوستید')
          setPhase('joined')
          finish({ ok: true })
        } catch {
          if (!settled) {
            teardown(false)
            setPhase('error')
            finish({ ok: false, reason: 'timeout' })
          }
        }
      })()
    })
  }, [attachAnalyser, ensureLocalMedia, isHostUser, pushSystemMessage, rebuildPeers, teardown, toast, wireRoom])

  /* ------------------------------- leave ------------------------------- */

  const leaveRoom = useCallback(() => {
    teardown(false)
    setPhase('idle')
    setMediaError(null)
  }, [teardown])

  /* --------------------------- local controls --------------------------- */

  const toggleMic = useCallback(() => {
    const track = micTrackRef.current
    if (!track) {
      toast({ title: 'میکروفون در دسترس نیست', description: 'دسترسی میکروفون در مرورگر داده نشده است.' })
      return
    }
    const next = !track.enabled
    track.enabled = next
    setMicOn(next)
    void profileRef.current?.set((prev) => (prev ? { ...prev, micOn: next } : prev))
  }, [toast])

  const toggleCam = useCallback(() => {
    const track = cameraVideoTrackRef.current
    if (!track) {
      toast({ title: 'دوربین در دسترس نیست', description: 'دسترسی دوربین در مرورگر داده نشده است.' })
      return
    }
    const next = !track.enabled
    track.enabled = next
    setCamOn(next)
    void profileRef.current?.set((prev) => (prev ? { ...prev, camOn: next } : prev))
  }, [toast])

  const stopScreenShare = useCallback(() => {
    const room = roomRef.current
    const ss = screenStreamRef.current
    if (room && ss) room.removeStream(ss)
    ss?.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    setLocalStream(cameraStreamRef.current)
    setScreenSharing(false)
    void profileRef.current?.set((prev) => (prev ? { ...prev, screenSharing: false } : prev))
  }, [])

  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      stopScreenShare()
      return
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 10, max: 15 } },
        audio: false,
      })
      const screenTrack = display.getVideoTracks()[0]
      if (!screenTrack) return
      try { screenTrack.contentHint = 'detail' } catch { /* optional */ }
      screenStreamRef.current = display
      screenTrack.addEventListener('ended', () => stopScreenShare())
      const room = roomRef.current
      if (room) await room.addStream(display, { metadata: { kind: 'screen' } })
      setLocalStream(display)
      setScreenSharing(true)
      void profileRef.current?.set((prev) => (prev ? { ...prev, screenSharing: true } : prev))
    } catch {
      toast({ title: 'اشتراک صفحه لغو شد' })
    }
  }, [screenSharing, stopScreenShare, toast])

  const toggleHand = useCallback(() => {
    const next = !handRaised
    setHandRaised(next)
    void profileRef.current?.set((prev) => (prev ? { ...prev, handRaised: next } : prev))
    toast({ title: next ? 'دست شما بالا رفت' : 'دست شما پایین آمد' })
  }, [handRaised, toast])

  const sendReaction = useCallback((icon: ReactionIcon) => {
    const key = `self-${Date.now()}-${Math.random()}`
    const name = self?.name ?? 'شما'
    setReactions((prev) => [...prev, { key, icon, name }])
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.key !== key)), 4200)
    void rxnRef.current?.send(icon)
  }, [self?.name])

  const sendChat = useCallback((text: string) => {
    const clean = text.trim().slice(0, MAX_CHAT_LENGTH)
    if (!clean) return
    const ts = Date.now()
    void chatRef.current?.send({ text: clean, ts })
    setMessages((prev) => [
      ...prev.slice(-200),
      {
        id: `self-${ts}-${Math.random()}`,
        from: selfInfoRef.current?.peerId ?? 'self',
        name: self?.name ?? 'شما',
        color: self?.color ?? '#2dd4bf',
        text: clean,
        ts,
        mine: true,
        kind: 'chat',
      },
    ])
  }, [self?.color, self?.name])

  /* ----------------------------- host actions ----------------------------- */

  const muteAll = useCallback(() => {
    void sysRef.current?.send({ t: 'mute-all' })
    toast({ title: 'درخواست قطع صدا ارسال شد', description: 'میکروفون همه شرکت‌کننده‌ها قطع می‌شود.' })
  }, [toast])

  const removePeer = useCallback((id: string) => {
    const userId = userIdByPeerRef.current.get(id)
    if (!userId || !isHostUser(selfInfoRef.current?.userId ?? '')) {
      toast({ title: 'فقط میزبان می‌تواند این کار را انجام دهد' })
      return
    }
    void sysRef.current?.send({ t: 'kick', target: userId }, { target: userId })
    toast({ title: 'شرکت‌کننده اخراج شد' })
  }, [isHostUser, toast])

  /* ------------------------------ cleanup ------------------------------ */

  useEffect(() => {
    return () => {
      teardown(true)
    }
  }, [])

  // Graceful leave when the tab closes or the page is hidden.
  useEffect(() => {
    const onLeave = () => {
      try { void roomRef.current?.leave() } catch { /* noop */ }
    }
    window.addEventListener('pagehide', onLeave)
    return () => window.removeEventListener('pagehide', onLeave)
  }, [])

  // Poll relay sockets to reflect signaling connectivity in the UI.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!joinedRef.current) return
      const sockets = moduleRef.current?.getRelaySockets?.() ?? {}
      const values = Object.values(sockets)
      if (values.length === 0) return
      const anyOpen = values.some((s) => s.readyState === 1)
      setSocketConnected((prev) => (prev === anyOpen ? prev : anyOpen))
    }, 4000)
    return () => clearInterval(timer)
  }, [])

  return {
    // state
    phase,
    roomId,
    self,
    peers,
    messages,
    reactions,
    activeSpeakerId,
    localStream,
    micOn,
    camOn,
    screenSharing,
    handRaised,
    hasMicDevice,
    hasCamDevice,
    mediaError,
    kicked,
    socketConnected,
    startedAt,
    mediaVersion: mediaVersionRef.current,
    getPeerStream,
    // actions
    ensureLocalMedia,
    stopPreview,
    joinRoom,
    leaveRoom,
    toggleMic,
    toggleCam,
    toggleScreenShare,
    toggleHand,
    sendReaction,
    sendChat,
    muteAll,
    removePeer,
  }
}

export type MeetingController = ReturnType<typeof useMeeting>
