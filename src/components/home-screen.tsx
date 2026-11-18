'use client'

import { useMemo, useState, type KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import {
  Cpu,
  Gauge,
  Hand,
  History,
  LogIn,
  MessageSquare,
  MonitorUp,
  Sparkles,
  Users,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { formatRoomCode } from '@/lib/meeting'

export interface RecentMeeting {
  code: string
  name: string
  at: number
}

export interface HomeScreenProps {
  userName: string
  onUserNameChange: (name: string) => void
  onCreateMeeting: () => void
  onJoinMeeting: (code: string) => void
  recentMeetings: RecentMeeting[]
  onRemoveRecent: (code: string) => void
  busy: boolean
  /** Deep-link support: prefills the join code input (e.g. from /#/room/<code>) */
  prefillCode?: string
}

interface FeatureItem {
  icon: LucideIcon
  label: string
}

const FEATURES: FeatureItem[] = [
  { icon: Users, label: 'تا ۱۸ نفر' },
  { icon: MonitorUp, label: 'اشتراک صفحه' },
  { icon: MessageSquare, label: 'چت زنده' },
  { icon: Gauge, label: 'سبک و کم‌مصرف' },
]

/** Strips dashes/whitespace and lowercases a meeting code. */
function normalizeCode(raw: string): string {
  return raw.replace(/[\s-]+/g, '').toLowerCase()
}

/** Valid when at least 4 alphanumeric characters remain after stripping dashes. */
function isCodeValid(raw: string): boolean {
  return /^[a-z0-9]{4,}$/i.test(raw.replace(/[\s-]+/g, ''))
}

export default function HomeScreen({
  userName,
  onUserNameChange,
  onCreateMeeting,
  onJoinMeeting,
  recentMeetings,
  onRemoveRecent,
  busy,
  prefillCode,
}: HomeScreenProps) {
  const [code, setCode] = useState('')
  const [appliedPrefill, setAppliedPrefill] = useState<string | undefined>(undefined)

  // Adjust state during render when a new deep-link prefill arrives
  if (prefillCode !== appliedPrefill) {
    setAppliedPrefill(prefillCode)
    if (prefillCode) setCode(prefillCode)
  }

  const trimmedName = userName.trim()
  const canCreate = !busy && trimmedName.length > 0
  const canJoin = !busy && canCreate && isCodeValid(code)

  const sortedRecent = useMemo(
    () => [...recentMeetings].sort((a, b) => b.at - a.at),
    [recentMeetings],
  )

  const handleCreate = () => {
    if (!canCreate) return
    onCreateMeeting()
  }

  const handleJoin = () => {
    if (!canJoin) return
    onJoinMeeting(normalizeCode(code))
  }

  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleCreate()
    }
  }

  const handleCodeKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleJoin()
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* Fixed turquoise scenery */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-[oklch(0.14_0.02_200)]"
      >
        <div
          className="animate-blob absolute -top-44 right-[-7rem] h-[30rem] w-[30rem] rounded-full blur-3xl"
          style={{
            background:
              'radial-gradient(circle, oklch(0.72 0.14 185 / 0.25) 0%, transparent 65%)',
          }}
        />
        <div
          className="animate-blob-slow absolute bottom-[-9rem] left-[-8rem] h-[34rem] w-[34rem] rounded-full blur-3xl"
          style={{
            background:
              'radial-gradient(circle, oklch(0.65 0.15 155 / 0.18) 0%, transparent 65%)',
          }}
        />
        <div
          className="animate-blob absolute left-1/4 top-1/4 h-[26rem] w-[26rem] rounded-full blur-3xl"
          style={{
            background:
              'radial-gradient(circle, oklch(0.8 0.1 190 / 0.15) 0%, transparent 65%)',
            animationDelay: '-9s',
          }}
        />
        <div className="bg-grid-overlay absolute inset-0" />
      </div>

      {/* Decorative floating tiles (depth) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[6%] top-[12%] hidden md:block"
      >
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3, ease: 'easeOut' }}
          className="opacity-60"
        >
          <div className="glass flex items-center gap-2.5 rounded-2xl p-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400/90 to-cyan-500/90">
              <Video className="size-4 text-primary-foreground" />
            </div>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] text-teal-100/80">
              کلاس فیزیک
            </span>
          </div>
        </motion.div>
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[14%] left-[7%] hidden md:block"
      >
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.45, ease: 'easeOut' }}
          className="opacity-60"
        >
          <div className="glass flex items-center gap-2.5 rounded-2xl p-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-white/10">
              <Hand className="size-4 text-teal-200" />
            </div>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] text-teal-100/80">
              درخواست صحبت
            </span>
          </div>
        </motion.div>
      </div>

      {/* Main card */}
      <main className="relative z-10 w-full max-w-md">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          className="glass-strong w-full rounded-3xl p-6 sm:p-10"
        >
          {/* Logo row */}
          <div className="flex items-center gap-3">
            <div className="glow-primary flex size-14 shrink-0 items-center justify-center rounded-2xl border border-white/25 bg-gradient-to-br from-teal-400 to-cyan-500">
              <Video className="size-7 text-primary-foreground" aria-hidden="true" />
            </div>
            <div className="flex min-w-0 flex-col items-start gap-1.5">
              <h1 className="text-gradient text-3xl font-extrabold leading-tight">
                کلاس‌میت
              </h1>
              <Badge
                variant="outline"
                className="glass-subtle rounded-full text-[10px] font-medium text-teal-200"
              >
                سبک و کم‌مصرف
              </Badge>
            </div>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            کلاس آنلاین خودت را در چند ثانیه برگزار کن — مشابه گوگل میت، بدون دردسر
          </p>

          {/* Name field */}
          <div className="mt-6 space-y-2">
            <label
              htmlFor="home-name"
              className="block text-sm font-medium text-foreground/90"
            >
              نام شما
            </label>
            <Input
              id="home-name"
              value={userName}
              onChange={(event) => onUserNameChange(event.target.value)}
              onKeyDown={handleNameKeyDown}
              placeholder="مثلاً: استاد محمدی"
              disabled={busy}
              className="glass-input h-12 rounded-xl"
            />
          </div>

          {/* Primary CTA */}
          <Button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            className="mt-3 h-[52px] w-full rounded-xl bg-gradient-to-l from-teal-400 via-teal-300 to-cyan-500 text-base font-bold text-slate-900 shadow-lg shadow-teal-950/20 hover:scale-[1.02] hover:shadow-xl hover:shadow-teal-400/30 active:scale-[0.98]"
          >
            <Sparkles className="size-4" aria-hidden="true" />
            جلسه جدید بسازید
          </Button>

          {/* Divider */}
          <div className="mt-6 flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">
              یا با کد جلسه وارد شوید
            </span>
            <Separator className="flex-1" />
          </div>

          {/* Join row */}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label htmlFor="home-code" className="sr-only">
              کد جلسه
            </label>
            <Input
              id="home-code"
              dir="ltr"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={handleCodeKeyDown}
              placeholder="abc-defg-hij"
              disabled={busy}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="glass-input h-12 flex-1 rounded-xl text-left font-mono uppercase tracking-wider"
            />
            <Button
              type="button"
              onClick={handleJoin}
              disabled={!canJoin}
              className="h-12 rounded-xl border border-white/10 bg-white/10 text-foreground hover:bg-white/15 sm:px-5"
            >
              <LogIn className="size-4" aria-hidden="true" />
              ورود به جلسه
            </Button>
          </div>

          {/* Recent meetings */}
          {sortedRecent.length > 0 && (
            <section aria-labelledby="home-recent-title" className="mt-6">
              <h2
                id="home-recent-title"
                className="flex items-center gap-1.5 text-sm font-semibold"
              >
                <History className="size-4 text-teal-300" aria-hidden="true" />
                جلسه‌های اخیر
              </h2>
              <div className="scrollbar-slim mt-2.5 max-h-40 space-y-2 overflow-y-auto">
                {sortedRecent.map((meeting) => (
                  <div
                    key={meeting.code}
                    className="glass-subtle flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/10"
                  >
                    <button
                      type="button"
                      onClick={() => onJoinMeeting(meeting.code)}
                      className="min-w-0 flex-1 cursor-pointer text-right"
                    >
                      <span dir="ltr" className="block font-mono text-sm text-teal-300">
                        {formatRoomCode(meeting.code)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {meeting.name}
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemoveRecent(meeting.code)}
                      aria-label={`حذف جلسه ${meeting.name || meeting.code}`}
                      className="size-11 shrink-0 rounded-lg text-muted-foreground hover:bg-white/10 hover:text-foreground"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Feature badges */}
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FEATURES.map((feature) => (
              <div
                key={feature.label}
                className="glass-subtle flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] text-teal-100/90"
              >
                <feature.icon className="size-4 text-teal-300" aria-hidden="true" />
                <span>{feature.label}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15, ease: 'easeOut' }}
        className="relative z-10 mt-8 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground/70"
      >
        <Cpu className="size-3.5 shrink-0" aria-hidden="true" />
        <span>طراحی‌شده برای اجرا روی منابع کم: ۱ هسته CPU و ۲ گیگابایت رم</span>
      </motion.p>
    </div>
  )
}
