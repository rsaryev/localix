import type { LucideIcon } from 'lucide-react'
import { Wrench, BookOpen, Plug, Puzzle, ShieldCheck, IdCard } from 'lucide-react'
import type { Project } from '@/shared/api/contracts'
import type { TabItem } from '@localixai/kit/tabs'
import { CAPABILITY_TABS, type CapabilityTabId } from '@/shared/routing/routes'
import { agentScopeValue } from '@/shared/api/capabilityScope'
import { ToolsSettings } from '../ToolsSettings'
import { SkillsSettings } from '../SkillsSettings'
import { McpSettings } from '../McpSettings'
import { PluginsSettings } from '../PluginsSettings'
import { PermissionRulesView } from '../capabilities/PermissionRulesView'

/** The profile's first tab is the record itself; the rest are what it may use. */
export type AgentProfileTabId = 'definition' | CapabilityTabId

const TAB_META: Record<AgentProfileTabId, { label: string; icon: LucideIcon }> = {
  definition: { label: 'Definition', icon: IdCard },
  tools: { label: 'Tools', icon: Wrench },
  skills: { label: 'Skills', icon: BookOpen },
  mcp: { label: 'MCP', icon: Plug },
  plugins: { label: 'Plugins', icon: Puzzle },
  rules: { label: 'Permission rules', icon: ShieldCheck },
}

export const AGENT_PROFILE_TABS: TabItem<AgentProfileTabId>[] = (
  ['definition', ...CAPABILITY_TABS] as const
).map((id) => ({ id, label: TAB_META[id].label, icon: TAB_META[id].icon }))

/**
 * What this agent may use — the Capabilities registries, on the agent's own page.
 *
 * Identical to the Capabilities screen in everything but ONE thing: there is no picker. That
 * page has to ask whose rules a switch writes, and answers the default assistant when nobody
 * says; here the page IS the answer, so the question cannot be got wrong and the row it used to
 * occupy is given back to the lists.
 *
 * The two scopes are still two questions, and they are answered from the record rather than by
 * the reader. A project decides what is INSTALLED and therefore listed, so the lists take the
 * project the record lives in. An agent decides what the RULES say, so every switch writes
 * `agent:<id>` — the composition with the installation's and the project's ceilings is the
 * server's, and it takes the strictest verdict, which is why a switch here can never widen
 * anything.
 */
export function AgentCapabilityPanel({
  tab,
  agentId,
  projectId,
  projects,
}: {
  tab: CapabilityTabId
  agentId: string
  /** '' = the global registry; otherwise the project the record lives in. */
  projectId: string
  projects: Project[]
}) {
  const agentScope = agentScopeValue(agentId)

  switch (tab) {
    case 'tools':
      return <ToolsSettings scope={agentScope} projects={projects} />
    case 'skills':
      return <SkillsSettings scope={projectId} agentScope={agentScope} projects={projects} />
    case 'mcp':
      return <McpSettings scope={projectId} agentScope={agentScope} projects={projects} />
    case 'plugins':
      return <PluginsSettings scope={projectId} agentScope={agentScope} projects={projects} />
    case 'rules':
      // Keyed on the agent so no staged edit survives a switch from one profile to another.
      return <PermissionRulesView key={agentScope} scope={agentScope} />
  }
}
