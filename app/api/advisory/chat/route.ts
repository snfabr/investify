import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { llmStream, defaultConfig } from '@/lib/llm'
import { ADVISORY_STAGE_PROMPTS } from '@/lib/llm/prompts'
import { z } from 'zod'
import type { ModelMessage } from 'ai'

const ChatSchema = z.object({
  messages: z.array(z.object({
    role:    z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional().default([]),
  stage:     z.number().int().min(1).max(6),
  profileId: z.string().uuid().optional(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = ChatSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { messages, stage, profileId } = parsed.data

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

  const systemPrompt = ADVISORY_STAGE_PROMPTS[stage]
  if (!systemPrompt) {
    return NextResponse.json({ error: `Invalid stage: ${stage}` }, { status: 400 })
  }

  const coreMessages: ModelMessage[] = messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  // Save the last user message to DB
  const lastUserMsg = [...coreMessages].reverse().find(m => m.role === 'user')
  if (lastUserMsg) {
    await supabase.from('advisory_chat').insert({
      user_id:    user.id,
      profile_id: profileId || null,
      role:       'user',
      content:    typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content),
      stage,
    })
  }

  // Stream the response as UI message stream (data stream format: 0:"text chunk"\n)
  const result = llmStream(config, coreMessages, systemPrompt)

  // Use the text stream and format as simple data stream protocol
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of result.textStream) {
        // Data stream protocol: 0:"escaped text"\n
        controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk)}\n`))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Vercel-AI-Data-Stream': 'v1',
    },
  })
}
