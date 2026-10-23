import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { monogramIcon } from '@localixai/kit/avatar'
import { HeaderPickMenu } from './HeaderPickMenu'

/** Stable empty default — a literal here would be a new array on every render. */
const NO_AGENTS: ReadonlyArray<{ id: string; label: string }> = []

interface AgentSwitcherProps {
  agents?: ReadonlyArray<{ id: string; label: string }>
  /** Agent id, or `''` for the one that always exists. */
  agentId: string
  onChange: (agentId: string) => void
}

/**
 * WHOSE rules — the agent the tools tab and the rules tab read and write.
 *
 * The only picker on the page, and it picks an agent. A project used to sit in the same
 * dropdown, which said a project was a permission scope; it never was, and the lists below
 * no longer filter by one either.
 *
 * There is no synthetic "Default assistant" row. That named the same agent the list already
 * contained — `localix` — so the picker offered one role twice and neither entry said they
 * were the same thing. The default is a PROPERTY of a real row, marked on it as its `hint`
 * rather than glued into its name. Each agent is drawn as its monogram, the way a reply's
 * author is, so the same agent looks the same here as in the transcript.
 *
 * `''` still means "none named", which the server answers for with that same agent; the
 * picker resolves it to the row so the selection is never blank.
 */
export function AgentSwitcher({ agents = NO_AGENTS, agentId, onChange }: AgentSwitcherProps) {
  const value = agentId || DEFAULT_AGENT_ID
  const current = agents.find((agent) => agent.id === value)
  const entries: MenuEntry[] = agents.map((agent) => ({
    id: agent.id,
    label: agent.label,
    icon: monogramIcon(agent.id, agent.label),
    hint: agent.id === DEFAULT_AGENT_ID ? 'default' : undefined,
    selected: agent.id === value,
    onSelect: () => {
      if (agent.id !== value) onChange(agent.id)
    },
  }))
  const text = current?.label ?? value
  return (
    <HeaderPickMenu
      label="Agent whose rules to edit"
      icon={monogramIcon(value, text)}
      text={text}
      entries={entries}
    />
  )
}
