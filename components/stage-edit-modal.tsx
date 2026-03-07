'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Send, Bot, User, Loader2 } from 'lucide-react'

// The synthetic first-user-turn we use so Claude always sees messages starting with 'user'
const SYNTHETIC_OPENER = 'Please review my configuration.'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface StageEditModalProps {
  stageId: number
  stageTitle: string
  profileId: string
  existingData: Record<string, unknown>
  fullProfileContext?: Record<string, unknown>
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
}

export function StageEditModal({
  stageId,
  stageTitle,
  profileId,
  existingData,
  fullProfileContext,
  isOpen,
  onClose,
  onSaved,
}: StageEditModalProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const didAutoStart = useRef(false)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (isOpen) {
      setMessages([])
      setInputValue('')
      setError(null)
      didAutoStart.current = false
    } else {
      abortRef.current?.abort()
    }
  }, [isOpen])

  /**
   * Build the messages array to send to the chat API.
   * In edit mode, Claude requires messages to start with role:'user'.
   * The auto-start sends messages=[] and the API adds a synthetic opener server-side.
   * For all subsequent calls, we prepend that same synthetic opener here on the client
   * so the full history is [user:synthetic, assistant:summary, user:real, assistant:reply, ...].
   */
  function buildApiMessages(
    visibleMessages: Message[],
  ): { role: 'user' | 'assistant'; content: string }[] {
    if (visibleMessages.length === 0) {
      // Auto-start: send empty so the server adds the synthetic opener
      return []
    }
    return [
      { role: 'user', content: SYNTHETIC_OPENER },
      ...visibleMessages.map(m => ({ role: m.role, content: m.content })),
    ]
  }

  const streamResponse = useCallback(async (
    apiMessages: { role: 'user' | 'assistant'; content: string }[],
  ) => {
    setIsStreaming(true)
    setError(null)

    const assistantId = `assistant-${Date.now()}`
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    try {
      abortRef.current = new AbortController()

      const res = await fetch('/api/advisory/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          stage: stageId,
          profileId,
          mode: 'edit',
          stageContext: JSON.stringify(existingData),
          fullProfileContext: fullProfileContext ? JSON.stringify(fullProfileContext) : undefined,
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
  }, [stageId, profileId, existingData])

  // Auto-start: send empty messages so the server adds the synthetic opener
  useEffect(() => {
    if (isOpen && !didAutoStart.current && !isStreaming) {
      didAutoStart.current = true
      streamResponse([])
    }
  }, [isOpen, isStreaming, streamResponse])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    }

    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setInputValue('')

    // Prepend synthetic opener so message array always starts with 'user'
    await streamResponse(buildApiMessages(updatedMessages))
  }, [messages, isStreaming, streamResponse])

  async function handleSave() {
    setIsSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/advisory/stage/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: stageId,
          // Prepend synthetic opener so extraction LLM sees valid message order
          messages: buildApiMessages(messages),
          profileId,
          mode: 'edit',
          // Pass existing data so save route can merge (not null-out) unchanged fields
          stageContext: JSON.stringify(existingData),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error || `Save failed: ${res.status}`)
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    sendMessage(inputValue)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-4xl w-[95vw] h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Edit Stage {stageId}: {stageTitle}</DialogTitle>
        </DialogHeader>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Reviewing your configuration…
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
          <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded flex-shrink-0">{error}</div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="flex gap-2 flex-shrink-0">
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

        <DialogFooter className="flex-shrink-0">
          <p className="text-xs text-muted-foreground mr-auto">
            When done, click Save to update your strategy profile.
          </p>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || isStreaming || messages.length === 0}>
            {isSaving ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</>
            ) : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
