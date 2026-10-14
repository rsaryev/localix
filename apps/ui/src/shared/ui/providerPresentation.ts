import { Bot } from 'lucide-react'
import {
  ClaudeMark,
  CodexMark,
  GeminiMark,
  CopilotMark,
  OpenCodeMark,
} from '@localixai/kit/coding-agent-marks'

/** Reuse the same brand marks as external agents for provider connections. */
export function providerIcon(providerId: string | undefined) {
  switch (providerId) {
    case 'openai':
    case 'openai-codex':
      return CodexMark
    case 'anthropic':
    case 'claude-code':
      return ClaudeMark
    case 'google':
    case 'google-gemini':
    case 'gemini-cli':
      return GeminiMark
    case 'github-copilot':
      return CopilotMark
    case 'opencode':
      return OpenCodeMark
    default:
      return Bot
  }
}
