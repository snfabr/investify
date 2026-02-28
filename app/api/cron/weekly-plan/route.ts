import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { llmGenerate, defaultConfig } from '@/lib/llm'
import { WEEKLY_PLAN_SYSTEM_PROMPT } from '@/lib/llm/prompts'
import { buildPlanContext } from '@/lib/plans/context'
import type { ModelMessage } from 'ai'

export async function GET(request: NextRequest) {
  // Validate cron secret
  const authHeader = request.headers.get('authorization')
  const expectedToken = `Bearer ${process.env.CRON_SECRET}`

  if (!authHeader || authHeader !== expectedToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()

  // Get all users (service role bypasses RLS)
  const { data: users, error: usersError } = await supabase
    .from('user_settings')
    .select('user_id, llm_provider, llm_model')

  if (usersError || !users) {
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }

  const monday = new Date()
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const weekOf = monday.toISOString().split('T')[0]

  const results: Array<{ userId: string; status: string }> = []

  for (const userSettings of users) {
    try {
      // Skip if plan already generated this week
      const { data: existing } = await supabase
        .from('weekly_plans')
        .select('id')
        .eq('user_id', userSettings.user_id)
        .eq('week_of', weekOf)
        .single()

      if (existing) {
        results.push({ userId: userSettings.user_id, status: 'skipped_already_exists' })
        continue
      }

      const config = {
        provider: (userSettings.llm_provider || defaultConfig.provider) as typeof defaultConfig.provider,
        model:    userSettings.llm_model || defaultConfig.model,
      }

      const context = await buildPlanContext(userSettings.user_id)

      const messages: ModelMessage[] = [
        {
          role: 'user',
          content: `Please generate a weekly investment plan based on the following context:\n\n${context}\n\nReturn ONLY valid JSON matching the specified schema. No markdown code fences.`,
        },
      ]

      const text = await llmGenerate(config, messages, WEEKLY_PLAN_SYSTEM_PROMPT)
      const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
      const planJson = JSON.parse(cleaned)

      await supabase.from('weekly_plans').insert({
        user_id:      userSettings.user_id,
        week_of:      weekOf,
        plan:         planJson,
        llm_provider: config.provider,
        llm_model:    config.model,
      })

      results.push({ userId: userSettings.user_id, status: 'generated' })
    } catch (err) {
      results.push({ userId: userSettings.user_id, status: `error: ${err instanceof Error ? err.message : 'unknown'}` })
    }
  }

  return NextResponse.json({ weekOf, results })
}
