import { Bot } from 'lucide-react'
import {
  ClaudeMark,
  CodexMark,
  GeminiMark,
  CopilotMark,
  OpenCodeMark,
  HermesMark,
} from '@localixai/kit/coding-agent-marks'

const agents = {
  'claude-code': { Icon: ClaudeMark, label: 'Claude Code' },
  codex: { Icon: CodexMark, label: 'Codex' },
  'gemini-cli': { Icon: GeminiMark, label: 'Gemini CLI' },
  'github-copilot': { Icon: CopilotMark, label: 'GitHub Copilot' },
  opencode: { Icon: OpenCodeMark, label: 'OpenCode' },
  hermes: { Icon: HermesMark, label: 'Hermes' },
}

export function externalAgentPresentation(provider: string) {
  return agents[provider as keyof typeof agents] ?? { Icon: Bot, label: provider }
}
