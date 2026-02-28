import { generateText, streamText, type ModelMessage } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { google } from '@ai-sdk/google'

export type LLMProvider = 'anthropic' | 'openai' | 'google'

export interface LLMConfig {
  provider: LLMProvider
  model: string
  apiKey?: string  // user's own key; falls back to env var
}

export const defaultConfig: LLMConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
}

function getModel(config: LLMConfig) {
  // @ai-sdk/* reads API key from env var if not explicitly set
  switch (config.provider) {
    case 'anthropic':
      return anthropic(config.model)
    case 'openai':
      return openai(config.model)
    case 'google':
      return google(config.model)
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`)
  }
}

export async function llmGenerate(
  config: LLMConfig,
  messages: ModelMessage[],
  system?: string
): Promise<string> {
  const { text } = await generateText({
    model: getModel(config),
    messages,
    system,
  })
  return text
}

export function llmStream(
  config: LLMConfig,
  messages: ModelMessage[],
  system?: string
) {
  return streamText({
    model: getModel(config),
    messages,
    system,
  })
}
