import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Wrench, BookOpen, LayoutGrid, Plug, Puzzle } from 'lucide-react'
import type { Project } from '@/shared/api/contracts'
import type { TabItem } from '@localixai/kit/tabs'
import { CAPABILITY_TABS, type CapabilityTabId } from '@/shared/routing/routes'
import { SettingsPage } from './SettingsScaffold'
import { CapabilityTabRow } from './capabilities/CapabilityTabRow'
import { AgentSwitcher } from './AgentSwitcher'
import { ToolsSettings } from './ToolsSettings'
import { SkillsSettings } from './SkillsSettings'
import { McpSettings } from './McpSettings'
import { PluginsSettings } from './PluginsSettings'
import { MiniAppsSettings } from './MiniAppsSettings'
import { settingsUiUri } from '@localixai/mini-app-sdk/navigation'
import { useUiTarget } from '@/shared/hooks/useUiTarget'
import { useRulesAgent } from '../model/useRulesAgent'

interface CapabilitiesSettingsProps {
  activeTab: CapabilityTabId
  onTabChange: (tab: CapabilityTabId) => void
  projects: Project[]
  /**
   * The scope to open on: '' = no project, otherwise a project id. Defaults the picker
   * to the user's active project so their PROJECT-scoped capabilities (agents,
   * skills, …) are visible immediately instead of the no-project scope.
   * No project stays selectable.
   */
  defaultScope?: string
}

/** Per-tab presentation (label + icon), keyed by id so the two never drift apart. */
const TAB_META: Record<CapabilityTabId, { label: string; icon: LucideIcon }> = {
  tools: { label: 'Tools', icon: Wrench },
  skills: { label: 'Skills', icon: BookOpen },
  mcp: { label: 'MCP', icon: Plug },
  plugins: { label: 'Plugins', icon: Puzzle },
  'mini-apps': { label: 'Mini apps', icon: LayoutGrid },
}

const TABS: TabItem<CapabilityTabId>[] = CAPABILITY_TABS.map((id) => ({
  id,
  label: TAB_META[id].label,
  icon: TAB_META[id].icon,
}))

/**
 * Unified "Capabilities" page — tools, skills, MCP servers, plugins and the rules.
 *
 * TWO pickers, because the tabs ask two different questions and one control answering
 * both was a lie about how any of it works. A project decides what is INSTALLED and
 * therefore listed; an agent decides what the RULES say. They used to share one string —
 * `''`, a project id, or `agent:<id>` — which made a project look like a permission scope
 * and "No project" look like a third one. Neither is true: rules belong to an agent and
 * to nothing else.
 *
 * Each sub-tab is URL-addressable (/settings/tools, /settings/skills, …).
 */
export function CapabilitiesSettings({
  activeTab,
  onTabChange,
  projects,
  defaultScope,
}: CapabilitiesSettingsProps) {
  // WHERE things are installed: '' = no project, otherwise a project id. Opens on the
  // active project so its skills and plugins are visible without a manual flip.
  const [project, setProject] = useState(defaultScope ?? '')
  const targetRef = useUiTarget<HTMLDivElement>(settingsUiUri(activeTab, { scope: project }))

  useEffect(() => {
    setProject(defaultScope ?? '')
  }, [defaultScope])

  const { agents: pickableAgents, agentId, agentScope, pick } = useRulesAgent(project)

  return (
    <div ref={targetRef} tabIndex={-1} className="outline-none">
      {/* Both pickers ride the HEADER row, not the tab strip below it — the same control
          answers the same question on the Agents tab, and putting it on a different row
          made it jump as you moved between the two. Page-level state, so a choice survives
          switching sub-tabs. */}
      <SettingsPage
        title="Capabilities"
        description="Everything the agent can do — built-in tools, skills, MCP servers, plugins and mini apps."
        actions={
          // Unconditional, and it picks an AGENT. Every switch on every tab here writes a
          // RULE — `tool:bash`, `skill:deploy`, `plugin:office`, `mcp:github/create_pr` are
          // one vocabulary — and a rule belongs to an agent. Showing the picker on only two
          // tabs said the other three were about something else; they are not, and their
          // switches were quietly landing on the default assistant.
          //
          // There is no project picker: the lists show everything visible from here, and
          // where a NEW artifact is installed is stated by the form that installs it.
          <AgentSwitcher agents={pickableAgents} agentId={agentId} onChange={pick} />
        }
        tabs={
          <CapabilityTabRow
            aria-label="Capability categories"
            items={TABS}
            active={activeTab}
            onChange={onTabChange}
          />
        }
      >
        {activeTab === 'tools' && <ToolsSettings scope={agentScope} projects={projects} />}
        {activeTab === 'skills' && (
          <SkillsSettings scope={project} agentScope={agentScope} projects={projects} />
        )}
        {activeTab === 'mcp' && (
          <McpSettings scope={project} agentScope={agentScope} projects={projects} />
        )}
        {activeTab === 'plugins' && (
          <PluginsSettings scope={project} agentScope={agentScope} projects={projects} />
        )}
        {activeTab === 'mini-apps' && (
          <MiniAppsSettings scope={project} agentScope={agentScope} projects={projects} />
        )}
      </SettingsPage>
    </div>
  )
}
