'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Send, Bot, User, Loader2, CheckCircle, Printer, ChevronDown, ChevronUp } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface RecommendedAction {
  action: string
  symbol?: string | null
  rationale: string
  amount_gbp?: number | null
}

interface Recommendation {
  title?: string
  objective?: string
  analysis?: string
  recommended_actions?: RecommendedAction[]
  risks?: string
  next_steps?: string
  disclaimer?: string
}

interface SessionResult {
  sessionId: string
  title: string
  recommendation: Recommendation
}

interface PreviousSession {
  id: string
  created_at: string
  completed_at: string | null
  title: string
  summary: string | null
  recommendation: Record<string, unknown> | null
}

export function ActionView({ previousSessions = [] }: { previousSessions?: PreviousSession[] }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null)
  const [expandedSession, setExpandedSession] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const didAutoStart = useRef(false)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const streamResponse = useCallback(async (
    messagesForApi: { role: 'user' | 'assistant'; content: string }[],
  ) => {
    setIsStreaming(true)
    setError(null)

    const assistantId = `assistant-${Date.now()}`
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    try {
      abortRef.current = new AbortController()

      const res = await fetch('/api/advisory/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesForApi }),
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
                setMessages(prev =>
                  prev.map(m => m.id === assistantId ? { ...m, content: assistantText } : m)
                )
              }
            } catch { /* partial chunk */ }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'An error occurred')
        setMessages(prev => prev.filter(m => m.id !== assistantId))
      }
    } finally {
      setIsStreaming(false)
    }
  }, [])

  // Auto-start greeting on mount
  useEffect(() => {
    if (!didAutoStart.current) {
      didAutoStart.current = true
      streamResponse([])
    }
  }, [streamResponse])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming || sessionResult) return

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    }

    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setInputValue('')

    await streamResponse(
      updatedMessages.map(m => ({ role: m.role, content: m.content }))
    )
  }, [messages, isStreaming, sessionResult, streamResponse])

  async function handleComplete() {
    setIsCompleting(true)
    setError(null)
    try {
      const res = await fetch('/api/advisory/action/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error || `Failed: ${res.status}`)
      }
      const result = await res.json() as SessionResult
      setSessionResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete session')
    } finally {
      setIsCompleting(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    sendMessage(inputValue)
  }

  const exchangeCount = messages.filter(m => m.role === 'user').length
  const canComplete = !isStreaming && !sessionResult && exchangeCount >= 2

  return (
    <>
      <style>{`
        @media print {
          aside, nav, header, [data-print-hide] { display: none !important; }
          .print-recommendation { display: block !important; }
          body, html { background: white !important; }
        }
      `}</style>

      <div className="space-y-6">
        <div data-print-hide>
          <h1 className="text-2xl font-bold">Action Advisor</h1>
          <p className="text-muted-foreground">
            Your advisor has full knowledge of your strategy and portfolio. Describe what you want to do.
          </p>
        </div>

        {/* Chat area */}
        {!sessionResult && (
          <div className="flex flex-col h-[60vh]" data-print-hide>
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0 pb-4">
              {messages.length === 0 && (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Starting session…
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                    m.role === 'user' ? 'bg-primary' : 'bg-muted'
                  }`}>
                    {m.role === 'user'
                      ? <User className="h-4 w-4 text-primary-foreground" />
                      : <Bot className="h-4 w-4" />
                    }
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
              <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded mb-2">{error}</div>
            )}

            <form onSubmit={handleSubmit} className="flex gap-2">
              <Textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Describe the action you want to plan…"
                className="min-h-10 resize-none"
                rows={2}
                disabled={!!sessionResult}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSubmit(e as unknown as React.FormEvent)
                  }
                }}
              />
              <div className="flex flex-col gap-2">
                <Button type="submit" size="icon" disabled={isStreaming || !inputValue.trim() || !!sessionResult}>
                  <Send className="h-4 w-4" />
                </Button>
                {canComplete && (
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    title="Complete session & generate recommendation"
                    onClick={handleComplete}
                    disabled={isCompleting}
                  >
                    {isCompleting
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <CheckCircle className="h-4 w-4" />
                    }
                  </Button>
                )}
              </div>
            </form>

            {canComplete && (
              <p className="text-xs text-muted-foreground mt-2">
                Click <CheckCircle className="h-3 w-3 inline" /> to complete this session and generate a structured recommendation.
              </p>
            )}
          </div>
        )}

        {/* Recommendation panel */}
        {sessionResult && (
          <div className="space-y-4">
            <div className="flex items-center justify-between" data-print-hide>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span className="font-medium">Session complete — recommendation generated</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-2" />
                Print / Save PDF
              </Button>
            </div>

            <div className="print:block print-recommendation">
              <div className="mb-4 print:mb-6">
                <h2 className="text-xl font-bold">{sessionResult.title}</h2>
                {sessionResult.recommendation.objective && (
                  <p className="text-muted-foreground mt-1">{sessionResult.recommendation.objective}</p>
                )}
              </div>

              {sessionResult.recommendation.analysis && (
                <Card className="mb-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Analysis</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{sessionResult.recommendation.analysis}</p>
                  </CardContent>
                </Card>
              )}

              {(sessionResult.recommendation.recommended_actions || []).length > 0 && (
                <Card className="mb-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Recommended Actions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 font-medium">Action</th>
                            <th className="text-left py-2 font-medium">Symbol</th>
                            <th className="text-left py-2 font-medium">Rationale</th>
                            <th className="text-right py-2 font-medium">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(sessionResult.recommendation.recommended_actions || []).map((a, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-2">
                                <Badge variant="outline" className="capitalize">{a.action}</Badge>
                              </td>
                              <td className="py-2 font-mono text-xs">{a.symbol || '—'}</td>
                              <td className="py-2">{a.rationale}</td>
                              <td className="py-2 text-right">
                                {a.amount_gbp
                                  ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(a.amount_gbp)
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {sessionResult.recommendation.risks && (
                <Card className="mb-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Risks</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{sessionResult.recommendation.risks}</p>
                  </CardContent>
                </Card>
              )}

              {sessionResult.recommendation.next_steps && (
                <Card className="mb-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Next Steps</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{sessionResult.recommendation.next_steps}</p>
                  </CardContent>
                </Card>
              )}

              {sessionResult.recommendation.disclaimer && (
                <p className="text-xs text-muted-foreground border-t pt-3 mt-4">
                  {sessionResult.recommendation.disclaimer}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Previous Sessions */}
      {previousSessions.length > 0 && (
        <div data-print-hide className="mt-8">
          <h2 className="text-lg font-semibold mb-3">Previous Sessions</h2>
          <div className="space-y-2">
            {previousSessions.map((session) => {
              const rec = session.recommendation as Recommendation | null
              const isExpanded = expandedSession === session.id
              const fmtGbp = (v: number) =>
                new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(v)
              return (
                <div key={session.id} className="border rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                    onClick={() => setExpandedSession(isExpanded ? null : session.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{session.title}</p>
                      {session.summary && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{session.summary}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {new Date(session.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </button>
                  {isExpanded && rec && (
                    <div className="px-4 pb-4 border-t bg-muted/10 space-y-3">
                      {rec.analysis && (
                        <div className="pt-3">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Analysis</p>
                          <p className="text-sm">{String(rec.analysis)}</p>
                        </div>
                      )}
                      {Array.isArray(rec.recommended_actions) && rec.recommended_actions.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Recommended Actions</p>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left py-1 font-medium">Action</th>
                                <th className="text-left py-1 font-medium">Symbol</th>
                                <th className="text-left py-1 font-medium">Rationale</th>
                                <th className="text-right py-1 font-medium">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(rec.recommended_actions as RecommendedAction[]).map((a, i) => (
                                <tr key={i} className="border-b last:border-0">
                                  <td className="py-1">
                                    <Badge variant="outline" className="capitalize text-xs">{a.action}</Badge>
                                  </td>
                                  <td className="py-1 font-mono">{a.symbol || '—'}</td>
                                  <td className="py-1">{a.rationale}</td>
                                  <td className="py-1 text-right tabular-nums">
                                    {a.amount_gbp ? fmtGbp(a.amount_gbp) : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {rec.risks && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Risks</p>
                          <p className="text-sm">{String(rec.risks)}</p>
                        </div>
                      )}
                      {rec.next_steps && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Next Steps</p>
                          <p className="text-sm">{String(rec.next_steps)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
