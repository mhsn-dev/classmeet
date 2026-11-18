'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Crown,
  Hand,
  MicOff,
  MessageSquare,
  Mic,
  Send,
  Users,
  UserX,
  VideoOff,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ChatMessage, Peer } from '@/hooks/use-meeting'

export type SidePanelTab = 'chat' | 'participants'

export interface SidePanelProps {
  tab: SidePanelTab
  onTabChange: (tab: SidePanelTab) => void
  messages: ChatMessage[]
  self: Peer | null
  peers: Peer[]
  isHost: boolean
  onClose: () => void
  onSendChat: (text: string) => void
  onMuteAll: () => void
  onRemovePeer: (id: string) => void
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function SidePanel({
  tab,
  onTabChange,
  messages,
  self,
  peers,
  isHost,
  onClose,
  onSendChat,
  onMuteAll,
  onRemovePeer,
}: SidePanelProps) {
  const [draft, setDraft] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (tab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages, tab])

  const handleSubmit = () => {
    const clean = draft.trim()
    if (!clean) return
    onSendChat(clean)
    setDraft('')
  }

  const everyone: Peer[] = self ? [self, ...peers] : peers

  return (
    <div className="glass-strong flex h-full min-h-0 flex-col overflow-hidden">
      {/* Tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b border-white/10 p-2">
        <button
          type="button"
          onClick={() => onTabChange('chat')}
          aria-pressed={tab === 'chat'}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
            tab === 'chat' ? 'bg-teal-400/15 text-teal-200' : 'text-muted-foreground hover:bg-white/5'
          }`}
        >
          <MessageSquare className="size-4" aria-hidden="true" />
          چت
        </button>
        <button
          type="button"
          onClick={() => onTabChange('participants')}
          aria-pressed={tab === 'participants'}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
            tab === 'participants' ? 'bg-teal-400/15 text-teal-200' : 'text-muted-foreground hover:bg-white/5'
          }`}
        >
          <Users className="size-4" aria-hidden="true" />
          شرکت‌کننده‌ها
          <span className="rounded-full bg-white/10 px-1.5 text-[11px]">
            {everyone.length.toLocaleString('fa-IR')}
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="بستن پنل"
          className="size-10 shrink-0 rounded-xl text-muted-foreground hover:bg-white/10 sm:hidden"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      {tab === 'chat' ? (
        <>
          <ScrollArea className="scrollbar-slim min-h-0 flex-1 px-3">
            <div className="flex flex-col gap-2.5 py-3" aria-live="polite">
              {messages.length === 0 ? (
                <div className="flex h-full min-h-40 items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  هنوز پیامی نیست. گفتگو را شروع کنید!
                </div>
              ) : (
                messages.map((msg) =>
                  msg.kind === 'system' ? (
                    <div key={msg.id} className="my-1 text-center text-[11px] text-muted-foreground/80">
                      {msg.text}
                    </div>
                  ) : (
                    <div key={msg.id} className={`flex flex-col gap-1 ${msg.mine ? 'items-start' : 'items-end'}`}>
                      <div
                        className={`max-w-[92%] rounded-2xl px-3 py-2 ${
                          msg.mine
                            ? 'rounded-tl-sm bg-teal-400/15 text-teal-50'
                            : 'rounded-tr-sm bg-white/8 text-foreground/90'
                        }`}
                      >
                        <div className="mb-0.5 flex items-center justify-between gap-3">
                          <span className="text-[11px] font-bold" style={{ color: msg.color }}>
                            {msg.mine ? 'شما' : msg.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground/70">{formatTime(msg.ts)}</span>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{msg.text}</p>
                      </div>
                    </div>
                  ),
                )
              )}
              <div ref={chatEndRef} />
            </div>
          </ScrollArea>
          <div className="shrink-0 border-t border-white/10 p-3">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                handleSubmit()
              }}
            >
              <label htmlFor="chat-input" className="sr-only">
                پیام چت
              </label>
              <Input
                id="chat-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="پیام خود را بنویسید…"
                maxLength={1200}
                className="glass-input h-11 flex-1 rounded-xl"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!draft.trim()}
                aria-label="ارسال پیام"
                className="size-11 shrink-0 rounded-xl bg-gradient-to-l from-teal-400 to-cyan-500 text-slate-900 hover:opacity-90"
              >
                <Send className="size-4 -scale-x-100" aria-hidden="true" />
              </Button>
            </form>
          </div>
        </>
      ) : (
        <>
          <ScrollArea className="scrollbar-slim min-h-0 flex-1 px-3">
            <div className="flex flex-col gap-1.5 py-3">
              {everyone.map((p) => {
                const isSelfRow = self != null && p.id === self.id
                return (
                  <div
                    key={p.id}
                    className="group flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-white/5"
                  >
                    <div
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-primary-foreground"
                      style={{ backgroundColor: p.color }}
                      aria-hidden="true"
                    >
                      {p.name.trim().charAt(0) || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{p.name}</span>
                        {isSelfRow && (
                          <span className="rounded-full bg-teal-400/15 px-1.5 py-0.5 text-[10px] text-teal-200">
                            شما
                          </span>
                        )}
                        {p.isHost && <Crown className="size-3.5 shrink-0 text-amber-300" aria-label="میزبان" />}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-muted-foreground">
                        {p.micOn ? (
                          <Mic className="size-3.5 text-teal-300" aria-label="میکروفون روشن" />
                        ) : (
                          <MicOff className="size-3.5 text-red-300" aria-label="میکروفون خاموش" />
                        )}
                        {!p.camOn && <VideoOff className="size-3.5 text-muted-foreground" aria-label="دوربین خاموش" />}
                        {p.handRaised && <Hand className="size-3.5 text-amber-300" aria-label="دست بالا" />}
                        {p.screenSharing && (
                          <span className="text-[10px] text-teal-200">در حال اشتراک صفحه</span>
                        )}
                      </div>
                    </div>
                    {isHost && !isSelfRow && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemovePeer(p.id)}
                        aria-label={`اخراج ${p.name}`}
                        title={`اخراج ${p.name}`}
                        className="size-9 shrink-0 rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-red-500/15 hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <UserX className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </ScrollArea>
          {isHost && (
            <div className="shrink-0 border-t border-white/10 p-3">
              <Button
                type="button"
                onClick={onMuteAll}
                className="h-11 w-full rounded-xl bg-white/10 text-sm font-medium text-teal-100 hover:bg-white/15"
              >
                <MicOff className="size-4" aria-hidden="true" />
                قطع صدای همه
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
