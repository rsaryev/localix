import type { IconComponent } from '@localixai/plugin-sdk/ui'
import { ClaudeMark, CodexMark, CopilotMark, GeminiMark, HermesMark, OpencodeMark } from '../marks'

/** Provider identities in the roster, resource tree and reference menu. */
export const AGENT_MARKS: Readonly<Record<string, IconComponent>> = {
  'claude-code': ClaudeMark,
  codex: CodexMark,
  opencode: OpencodeMark,
  'gemini-cli': GeminiMark,
  'github-copilot': CopilotMark,
  hermes: HermesMark,
}
