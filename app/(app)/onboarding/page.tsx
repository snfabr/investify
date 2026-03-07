'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { CheckCircle, Circle, Send, Bot, User } from 'lucide-react'
import { toast } from 'sonner'

const STAGES = [
  {
    id: 1,
    title: 'Financial Situation',
    description: "Understand your current financial position — ISA value, monthly budget, emergency fund, and income stability.",
  },
  {
    id: 2,
    title: 'Investment Goals',
    description: "Define what success looks like — your objectives, time horizon, and the role of your ISA.",
  },
  {
    id: 3,
    title: 'Risk Profile',
    description: "Calibrate your true risk tolerance — how you'd react to drawdowns and market crashes.",
  },
  {
    id: 4,
    title: 'Investment Beliefs',
    description: "Capture your philosophy — passive vs active, thematic interests, instruments, and ESG preferences.",
  },
  {
    id: 5,
    title: 'Strategy Construction',
    description: "Build your target portfolio — allocation framework, specific holdings, and rebalancing rules.",
  },
  {
    id: 6,
    title: 'Tactical Framework',
    description: "Define your event response rules — which events trigger alerts and how to respond.",
  },
]

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export default function OnboardingPage() {
  const [currentStage, setCurrentStage] = useState(1)
  const [completedStages, setCompletedStages] = useState<number[]>([])
  // Keep messages per stage so switching tabs doesn't wipe the conversation
  const [stageMessages, setStageMessages] = useState<Record<number, Message[]>>({})
  const [inputValue, setInputValue] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const stage = STAGES.find(s => s.id === currentStage)!
  const messages = useMemo(() => stageMessages[currentStage] ?? [], [stageMessages, currentStage])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [stageMessages, currentStage])

  // Reset input and error on stage switch, but keep messages
  useEffect(() => {
    setInputValue('')
    setError(null)
  }, [currentStage])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    }

    const updatedMessages = [...messages, userMessage]
    setStageMessages(prev => ({ ...prev, [currentStage]: updatedMessages }))
    setInputValue('')
    setIsStreaming(true)
    setError(null)

    const assistantId = `assistant-${Date.now()}`
    setStageMessages(prev => ({
      ...prev,
      [currentStage]: [...updatedMessages, { id: assistantId, role: 'assistant', content: '' }],
    }))

    try {
      abortRef.current = new AbortController()

      const res = await fetch('/api/advisory/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
          stage: currentStage,
          profileId: profileId ?? undefined,
        }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) throw new Error(`Request failed: ${res.status}`)
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let assistantText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (line.startsWith('0:')) {
            try {
              const parsed = JSON.parse(line.slice(2))
              if (typeof parsed === 'string') {
                assistantText += parsed
                setStageMessages(prev => ({
                  ...prev,
                  [currentStage]: prev[currentStage]?.map(m =>
                    m.id === assistantId ? { ...m, content: assistantText } : m
                  ) ?? [],
                }))
              }
            } catch { /* partial chunk */ }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'An error occurred')
        setStageMessages(prev => ({
          ...prev,
          [currentStage]: (prev[currentStage] ?? []).filter(m => m.id !== assistantId),
        }))
      }
    } finally {
      setIsStreaming(false)
    }
  }, [messages, currentStage, isStreaming, profileId])

  async function markStageComplete() {
    const currentMessages = stageMessages[currentStage] ?? []

    if (currentMessages.length === 0) {
      toast.warning(`Have a conversation for Stage ${currentStage} first, then mark it complete.`)
      return
    }

    if (!completedStages.includes(currentStage)) {
      setCompletedStages(prev => [...prev, currentStage])
    }

    setIsSaving(true)
    try {
      const res = await fetch('/api/advisory/stage/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: currentStage,
          messages: currentMessages.map(m => ({ role: m.role, content: m.content })),
          profileId: profileId ?? undefined,
          mode: 'onboarding',
        }),
      })
      const data = res.ok ? await res.json() : null
      if (data?.profileId) setProfileId(data.profileId)
      if (!res.ok) toast.error('Failed to save stage — please try again.')
    } catch {
      toast.error('Failed to save stage — please try again.')
    } finally {
      setIsSaving(false)
    }

    if (currentStage < 6) {
      setCurrentStage(currentStage + 1)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await sendMessage(inputValue)
  }

  const progressPct = (completedStages.length / 6) * 100

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Investment Advisory</h1>
        <p className="text-muted-foreground">Complete all 6 stages to build your personalised investment strategy.</p>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{completedStages.length} of 6 stages complete</span>
          <span>{Math.round(progressPct)}%</span>
        </div>
        <Progress value={progressPct} className="h-2" />
      </div>

      <div className="grid grid-cols-4 gap-6">
        {/* Left panel: stage list */}
        <div className="col-span-1 space-y-2">
          {STAGES.map((s) => {
            const isComplete = completedStages.includes(s.id)
            const isCurrent = s.id === currentStage
            const hasMessages = (stageMessages[s.id]?.length ?? 0) > 0
            return (
              <button
                key={s.id}
                onClick={() => setCurrentStage(s.id)}
                className={`w-full text-left px-3 py-3 rounded-lg text-sm transition-colors ${
                  isCurrent
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isComplete ? (
                    <CheckCircle className="h-4 w-4 flex-shrink-0 text-green-500" />
                  ) : (
                    <Circle className={`h-4 w-4 flex-shrink-0 ${hasMessages && !isCurrent ? 'opacity-70' : 'opacity-50'}`} />
                  )}
                  <span className="font-medium leading-tight">{s.title}</span>
                </div>
              </button>
            )
          })}
        </div>

        {/* Right panel: chat */}
        <div className="col-span-3 flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">
                    Stage {currentStage}: {stage.title}
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs">{stage.description}</CardDescription>
                </div>
                {completedStages.includes(currentStage) ? (
                  <Badge variant="secondary" className="text-green-600">Complete</Badge>
                ) : (
                  <Button size="sm" variant="outline" onClick={markStageComplete} disabled={isSaving || isStreaming}>
                    {isSaving ? 'Saving…' : 'Mark complete'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              {/* Messages */}
              <div className="space-y-3 min-h-64 max-h-[50vh] overflow-y-auto pr-1">
                {messages.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    <Bot className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p>Start the conversation to begin Stage {currentStage}.</p>
                    <p className="text-xs mt-1">Type a message or say &quot;Start&quot; to begin.</p>
                  </div>
                )}
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}
                  >
                    <div className={`h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                      m.role === 'user' ? 'bg-primary' : 'bg-muted'
                    }`}>
                      {m.role === 'user' ? (
                        <User className="h-4 w-4 text-primary-foreground" />
                      ) : (
                        <Bot className="h-4 w-4" />
                      )}
                    </div>
                    <div className={`rounded-lg px-4 py-2.5 text-sm max-w-[80%] ${
                      m.role === 'user'
                        ? 'bg-primary text-primary-foreground ml-auto'
                        : 'bg-muted'
                    }`}>
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {m.content || (isStreaming && m.role === 'assistant' ? '…' : '')}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {error && (
                <div className="mt-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>
              )}

              {/* Input */}
              <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
                <Textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Type your response…"
                  className="min-h-10 resize-none"
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSubmit(e as unknown as React.FormEvent)
                    }
                  }}
                />
                <Button type="submit" size="icon" disabled={isStreaming || !inputValue.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
              <p className="text-xs text-muted-foreground mt-2">
                Press Enter to send · Shift+Enter for new line
              </p>
            </CardContent>
          </Card>

          {/* Navigation */}
          <div className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => setCurrentStage(Math.max(1, currentStage - 1))}
              disabled={currentStage === 1 || isSaving}
            >
              Previous stage
            </Button>
            <Button
              onClick={markStageComplete}
              disabled={(currentStage === 6 && completedStages.includes(6)) || isSaving || isStreaming}
            >
              {isSaving ? 'Saving…' : currentStage === 6 ? 'Finish' : 'Next stage →'}
            </Button>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Investify is a personal planning tool, not regulated financial advice. All investment decisions are your own.
      </p>
    </div>
  )
}
