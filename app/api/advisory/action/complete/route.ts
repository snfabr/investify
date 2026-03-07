import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { llmGenerate, defaultConfig } from '@/lib/llm'
import { ACTION_COMPLETION_PROMPT } from '@/lib/llm/prompts'
import { z } from 'zod'
import type { ModelMessage } from 'ai'

const CompleteSchema = z.object({
  messages: z.array(z.object({
    role:    z.enum(['user', 'assistant']),
    content: z.string(),
  })),
  title: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = CompleteSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { messages, title: providedTitle } = parsed.data

  if (messages.length === 0) {
    return NextResponse.json({ error: 'No messages to summarise' }, { status: 400 })
  }

  // Get user's LLM settings
  const { data: settings } = await supabase
    .from('user_settings')
    .select('llm_provider, llm_model')
    .eq('user_id', user.id)
    .single()

  const config = {
    provider: (settings?.llm_provider || defaultConfig.provider) as typeof defaultConfig.provider,
    model:    settings?.llm_model || defaultConfig.model,
  }

  // Build extraction messages
  const extractionMessages: ModelMessage[] = [
    ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: ACTION_COMPLETION_PROMPT },
  ]

  // Extract structured recommendation
  let recommendation: Record<string, unknown> = {}
  try {
    const raw = await llmGenerate(config, extractionMessages)
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      recommendation = JSON.parse(jsonMatch[0])
    }
  } catch {
    recommendation = { title: 'Advisory Session', objective: 'Portfolio planning session', disclaimer: 'Not financial advice.' }
  }

  // Auto-generate title from first user message if not provided
  let title = providedTitle
  if (!title) {
    if (typeof recommendation.title === 'string' && recommendation.title) {
      title = recommendation.title
    } else {
      const firstUserMsg = messages.find(m => m.role === 'user')
      title = firstUserMsg
        ? firstUserMsg.content.slice(0, 60) + (firstUserMsg.content.length > 60 ? '…' : '')
        : 'Advisory Session'
    }
  }

  const summary = typeof recommendation.objective === 'string' ? recommendation.objective : null
  const now = new Date().toISOString()

  const { data: session, error } = await supabase
    .from('action_sessions')
    .insert({
      user_id:      user.id,
      title,
      summary,
      messages,
      recommendation,
      status:       'completed',
      completed_at: now,
    })
    .select('id, title')
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to save session' }, { status: 500 })
  }

  return NextResponse.json({
    sessionId:      session.id,
    title:          session.title,
    recommendation,
  })
}
