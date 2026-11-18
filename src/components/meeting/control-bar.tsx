'use client'

import { useState } from 'react'
import {
  Hand,
  Heart,
  Laugh,
  Lightbulb,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PartyPopper,
  PhoneOff,
  Smile,
  ThumbsUp,
  Users,
  Video,
  VideoOff,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { REACTION_ICONS, type ReactionIcon } from '@/lib/meeting'

export const REACTION_ICON_MAP: Record<ReactionIcon, { icon: LucideIcon; label: string }> = {
  thumbsUp: { icon: ThumbsUp, label: 'پسندیدم' },
  heart: { icon: Heart, label: 'قلب' },
  party: { icon: PartyPopper, label: 'تبریک' },
  laugh: { icon: Laugh, label: 'خنده' },
  lightbulb: { icon: Lightbulb, label: 'ایده' },
  smile: { icon: Smile, label: 'لبخند' },
}

export interface ControlBarProps {
  micOn: boolean
  camOn: boolean
  screenSharing: boolean
  handRaised: boolean
  unreadChat: number
  participantCount: number
  onToggleMic: () => void
  onToggleCam: () => void
  onToggleScreen: () => void
  onToggleHand: () => void
  onReaction: (icon: ReactionIcon) => void
  onToggleChat: () => void
  onToggleParticipants: () => void
  onLeave: () => void
}

function ControlButton({
  label,
  onClick,
  active,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  active?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          onClick={onClick}
          aria-label={label}
          className={`size-12 rounded-full transition-all ${
            danger
              ? 'bg-red-500 text-white shadow-lg shadow-red-900/40 hover:bg-red-500/90 hover:scale-105'
              : active
                ? 'bg-teal-400 text-slate-900 shadow-md shadow-teal-500/30 hover:bg-teal-300 hover:scale-105'
                : 'bg-white/10 text-teal-100 hover:bg-white/20 hover:scale-105'
          }`}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="glass-strong border-white/10 text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function ControlBar({
  micOn,
  camOn,
  screenSharing,
  handRaised,
  unreadChat,
  participantCount,
  onToggleMic,
  onToggleCam,
  onToggleScreen,
  onToggleHand,
  onReaction,
  onToggleChat,
  onToggleParticipants,
  onLeave,
}: ControlBarProps) {
  const [reactionsOpen, setReactionsOpen] = useState(false)

  return (
    <TooltipProvider delayDuration={300}>
      <div className="glass-strong pointer-events-auto flex items-center gap-1.5 rounded-full px-2.5 py-2 sm:gap-2 sm:px-3">
        <ControlButton label={micOn ? 'قطع میکروفون' : 'وصل میکروفون'} onClick={onToggleMic} active={micOn}>
          {micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
        </ControlButton>

        <ControlButton label={camOn ? 'قطع دوربین' : 'وصل دوربین'} onClick={onToggleCam} active={camOn}>
          {camOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}
        </ControlButton>

        <ControlButton
          label={screenSharing ? 'پایان اشتراک صفحه' : 'اشتراک صفحه'}
          onClick={onToggleScreen}
          active={screenSharing}
        >
          <MonitorUp className="size-5" />
        </ControlButton>

        <ControlButton
          label={handRaised ? 'پایین آوردن دست' : 'بالا بردن دست'}
          onClick={onToggleHand}
          active={handRaised}
        >
          <Hand className="size-5" />
        </ControlButton>

        <Popover open={reactionsOpen} onOpenChange={setReactionsOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon"
              aria-label="واکنش‌ها"
              title="واکنش‌ها"
              className="size-12 rounded-full bg-white/10 text-teal-100 hover:bg-white/20 hover:scale-105"
            >
              <Smile className="size-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="center"
            sideOffset={12}
            className="glass-strong w-auto rounded-2xl border-white/15 p-2"
          >
            <div className="flex items-center gap-1">
              {REACTION_ICONS.map((icon) => {
                const meta = REACTION_ICON_MAP[icon]
                const Icon = meta.icon
                return (
                  <Button
                    key={icon}
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={meta.label}
                    title={meta.label}
                    onClick={() => {
                      onReaction(icon)
                      setReactionsOpen(false)
                    }}
                    className="size-11 rounded-xl text-xl text-teal-100 hover:bg-white/15 hover:scale-110"
                  >
                    <Icon className="size-5" />
                  </Button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>

        <div className="mx-1 hidden h-8 w-px bg-white/15 sm:block" aria-hidden="true" />

        <ControlButton label="چت" onClick={onToggleChat}>
          <span className="relative">
            <MessageSquare className="size-5" />
            {unreadChat > 0 && (
              <span className="absolute -top-2 -left-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-teal-400 px-1 text-[10px] font-bold text-slate-900">
                {unreadChat > 9 ? '۹+' : unreadChat.toLocaleString('fa-IR')}
              </span>
            )}
          </span>
        </ControlButton>

        <ControlButton label="شرکت‌کننده‌ها" onClick={onToggleParticipants}>
          <span className="relative">
            <Users className="size-5" />
            <span className="absolute -top-2 -left-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-white/15 px-1 text-[10px] font-bold text-teal-100">
              {participantCount.toLocaleString('fa-IR')}
            </span>
          </span>
        </ControlButton>

        <ControlButton label="ترک جلسه" onClick={onLeave} danger>
          <PhoneOff className="size-5" />
        </ControlButton>
      </div>
    </TooltipProvider>
  )
}
