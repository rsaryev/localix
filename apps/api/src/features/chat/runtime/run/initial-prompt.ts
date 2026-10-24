import type { RuntimeSection } from '../../../agent-core/prompt/runtime-sections'
import type { PersistedMessage } from '../../contracts'

/**
 * A main session agent's `initialPrompt` (a plugin's `settings.json` `agent`): Claude Code submits
 * it as the first user turn, "prepended to any user-provided prompt". Localix hands it to the
 * chat's first turn as that turn's leading instruction; later turns do not carry it.
 */
export function initialPromptSection(
  mainAgent: { initialPrompt?: string } | null | undefined,
  history: readonly PersistedMessage[],
): RuntimeSection | null {
  const text = mainAgent?.initialPrompt?.trim()
  if (!text) return null
  const turns = history.filter((m) => m.payload.role === 'user' && !m.payload.isInternal).length
  if (turns !== 1) return null
  return {
    key: 'initial-prompt',
    scope: 'turn',
    text: `# Initial prompt\nThe agent this chat runs as begins with this, before the person's message:\n\n${text}`,
  }
}
