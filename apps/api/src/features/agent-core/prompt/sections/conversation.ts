import {
  BOARD_OWNER,
  HUMAN_ASK_CONTROL,
  HUMAN_BOARD_CONTROL,
  HUMAN_NO_ASK_CONTROL,
} from './turn-contract'
import type { BuildAgentSystemPromptParams } from '../contracts'

/** `# Conversation turn control` — how a turn with the person is run. */
export function buildTurnControlSection(input: {
  /** The run holds a task board tool; board rules render only then. */
  hasBoard?: boolean
  /** The run holds `ask`. */
  canAsk?: boolean
}): string {
  const board = (line: string) => (input.hasBoard ? [line] : [])
  return [
    '# Conversation turn control',
    input.canAsk ? HUMAN_ASK_CONTROL : HUMAN_NO_ASK_CONTROL,
    ...board(HUMAN_BOARD_CONTROL),
    ...board(BOARD_OWNER),
  ].join('\n')
}

/**
 * `# Agent directory` — the agents `Agent` can start as a subagent with `subagent_type: "<name>"`.
 * It is the only listing of the registry the model gets, and the only place the agents `Agent` can
 * start are named: your `.claude/agents` files, the enabled plugins' agents and the built-in
 * Explore and Plan. The host passes only agents `Agent` can hand a task to.
 */
export function buildAgentDirectorySection(
  agents: NonNullable<BuildAgentSystemPromptParams['agentDirectory']>,
  opts: { canDelegate: boolean },
): string | null {
  if (!opts.canDelegate || agents.length === 0) return null
  return [
    '# Agent directory',
    'Agents `Agent` can start as `subagent_type: "<name>"` are marked subagent. Each runs with its own instructions, tools and model and sees only its prompt; `general-purpose` is yourself.',
    ...agents.map((agent) => {
      const mark = agent.self ? 'subagent, yourself' : 'subagent'
      const tools = agent.tools ? ` (tools: ${agent.tools.join(', ')})` : ''
      return `- ${agent.name} (${mark})${agent.description ? `: ${agent.description}` : ''}${tools}`
    }),
  ].join('\n')
}
