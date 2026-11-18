'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Info,
  Mic,
  MicOff,
  Users,
  Video,
  VideoOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MeetingController } from '@/hooks/use-meeting'
import { formatRoomCode } from '@/lib/meeting'

export interface PreJoinProps {
  roomId: string
  meeting: MeetingController
  joining: boolean
  onJoin: (micOn: boolean, camOn: boolean) => void
  onBack: () => void
}

export function PreJoin({ roomId, meeting, joining, onJoin, onBack }: PreJoinProps) {
  const [micOn, setMicOn] = useState(meeting.micOn)
  const [camOn, setCamOn] = useState(meeting.camOn)
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewStartedRef = useRef(false)

  // Acquire media once for the preview
  useEffect(() => {
    if (previewStartedRef.current) return
    previewStartedRef.current = true
    void meeting.ensureLocalMedia(true)
  }, [meeting])

  // Keep toggles in sync with device availability (render-time adjustment)
  if (!meeting.hasMicDevice && micOn) setMicOn(false)
  if (!meeting.hasCamDevice && camOn) setCamOn(false)

  // Bind preview stream
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (el.srcObject !== meeting.localStream) {
      el.srcObject = meeting.localStream
    }
    if (meeting.localStream) el.play().catch(() => { /* noop */ })
  }, [meeting.localStream])

  const toggleMic = () => {
    const next = !micOn
    if (!meeting.hasMicDevice) return
    const track = meeting.localStream?.getAudioTracks()[0]
    if (track) track.enabled = next
    setMicOn(next)
  }

  const toggleCam = () => {
    const next = !camOn
    if (!meeting.hasCamDevice) return
    const track = meeting.localStream?.getVideoTracks()[0]
    if (track) track.enabled = next
    setCamOn(next)
  }

  const showPreview = camOn && meeting.hasCamDevice && !!meeting.localStream && meeting.localStream.getVideoTracks().length > 0

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-8">
      {/* Scenery */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-[oklch(0.14_0.02_200)]">
        <div
          className="animate-blob absolute -top-40 left-[-6rem] h-[28rem] w-[28rem] rounded-full blur-3xl"
          style={{ background: 'radial-gradient(circle, oklch(0.72 0.14 185 / 0.22) 0%, transparent 65%)' }}
        />
        <div
          className="animate-blob-slow absolute bottom-[-8rem] right-[-7rem] h-[30rem] w-[30rem] rounded-full blur-3xl"
          style={{ background: 'radial-gradient(circle, oklch(0.65 0.15 155 / 0.16) 0%, transparent 65%)' }}
        />
        <div className="bg-grid-overlay absolute inset-0" />
      </div>

      <main className="relative z-10 w-full max-w-2xl">
        <div className="glass-strong rounded-3xl p-5 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-bold sm:text-2xl">آماده پیوستن به جلسه</h1>
            <span dir="ltr" className="glass-subtle rounded-full px-3.5 py-1.5 font-mono text-sm tracking-wider text-teal-300">
              {formatRoomCode(roomId)}
            </span>
          </div>

          {/* Preview */}
          <div className="relative mt-5 aspect-video w-full overflow-hidden rounded-2xl bg-[oklch(0.11_0.02_200)] ring-1 ring-white/10">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`tile-video video-mirror ${showPreview ? 'opacity-100' : 'opacity-0'}`}
              aria-label="پیش‌نمایش دوربین"
            />
            {!showPreview && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <div className="glow-primary flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-cyan-500 text-slate-900">
                  <Video className="size-9" aria-hidden="true" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {meeting.hasCamDevice ? 'دوربین خاموش است' : 'دوربین در دسترس نیست'}
                </p>
              </div>
            )}
          </div>

          {meeting.mediaError && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3.5 py-3 text-xs leading-relaxed text-amber-200">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{meeting.mediaError}</span>
            </div>
          )}

          {/* Toggles */}
          <div className="mt-5 flex items-center justify-center gap-3">
            <Button
              type="button"
              size="icon"
              onClick={toggleMic}
              disabled={!meeting.hasMicDevice}
              aria-label={micOn ? 'قطع میکروفون' : 'وصل میکروفون'}
              className={`size-13 h-13 w-13 rounded-full ${micOn ? 'bg-teal-400 text-slate-900 hover:bg-teal-300' : 'bg-red-500/80 text-white hover:bg-red-500/70'}`}
            >
              {micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
            </Button>
            <Button
              type="button"
              size="icon"
              onClick={toggleCam}
              disabled={!meeting.hasCamDevice}
              aria-label={camOn ? 'قطع دوربین' : 'وصل دوربین'}
              className={`size-13 h-13 w-13 rounded-full ${camOn ? 'bg-teal-400 text-slate-900 hover:bg-teal-300' : 'bg-red-500/80 text-white hover:bg-red-500/70'}`}
            >
              {camOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}
            </Button>
          </div>

          {/* Actions */}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              type="button"
              onClick={() => onJoin(micOn, camOn)}
              disabled={joining}
              className="h-[52px] flex-1 rounded-xl bg-gradient-to-l from-teal-400 via-teal-300 to-cyan-500 text-base font-bold text-slate-900 shadow-lg shadow-teal-950/20 hover:scale-[1.01] active:scale-[0.99]"
            >
              {joining ? 'در حال ورود…' : 'پیوستن به جلسه'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              disabled={joining}
              className="h-[52px] rounded-xl border-white/15 bg-white/5 text-foreground hover:bg-white/10 sm:w-36"
            >
              <ArrowRight className="size-4" aria-hidden="true" />
              بازگشت
            </Button>
          </div>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground/80">
            <Users className="size-3.5" aria-hidden="true" />
            نخستین نفر میزبان جلسه است؛ ظرفیت جلسه حداکثر ۱۸ نفر
          </p>
        </div>
      </main>
    </div>
  )
}
