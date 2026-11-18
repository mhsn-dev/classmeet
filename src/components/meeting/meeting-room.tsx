'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Clock,
  Copy,
  Info,
  Link2,
  Video,
  WifiOff,
  X,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import type { MeetingController, Peer } from '@/hooks/use-meeting'
import {
  formatElapsedTime,
  formatRoomCode,
  type ReactionIcon,
} from '@/lib/meeting'
import { ControlBar, REACTION_ICON_MAP } from './control-bar'
import { SidePanel, type SidePanelTab } from './side-panel'
import { VideoTile } from './video-tile'

export interface MeetingRoomProps {
  meeting: MeetingController
  onLeave: () => void
}

interface TilePerson {
  id: string
  name: string
  color: string
  micOn: boolean
  camOn: boolean
  screenSharing: boolean
  handRaised: boolean
  isHost: boolean
  connection: 'connecting' | 'connected' | 'reconnecting' | 'failed'
  speaking: boolean
  isSelf: boolean
}

function gridCols(count: number): number {
  if (count <= 1) return 1
  if (count <= 4) return 2
  if (count <= 9) return 3
  return 4
}

export function MeetingRoom({ meeting, onLeave }: MeetingRoomProps) {
  const { toast } = useToast()
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [tab, setTab] = useState<SidePanelTab>('chat')
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [, setTick] = useState(0)
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [lastReadTs, setLastReadTs] = useState(0)

  // 1-second ticker for the meeting timer
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const unread = useMemo(() => {
    if (panelOpen && tab === 'chat') return 0
    return meeting.messages.filter((m) => m.kind === 'chat' && !m.mine && m.ts > lastReadTs).length
  }, [meeting.messages, panelOpen, tab, lastReadTs])

  const showMediaError = !!meeting.mediaError && meeting.mediaError !== dismissedError

  /** Marks currently visible chat as read; called from event handlers only. */
  const markChatRead = () => setLastReadTs(Date.now())

  const handleToggleChat = () => {
    if (panelOpen && tab === 'chat') {
      setPanelOpen(false)
      markChatRead()
    } else {
      setTab('chat')
      setPanelOpen(true)
      markChatRead()
    }
  }

  const handleToggleParticipants = () => {
    if (panelOpen && tab === 'participants') {
      setPanelOpen(false)
      markChatRead()
    } else {
      setTab('participants')
      setPanelOpen(true)
      markChatRead()
    }
  }

  const handleClosePanel = () => {
    setPanelOpen(false)
    markChatRead()
  }

  const handleTabChange = (t: SidePanelTab) => {
    setTab(t)
    markChatRead()
  }

  const people: TilePerson[] = useMemo(() => {
    const list: TilePerson[] = []
    if (meeting.self) {
      list.push({
        id: meeting.self.id,
        name: meeting.self.name,
        color: meeting.self.color,
        micOn: meeting.micOn,
        camOn: meeting.camOn,
        screenSharing: meeting.screenSharing,
        handRaised: meeting.handRaised,
        isHost: meeting.self.isHost,
        connection: 'connected',
        speaking: meeting.activeSpeakerId === meeting.self.id,
        isSelf: true,
      })
    }
    for (const p of meeting.peers as Peer[]) {
      list.push({
        id: p.id,
        name: p.name,
        color: p.color,
        micOn: p.micOn,
        camOn: p.camOn,
        screenSharing: p.screenSharing,
        handRaised: p.handRaised,
        isHost: p.isHost,
        connection: p.connection,
        speaking: meeting.activeSpeakerId === p.id,
        isSelf: false,
      })
    }
    return list
  }, [meeting.self, meeting.peers, meeting.micOn, meeting.camOn, meeting.screenSharing, meeting.handRaised, meeting.activeSpeakerId])

  const spotlightId = useMemo(() => {
    if (pinnedId && people.some((p) => p.id === pinnedId)) return pinnedId
    const sharing = people.find((p) => p.screenSharing)
    return sharing?.id ?? null
  }, [pinnedId, people])

  const isHost = meeting.self?.isHost ?? false
  const streamFor = (person: TilePerson): MediaStream | null =>
    person.isSelf ? meeting.localStream : meeting.getPeerStream(person.id)

  const copyInvite = async () => {
    // pathname already includes the basePath on GitHub Pages deployments
    const link = `${window.location.origin}${window.location.pathname}#/room/${meeting.roomId}`
    try {
      await navigator.clipboard.writeText(link)
      toast({ title: 'لینک دعوت کپی شد' })
    } catch {
      const ta = document.createElement('textarea')
      ta.value = link
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); toast({ title: 'لینک دعوت کپی شد' }) } catch { toast({ title: 'کپی ناموفق بود', description: link }) }
      ta.remove()
    }
  }

  const togglePin = (id: string) => setPinnedId((prev) => (prev === id ? null : id))

  const gridCount = people.length
  const cols = gridCols(gridCount)

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-[oklch(0.14_0.02_200)]">
      {/* Scenery */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="animate-blob absolute -top-52 right-[-10rem] h-[34rem] w-[34rem] rounded-full opacity-60 blur-3xl"
          style={{ background: 'radial-gradient(circle, oklch(0.72 0.14 185 / 0.18) 0%, transparent 65%)' }}
        />
        <div
          className="animate-blob-slow absolute bottom-[-12rem] left-[-10rem] h-[36rem] w-[36rem] rounded-full opacity-60 blur-3xl"
          style={{ background: 'radial-gradient(circle, oklch(0.65 0.15 155 / 0.13) 0%, transparent 65%)' }}
        />
      </div>

      {/* Header */}
      <header className="glass z-20 flex shrink-0 items-center justify-between gap-2 rounded-none border-x-0 border-t-0 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-cyan-500">
            <Video className="size-4.5 text-slate-900" aria-hidden="true" />
          </div>
          <span className="text-gradient hidden text-lg font-extrabold sm:block">کلاس‌میت</span>
          <button
            type="button"
            onClick={copyInvite}
            aria-label="کپی لینک دعوت"
            title="کپی لینک دعوت"
            className="glass-subtle group flex min-w-0 items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors hover:bg-white/15"
          >
            <Link2 className="size-3.5 shrink-0 text-teal-300" aria-hidden="true" />
            <span dir="ltr" className="truncate font-mono text-xs tracking-wider text-teal-200">
              {formatRoomCode(meeting.roomId)}
            </span>
            <Copy className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="glass-subtle flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs tabular-nums text-teal-100">
            <Clock className="size-3.5 text-teal-300" aria-hidden="true" />
            {meeting.startedAt ? formatElapsedTime(meeting.startedAt) : '--:--'}
            <span className="sr-only">مدت جلسه</span>
          </span>
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] ${
              meeting.socketConnected ? 'glass-subtle text-teal-200' : 'bg-red-500/15 text-red-200'
            }`}
            aria-live="polite"
          >
            {meeting.socketConnected ? (
              <>
                <span className="size-2 rounded-full bg-teal-300" aria-hidden="true" />
                متصل
              </>
            ) : (
              <>
                <WifiOff className="size-3.5" aria-hidden="true" />
                قطع
              </>
            )}
          </span>
        </div>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col gap-2 p-2 sm:p-3">
          {/* Media error banner */}
          {showMediaError && (
            <div className="absolute inset-x-2 top-2 z-30 flex items-start justify-between gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-200 backdrop-blur sm:inset-x-3">
              <span className="flex items-start gap-2">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {meeting.mediaError}
              </span>
              <button
                type="button"
                onClick={() => setDismissedError(meeting.mediaError ?? null)}
                aria-label="بستن"
                className="rounded-lg p-1 hover:bg-white/10"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Reactions overlay */}
          <div className="pointer-events-none absolute inset-x-0 bottom-28 z-30 flex flex-col items-center gap-1.5" aria-live="polite">
            {meeting.reactions.map((r) => {
              const Meta = REACTION_ICON_MAP[r.icon as ReactionIcon]
              const Icon = Meta?.icon
              return (
                <div key={r.key} className="animate-reaction glass-strong flex items-center gap-2 rounded-full px-3 py-1.5">
                  {Icon && <Icon className="size-4 text-teal-300" aria-hidden="true" />}
                  <span className="text-xs text-teal-100">{r.name}</span>
                </div>
              )
            })}
          </div>

          {/* Video area */}
          {spotlightId ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="min-h-0 flex-1">
                {people
                  .filter((p) => p.id === spotlightId)
                  .map((p) => (
                    <VideoTile
                      key={p.id}
                      stream={streamFor(p)}
                      name={p.name}
                      color={p.color}
                      isSelf={p.isSelf}
                      micOn={p.micOn}
                      camOn={p.camOn}
                      handRaised={p.handRaised}
                      screenSharing={p.screenSharing}
                      isHost={p.isHost}
                      connection={p.connection}
                      speaking={p.speaking}
                      pinned={pinnedId === p.id}
                      onTogglePin={() => togglePin(p.id)}
                    />
                  ))}
              </div>
              {people.length > 1 && (
                <div className="scrollbar-slim flex h-24 shrink-0 gap-2 overflow-x-auto pb-0.5 sm:h-28">
                  {people
                    .filter((p) => p.id !== spotlightId)
                    .map((p) => (
                      <div key={p.id} className="h-full pt-0.5">
                        <VideoTile
                          compact
                          stream={streamFor(p)}
                          name={p.name}
                          color={p.color}
                          isSelf={p.isSelf}
                          micOn={p.micOn}
                          camOn={p.camOn}
                          handRaised={p.handRaised}
                          screenSharing={p.screenSharing}
                          isHost={p.isHost}
                          connection={p.connection}
                          speaking={p.speaking}
                          pinned={pinnedId === p.id}
                          onTogglePin={() => togglePin(p.id)}
                        />
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <div
              className="grid min-h-0 flex-1 gap-2"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: 'minmax(0, 1fr)' }}
            >
              {people.map((p) => (
                <VideoTile
                  key={p.id}
                  stream={streamFor(p)}
                  name={p.name}
                  color={p.color}
                  isSelf={p.isSelf}
                  micOn={p.micOn}
                  camOn={p.camOn}
                  handRaised={p.handRaised}
                  screenSharing={p.screenSharing}
                  isHost={p.isHost}
                  connection={p.connection}
                  speaking={p.speaking}
                  pinned={pinnedId === p.id}
                  onTogglePin={() => togglePin(p.id)}
                />
              ))}
            </div>
          )}

          {/* Control bar */}
          <div className="flex shrink-0 justify-center">
            <ControlBar
              micOn={meeting.micOn}
              camOn={meeting.camOn}
              screenSharing={meeting.screenSharing}
              handRaised={meeting.handRaised}
              unreadChat={unread}
              participantCount={people.length}
              onToggleMic={meeting.toggleMic}
              onToggleCam={meeting.toggleCam}
              onToggleScreen={() => void meeting.toggleScreenShare()}
              onToggleHand={meeting.toggleHand}
              onReaction={meeting.sendReaction}
              onToggleChat={handleToggleChat}
              onToggleParticipants={handleToggleParticipants}
              onLeave={() => setConfirmLeave(true)}
            />
          </div>
        </main>

        {/* Side panel */}
        {panelOpen && (
          <aside className="fixed inset-0 z-40 p-2 sm:static sm:z-auto sm:w-80 sm:shrink-0 sm:py-3 sm:pl-0 sm:pr-3">
            <SidePanel
              tab={tab}
              onTabChange={handleTabChange}
              messages={meeting.messages}
              self={meeting.self}
              peers={meeting.peers as Peer[]}
              isHost={isHost}
              onClose={handleClosePanel}
              onSendChat={meeting.sendChat}
              onMuteAll={meeting.muteAll}
              onRemovePeer={meeting.removePeer}
            />
          </aside>
        )}
      </div>

      {/* Leave confirmation */}
      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent className="glass-strong border-white/15">
          <AlertDialogHeader>
            <AlertDialogTitle>از جلسه خارج می‌شوید؟</AlertDialogTitle>
            <AlertDialogDescription>
              برای بازگشت باید دوباره با کد جلسه وارد شوید.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-xl bg-white/10 border-white/15 hover:bg-white/15">
              ماندن در جلسه
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onLeave}
              className="rounded-xl bg-red-500 text-white hover:bg-red-500/90"
            >
              خروج از جلسه
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
