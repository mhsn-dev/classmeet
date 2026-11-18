'use client'

import { useEffect, useRef } from 'react'
import {
  Crown,
  Hand,
  MicOff,
  MonitorUp,
  Pin,
  PinOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PeerConnectionStatus } from '@/hooks/use-meeting'

export interface VideoTileProps {
  stream: MediaStream | null
  name: string
  color: string
  isSelf: boolean
  micOn: boolean
  camOn: boolean
  handRaised: boolean
  screenSharing: boolean
  isHost: boolean
  connection: PeerConnectionStatus
  speaking: boolean
  pinned: boolean
  onTogglePin: () => void
  compact?: boolean
}

const CONNECTION_LABELS: Record<PeerConnectionStatus, string> = {
  connecting: 'در حال اتصال…',
  connected: 'متصل',
  reconnecting: 'اتصال مجدد…',
  failed: 'اتصال برقرار نشد',
}

export function VideoTile({
  stream,
  name,
  color,
  isSelf,
  micOn,
  camOn,
  handRaised,
  screenSharing,
  isHost,
  connection,
  speaking,
  pinned,
  onTogglePin,
  compact = false,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (el.srcObject !== stream) {
      el.srcObject = stream
    }
    if (stream) {
      el.play().catch(() => { /* autoplay may need a gesture; handled by join click */ })
    }
  }, [stream])

  const showVideo = camOn && !!stream && stream.getVideoTracks().length > 0
  const ringClass = speaking
    ? 'animate-speaking ring-2 ring-teal-300/80'
    : connection === 'connected'
      ? 'ring-1 ring-white/10'
      : connection === 'failed'
        ? 'ring-2 ring-red-400/60'
        : 'ring-2 ring-amber-300/50'

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl bg-[oklch(0.12_0.02_200)] ${ringClass} ${compact ? 'w-44 shrink-0' : 'h-full w-full'}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf}
        className={`tile-video absolute inset-0 ${isSelf && !screenSharing ? 'video-mirror' : ''} ${showVideo ? 'opacity-100' : 'opacity-0'}`}
        aria-label={`ویدئوی ${name}`}
      />

      {/* Avatar fallback */}
      {!showVideo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-white/5 to-transparent">
          <div
            className={`flex items-center justify-center rounded-full font-bold text-primary-foreground ${compact ? 'size-12 text-lg' : 'size-20 text-3xl'}`}
            style={{ backgroundColor: color, boxShadow: `0 0 32px ${color}55` }}
            aria-hidden="true"
          >
            {name.trim().charAt(0) || '?'}
          </div>
          {connection !== 'connected' && (
            <span className="rounded-full bg-black/40 px-3 py-1 text-xs text-amber-200 backdrop-blur">
              {CONNECTION_LABELS[connection]}
            </span>
          )}
        </div>
      )}

      {/* Screen share tag */}
      {screenSharing && (
        <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-teal-400/90 px-2.5 py-1 text-[11px] font-bold text-slate-900">
          <MonitorUp className="size-3" aria-hidden="true" />
          اشتراک صفحه
        </span>
      )}

      {/* Raised hand */}
      {handRaised && (
        <span
          className={`absolute top-2 flex size-8 items-center justify-center rounded-full bg-amber-400 text-slate-900 ${screenSharing ? 'left-2' : 'right-2'}`}
          title="دست بالا"
        >
          <Hand className="size-4" aria-hidden="true" />
        </span>
      )}

      {/* Pin button */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onTogglePin}
        aria-label={pinned ? 'برداشتن پین' : 'پین کردن'}
        className="absolute bottom-2 left-2 size-9 rounded-full bg-black/40 text-white/80 opacity-0 backdrop-blur transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
      >
        {pinned ? <PinOff className="size-4" aria-hidden="true" /> : <Pin className="size-4" aria-hidden="true" />}
      </Button>

      {/* Bottom info bar */}
      <div className="absolute inset-x-2 bottom-2 flex items-center justify-end gap-2 pl-2">
        <div className="glass-subtle flex min-w-0 items-center gap-1.5 rounded-full py-1 pl-3 pr-1.5">
          {!micOn && (
            <span className="flex size-6 items-center justify-center rounded-full bg-red-500/80 text-white" title="میکروفون خاموش">
              <MicOff className="size-3.5" aria-hidden="true" />
            </span>
          )}
          {isHost && <Crown className="size-3.5 shrink-0 text-amber-300" aria-label="میزبان" />}
          <span className="truncate text-xs font-medium text-white/90">
            {name}
            {isSelf ? ' (شما)' : ''}
          </span>
        </div>
      </div>

      {/* Connection status dot */}
      <span
        className={`absolute top-2 right-2 size-2 rounded-full ${
          connection === 'connected'
            ? 'bg-teal-300'
            : connection === 'failed'
              ? 'bg-red-400'
              : 'bg-amber-300'
        }`}
        title={CONNECTION_LABELS[connection]}
      />
    </div>
  )
}
