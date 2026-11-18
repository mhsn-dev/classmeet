'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import HomeScreen, { type RecentMeeting } from '@/components/home-screen'
import { MeetingRoom } from '@/components/meeting/meeting-room'
import { PreJoin } from '@/components/pre-join'
import { useToast } from '@/hooks/use-toast'
import { useMeeting } from '@/hooks/use-meeting'
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '@/lib/meeting'

type View = 'home' | 'prejoin' | 'room'

const NAME_KEY = 'classmeet:name'
const RECENT_KEY = 'classmeet:recent'

const JOIN_ERROR_MESSAGES: Record<string, string> = {
  'room-full': 'ظرفیت جلسه تکمیل است (حداکثر ۱۸ نفر).',
  'invalid-room': 'کد جلسه نامعتبر است.',
  'invalid-name': 'نام خود را وارد کنید.',
  timeout: 'اتصال به سرور ممکن نشد؛ دوباره تلاش کنید.',
}

export default function Page() {
  const meeting = useMeeting()
  const { toast } = useToast()

  const [view, setView] = useState<View>('home')
  const [userName, setUserName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [prefillCode, setPrefillCode] = useState('')
  const [recent, setRecent] = useState<RecentMeeting[]>([])
  const [busy, setBusy] = useState(false)
  const hydratedRef = useRef(false)

  const roomHashFromLocation = useCallback((): string | null => {
    const match = window.location.hash.match(/^#\/room\/([a-z0-9-]+)/i)
    if (!match) return null
    const code = normalizeRoomCode(match[1])
    return isValidRoomCode(code) ? code : null
  }, [])

  // Hydrate persisted state and deep links
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    const savedName = window.localStorage.getItem(NAME_KEY) ?? ''
    setUserName(savedName)
    try {
      const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]') as RecentMeeting[]
      if (Array.isArray(parsed)) setRecent(parsed.filter((r) => r && typeof r.code === 'string'))
    } catch {
      /* corrupted storage — ignore */
    }
    const code = roomHashFromLocation()
    if (code) {
      setPrefillCode(code)
      setJoinCode(code)
      if (savedName.trim()) setView('prejoin')
    }
  }, [roomHashFromLocation])

  // Deep-link navigation while the app is open
  useEffect(() => {
    const onHashChange = () => {
      const code = roomHashFromLocation()
      if (!code) return
      setPrefillCode(code)
      setJoinCode(code)
      if (userName.trim()) setView((v) => (v === 'room' ? v : 'prejoin'))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [roomHashFromLocation, userName])

  const saveName = useCallback((name: string) => {
    setUserName(name)
    window.localStorage.setItem(NAME_KEY, name)
  }, [])

  const pushRecent = useCallback((code: string, who: string) => {
    setRecent((prev) => {
      const next = [{ code, name: who, at: Date.now() }, ...prev.filter((r) => r.code !== code)].slice(0, 6)
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const removeRecent = useCallback((code: string) => {
    setRecent((prev) => {
      const next = prev.filter((r) => r.code !== code)
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const clearHash = useCallback(() => {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])

  const handleCreateMeeting = useCallback(() => {
    const code = generateRoomCode()
    setJoinCode(code)
    setPrefillCode('')
    setView('prejoin')
  }, [])

  const handleJoinMeeting = useCallback(
    (code: string) => {
      const clean = normalizeRoomCode(code)
      if (!isValidRoomCode(clean)) {
        toast({ title: 'کد جلسه نامعتبر است', description: 'کد را دقیقاً مانند نمونه وارد کنید.' })
        return
      }
      setJoinCode(clean)
      setPrefillCode('')
      setView('prejoin')
    },
    [toast],
  )

  const handleJoinNow = useCallback(
    async (micOn: boolean, camOn: boolean) => {
      if (!joinCode || busy) return
      setBusy(true)
      try {
        const res = await meeting.joinRoom({
          roomId: joinCode,
          name: userName.trim(),
          micOn,
          camOn,
        })
        if (res.ok) {
          pushRecent(joinCode, userName.trim())
          window.history.replaceState(null, '', `#/room/${joinCode}`)
          setView('room')
        } else {
          meeting.stopPreview()
          toast({
            title: 'ورود ناموفق بود',
            description: JOIN_ERROR_MESSAGES[res.reason ?? ''] ?? 'خطای نامشخص؛ دوباره تلاش کنید.',
          })
          clearHash()
          setView('home')
        }
      } finally {
        setBusy(false)
      }
    },
    [busy, clearHash, joinCode, meeting, pushRecent, toast, userName],
  )

  const handleLeave = useCallback(() => {
    meeting.leaveRoom()
    clearHash()
    setView('home')
  }, [clearHash, meeting])

  const handleBackFromPreJoin = useCallback(() => {
    meeting.stopPreview()
    clearHash()
    setView('home')
  }, [clearHash, meeting])

  // If kicked by the host, land back on home (toast already shown by the hook)
  useEffect(() => {
    if (meeting.kicked) {
      meeting.stopPreview()
      clearHash()
      setView('home')
    }
  }, [clearHash, meeting, meeting.kicked])

  if (view === 'room' && meeting.phase === 'joined') {
    return <MeetingRoom meeting={meeting} onLeave={handleLeave} />
  }

  if (view === 'prejoin') {
    return (
      <PreJoin
        roomId={joinCode}
        meeting={meeting}
        joining={busy}
        onJoin={handleJoinNow}
        onBack={handleBackFromPreJoin}
      />
    )
  }

  return (
    <HomeScreen
      userName={userName}
      onUserNameChange={saveName}
      onCreateMeeting={handleCreateMeeting}
      onJoinMeeting={handleJoinMeeting}
      recentMeetings={recent}
      onRemoveRecent={removeRecent}
      busy={busy}
      prefillCode={prefillCode}
    />
  )
}
