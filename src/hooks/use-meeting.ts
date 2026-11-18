'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { useToast } from '@/hooks/use-toast'
import {
  getSignalingUrl,
  getSocketPath,
  RTC_CONFIG,
  type ReactionIcon,
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
}

interface PeerCtx {
  pc: RTCPeerConnection
  makingOffer: boolean
  ignoreOffer: boolean
  hasRemoteDesc: boolean
  queuedCandidates: RTCIceCandidateInit[]
  videoSender: RTCRtpSender
  restarted: boolean
}

interface SignalPayload {
  from: string
  data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
}

const VIDEO_ENCODER_MAX_BITRATE = 260_000 // 260 kbps @ 360p15 — friendly for weak links
const SCREEN_ENCODER_MAX_BITRATE = 500_000

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

  const socketRef = useRef<Socket | null>(null)
  const peersRef = useRef<Map<string, PeerCtx>>(new Map())
  const streamsRef = useRef<Map<string, MediaStream>>(new Map())
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const cameraVideoTrackRef = useRef<MediaStreamTrack | null>(null)
  const micTrackRef = useRef<MediaStreamTrack | null>(null)
  const joinOptsRef = useRef<JoinOptions | null>(null)
  const selfSeqRef = useRef<number>(0)
  const selfIdRef = useRef<string>('')
  const joinedRef = useRef(false)
  const rejoinNeededRef = useRef(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analysersRef = useRef<Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode }>>(new Map())
  const speakerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const peerSeqCache = useRef<Map<string, number>>(new Map())
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

  /* --------------------------- peer connections --------------------------- */

  const applySenderCaps = useCallback((sender: RTCRtpSender, isScreen: boolean) => {
    try {
      const params = sender.getParameters()
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}]
      }
      params.encodings[0].maxBitrate = isScreen ? SCREEN_ENCODER_MAX_BITRATE : VIDEO_ENCODER_MAX_BITRATE
      params.encodings[0].maxFramerate = isScreen ? 10 : 15
      try { params.degradationPreference = isScreen ? 'maintain-resolution' : 'balanced' } catch { /* optional */ }
      void sender.setParameters(params).catch(() => { /* optional */ })
    } catch { /* optional */ }
  }, [])

  const replaceVideoTrackOnAll = useCallback((track: MediaStreamTrack | null, isScreen: boolean) => {
    if (track) {
      try { track.contentHint = isScreen ? 'detail' : 'motion' } catch { /* noop */ }
    }
    for (const ctx of peersRef.current.values()) {
      try {
        void ctx.videoSender.replaceTrack(track)
        applySenderCaps(ctx.videoSender, isScreen)
      } catch { /* peer may be closing */ }
    }
  }, [applySenderCaps])

  const handleRemoteTrack = useCallback((peerId: string, track: MediaStreamTrack) => {
    let stream = streamsRef.current.get(peerId)
    if (!stream) {
      stream = new MediaStream()
      streamsRef.current.set(peerId, stream)
    }
    const same = stream.getTracks().find((t) => t.kind === track.kind)
    if (same && same.id !== track.id) stream.removeTrack(same)
    if (!stream.getTracks().some((t) => t.id === track.id)) {
      stream.addTrack(track)
    }
    attachAnalyser(peerId, stream)
    bumpMedia()
  }, [attachAnalyser, bumpMedia])

  const emitSignal = useCallback((to: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
    socketRef.current?.emit('signal', { to, data })
  }, [])

  const getPeerStream = useCallback((id: string): MediaStream | null => {
    return streamsRef.current.get(id) ?? null
  }, [])

  const createPeer = useCallback((peerId: string, initiator: boolean): PeerCtx => {
    const existing = peersRef.current.get(peerId)
    if (existing) return existing

    const pc = new RTCPeerConnection(RTC_CONFIG)
    const ctx: PeerCtx = {
      pc,
      makingOffer: false,
      ignoreOffer: false,
      hasRemoteDesc: false,
      queuedCandidates: [],
      videoSender: null as unknown as RTCRtpSender,
      restarted: false,
    }

    // Fixed, symmetric m-lines: audio + video sendrecv.
    // This lets replaceTrack() swap camera/screen later with NO renegotiation.
    const audioTr = pc.addTransceiver('audio', { direction: 'sendrecv' })
    const videoTr = pc.addTransceiver('video', { direction: 'sendrecv' })
    ctx.videoSender = videoTr.sender

    const sharingNow = !!screenStreamRef.current
    const audioTrack = micTrackRef.current
    const videoTrack = sharingNow
      ? screenStreamRef.current?.getVideoTracks()[0] ?? null
      : cameraVideoTrackRef.current
    if (audioTrack) void audioTr.sender.replaceTrack(audioTrack)
    if (videoTrack) {
      void videoTr.sender.replaceTrack(videoTrack)
      applySenderCaps(videoTr.sender, sharingNow)
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) emitSignal(peerId, { candidate: candidate.toJSON() })
    }

    pc.onnegotiationneeded = async () => {
      try {
        if (!initiator) return // only the newer participant offers
        ctx.makingOffer = true
        await pc.setLocalDescription()
        if (pc.localDescription) emitSignal(peerId, { description: pc.localDescription })
      } catch { /* noop */ } finally {
        ctx.makingOffer = false
      }
    }

    pc.ontrack = (ev) => handleRemoteTrack(peerId, ev.track)

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      setPeers((prev) => prev.map((p) => {
        if (p.id !== peerId) return p
        if (state === 'connected') return { ...p, connection: 'connected' }
        if (state === 'disconnected') return { ...p, connection: 'reconnecting' }
        if (state === 'failed') return { ...p, connection: 'failed' }
        return p
      }))
      if (state === 'failed' && !ctx.restarted) {
        ctx.restarted = true
        try { pc.restartIce() } catch { /* noop */ }
      }
    }

    peersRef.current.set(peerId, ctx)
    return ctx
  }, [applySenderCaps, emitSignal, handleRemoteTrack])

  const destroyPeer = useCallback((peerId: string) => {
    const ctx = peersRef.current.get(peerId)
    if (ctx) {
      try { ctx.pc.close() } catch { /* noop */ }
      peersRef.current.delete(peerId)
    }
    streamsRef.current.delete(peerId)
    const a = analysersRef.current.get(peerId)
    if (a) {
      try { a.source.disconnect() } catch { /* noop */ }
      analysersRef.current.delete(peerId)
    }
    setPeers((prev) => prev.filter((p) => p.id !== peerId))
    bumpMedia()
  }, [bumpMedia])

  const handleSignal = useCallback(async (payload: SignalPayload) => {
    const { from, data } = payload
    if (!from || !data) return

    if (data.description) {
      const desc = data.description
      // Create the passive side on demand if the offer arrives before user-joined handling
      const ctx = peersRef.current.get(from) ?? createPeer(from, false)
      const pc = ctx.pc
      const isInitiator = selfSeqRef.current > (peerSeqCache.current.get(from) ?? 0)
      const polite = !isInitiator
      const readyForOffer = !ctx.makingOffer && pc.signalingState === 'stable'
      const collision = desc.type === 'offer' && !readyForOffer
      ctx.ignoreOffer = !polite && collision
      if (ctx.ignoreOffer) return

      try {
        await pc.setRemoteDescription(desc)
        ctx.hasRemoteDesc = true
        for (const c of ctx.queuedCandidates) {
          try { await pc.addIceCandidate(c) } catch { /* noop */ }
        }
        ctx.queuedCandidates = []
        if (desc.type === 'offer') {
          await pc.setLocalDescription()
          if (pc.localDescription) emitSignal(from, { description: pc.localDescription })
        }
      } catch { /* ignore malformed signals */ }
      return
    }

    if (data.candidate) {
      const ctx = peersRef.current.get(from)
      if (!ctx) return
      try {
        if (ctx.hasRemoteDesc && ctx.pc.remoteDescription) {
          await ctx.pc.addIceCandidate(data.candidate)
        } else {
          ctx.queuedCandidates.push(data.candidate)
        }
      } catch (err) {
        if (!ctx.ignoreOffer) console.debug('ice candidate error', err)
      }
    }
  }, [createPeer, emitSignal])

  /* ------------------------------ teardown ------------------------------ */

  const teardown = useCallback((silent: boolean) => {
    joinedRef.current = false
    rejoinNeededRef.current = false
    joinOptsRef.current = null
    try { socketRef.current?.emit('leave-room') } catch { /* noop */ }
    socketRef.current?.disconnect()
    socketRef.current = null
    for (const id of Array.from(peersRef.current.keys())) {
      const ctx = peersRef.current.get(id)
      try { ctx?.pc.close() } catch { /* noop */ }
      peersRef.current.delete(id)
    }
    streamsRef.current.clear()
    peerSeqCache.current.clear()
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

  /* --------------------------- socket wiring --------------------------- */

  const pushSystemMessage = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev.slice(-200),
      { id: `sys-${Date.now()}-${Math.random()}`, from: 'system', name: 'سیستم', color: '#94a3b8', text, ts: Date.now(), mine: false, kind: 'system' },
    ])
  }, [])

  const adoptExistingUser = useCallback((u: Peer) => {
    peerSeqCache.current.set(u.id, u.seq)
    setPeers((prev) => (prev.some((p) => p.id === u.id) ? prev : [...prev, { ...u, connection: 'connecting' }]))
    // The newest participant (highest seq) initiates the offer
    if (selfSeqRef.current > u.seq) createPeer(u.id, true)
  }, [createPeer])

  const wireSocket = useCallback((socket: Socket) => {
    socket.on('connect', () => {
      setSocketConnected(true)
      // Auto re-join ONLY after a genuine disconnect (never on the initial connect)
      if (rejoinNeededRef.current && joinOptsRef.current && socket.id !== selfIdRef.current) {
        rejoinNeededRef.current = false
        const opts = joinOptsRef.current
        for (const id of Array.from(peersRef.current.keys())) destroyPeer(id)
        socket.emit('join-room', {
          roomId: opts.roomId,
          name: opts.name,
          micOn: micTrackRef.current?.enabled ?? opts.micOn,
          camOn: cameraVideoTrackRef.current?.enabled ?? opts.camOn,
        }, (res: unknown) => {
          const ack = res as { ok: boolean; reason?: string; self?: Peer; users?: Peer[] }
          if (!ack.ok) return
          const sid = socket.id ?? ''
          if (!sid) return
          selfIdRef.current = sid
          selfSeqRef.current = ack.self?.seq ?? 0
          peerSeqCache.current.set(sid, selfSeqRef.current)
          setSelf({ ...(ack.self ?? { id: sid, name: opts.name, color: '#2dd4bf', seq: 0, micOn: true, camOn: true, screenSharing: false, handRaised: false, isHost: false }), id: sid, connection: 'connected' })
          joinedRef.current = true
          for (const u of ack.users ?? []) adoptExistingUser(u)
        })
      }
    })

    socket.on('disconnect', () => {
      setSocketConnected(false)
      if (joinedRef.current) {
        joinedRef.current = false
        rejoinNeededRef.current = true
        pushSystemMessage('اتصال دچار اختلال شد؛ در حال تلاش مجدد…')
        // Peer connections are tied to the old socket id — tear them down.
        for (const id of Array.from(peersRef.current.keys())) destroyPeer(id)
      }
    })

    socket.on('signal', (payload: SignalPayload) => {
      void handleSignal(payload)
    })

    socket.on('user-joined', ({ user }: { user: Peer }) => {
      pushSystemMessage(`${user.name} به جلسه پیوست`)
      toast({ title: `${user.name} به جلسه پیوست` })
      adoptExistingUser(user)
    })

    socket.on('peer-left', ({ id, name }: { id: string; name: string }) => {
      destroyPeer(id)
      pushSystemMessage(`${name} جلسه را ترک کرد`)
      toast({ title: `${name} جلسه را ترک کرد` })
    })

    socket.on('peer-state', ({ id, micOn: m, camOn: c, screenSharing: s }: { id: string; micOn: boolean; camOn: boolean; screenSharing: boolean }) => {
      setPeers((prev) => prev.map((p) => (p.id === id ? { ...p, micOn: m, camOn: c, screenSharing: s } : p)))
    })

    socket.on('peer-hand', ({ id, handRaised: h }: { id: string; handRaised: boolean }) => {
      setPeers((prev) => prev.map((p) => (p.id === id ? { ...p, handRaised: h } : p)))
      if (h) toast({ title: 'دستی بالا رفت', description: 'در پنل شرکت‌کننده‌ها ببینید.' })
    })

    socket.on('chat-message', (msg: Omit<ChatMessage, 'mine' | 'kind'>) => {
      setMessages((prev) => [...prev.slice(-200), { ...msg, mine: msg.from === selfIdRef.current, kind: 'chat' }])
    })

    socket.on('peer-reaction', ({ id, name, icon }: { id: string; name: string; icon: ReactionIcon }) => {
      const key = `${id}-${Date.now()}-${Math.random()}`
      setReactions((prev) => [...prev, { key, icon, name }])
      setTimeout(() => setReactions((prev) => prev.filter((r) => r.key !== key)), 4200)
    })

    socket.on('host-changed', ({ id, name }: { id: string; name: string }) => {
      setPeers((prev) => prev.map((p) => (p.id === id ? { ...p, isHost: true } : { ...p, isHost: false })))
      setSelf((s) => (s && s.id === id ? { ...s, isHost: true } : s ? { ...s, isHost: false } : s))
      toast({ title: `${name} میزبان جلسه شد` })
    })

    socket.on('force-mute', () => {
      const track = micTrackRef.current
      if (track) track.enabled = false
      setMicOn(false)
      toast({ title: 'میزبان صدای همه را قطع کرد', description: 'برای صحبت، میکروفون را دوباره فعال کنید.' })
    })

    socket.on('removed-by-host', () => {
      setKicked(true)
      teardown(true)
      toast({ title: 'شما از جلسه اخراج شدید' })
    })
  }, [adoptExistingUser, destroyPeer, handleSignal, pushSystemMessage, teardown, toast])

  /* ------------------------------- join ------------------------------- */

  const joinRoom = useCallback(async (opts: JoinOptions): Promise<{ ok: boolean; reason?: string }> => {
    setPhase('joining')
    setKicked(false)
    joinOptsRef.current = opts
    setMicOn(opts.micOn)
    setCamOn(opts.camOn)

    await ensureLocalMedia(opts.camOn)
    const stream = cameraStreamRef.current
    const micOk = !!micTrackRef.current
    const camOk = !!cameraVideoTrackRef.current
    if (micTrackRef.current) micTrackRef.current.enabled = opts.micOn
    if (cameraVideoTrackRef.current) cameraVideoTrackRef.current.enabled = opts.camOn

    if (!socketRef.current) {
      socketRef.current = io(getSignalingUrl(), {
        path: getSocketPath(),
        transports: ['websocket', 'polling'],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1200,
        reconnectionDelayMax: 6000,
        timeout: 12000,
      })
      wireSocket(socketRef.current)
    }
    const socket = socketRef.current
    if (!socket.connected) socket.connect()

    return await new Promise<{ ok: boolean; reason?: string }>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ ok: false, reason: 'timeout' })
      }, 15000)
      socket.emit('join-room', {
        roomId: opts.roomId,
        name: opts.name,
        micOn: opts.micOn && micOk,
        camOn: opts.camOn && camOk,
      }, (res: unknown) => {
        const ack = res as { ok: boolean; reason?: string; self?: Peer; users?: Peer[] }
        clearTimeout(timeout)
        if (!ack.ok) {
          teardown(false)
          setPhase('error')
          resolve({ ok: false, reason: ack.reason })
          return
        }
        const sid = socket.id ?? ''
        selfIdRef.current = sid
        selfSeqRef.current = ack.self?.seq ?? 0
        peerSeqCache.current.clear()
        peerSeqCache.current.set(sid, selfSeqRef.current)
        setSelf({ ...ack.self, id: sid, connection: 'connected' } as Peer)
        for (const u of ack.users ?? []) adoptExistingUser(u)
        if (stream) attachAnalyser(sid, stream)
        joinedRef.current = true
        setStartedAt(Date.now())
        pushSystemMessage('شما به جلسه پیوستید')
        setPhase('joined')
        resolve({ ok: true })
      })
    })
  }, [adoptExistingUser, attachAnalyser, ensureLocalMedia, pushSystemMessage, teardown, wireSocket])

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
    socketRef.current?.emit('media-state', { micOn: next, camOn, screenSharing })
  }, [camOn, screenSharing, toast])

  const toggleCam = useCallback(() => {
    const track = cameraVideoTrackRef.current
    if (!track) {
      toast({ title: 'دوربین در دسترس نیست', description: 'دسترسی دوربین در مرورگر داده نشده است.' })
      return
    }
    const next = !track.enabled
    track.enabled = next
    setCamOn(next)
    socketRef.current?.emit('media-state', { micOn, camOn: next, screenSharing })
  }, [micOn, screenSharing, toast])

  const stopScreenShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    replaceVideoTrackOnAll(cameraVideoTrackRef.current, false)
    setLocalStream(cameraStreamRef.current)
    setScreenSharing(false)
    socketRef.current?.emit('media-state', { micOn, camOn, screenSharing: false })
  }, [camOn, micOn, replaceVideoTrackOnAll])

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
      screenStreamRef.current = display
      screenTrack.addEventListener('ended', () => stopScreenShare())
      replaceVideoTrackOnAll(screenTrack, true)
      setLocalStream(display)
      setScreenSharing(true)
      socketRef.current?.emit('media-state', { micOn, camOn, screenSharing: true })
    } catch {
      toast({ title: 'اشتراک صفحه لغو شد' })
    }
  }, [camOn, micOn, stopScreenShare, screenSharing, replaceVideoTrackOnAll, toast])

  const toggleHand = useCallback(() => {
    const next = !handRaised
    setHandRaised(next)
    socketRef.current?.emit('raise-hand', { handRaised: next })
    toast({ title: next ? 'دست شما بالا رفت' : 'دست شما پایین آمد' })
  }, [handRaised, toast])

  const sendReaction = useCallback((icon: ReactionIcon) => {
    const key = `self-${Date.now()}-${Math.random()}`
    const name = self?.name ?? 'شما'
    setReactions((prev) => [...prev, { key, icon, name }])
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.key !== key)), 4200)
    socketRef.current?.emit('reaction', { icon })
  }, [self?.name])

  const sendChat = useCallback((text: string) => {
    const clean = text.trim()
    if (!clean) return
    socketRef.current?.emit('chat-message', { text: clean })
  }, [])

  /* ----------------------------- host actions ----------------------------- */

  const muteAll = useCallback(() => {
    socketRef.current?.emit('host-mute-all', (res: unknown) => {
      const ack = res as { ok: boolean; count?: number }
      if (ack.ok) {
        toast({ title: 'صدای همه قطع شد', description: `${ack.count ?? 0} نفر بی‌صدا شدند.` })
      }
    })
  }, [toast])

  const removePeer = useCallback((id: string) => {
    socketRef.current?.emit('host-remove', { targetId: id }, (res: unknown) => {
      const ack = res as { ok: boolean }
      if (!ack.ok) toast({ title: 'فقط میزبان می‌تواند این کار را انجام دهد' })
    })
  }, [toast])

  /* ------------------------------ cleanup ------------------------------ */

  useEffect(() => {
    return () => {
      teardown(true)
    }
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
