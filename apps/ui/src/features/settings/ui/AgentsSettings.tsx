import { useAgents } from '../model/useAgents'
import type { Project } from '@/shared/api/contracts'
import { Button } from '@localixai/kit/button'
import { SettingProblems } from './settingRegistry'
import { SettingsPageHeader } from './SettingsScaffold'
import { CapabilityRegistryBody } from './capabilities/CapabilityRegistryBody'
import { AgentRow } from './capabilities/AgentRow'
import { ProjectSwitcher } from './ScopeSwitcher'
import { openAgentProfile, openNewAgentProfile } from '../model/agentProfileTab'

interface AgentsSettingsProps {
  /** '' = global; otherwise a project id. Where a record is STORED, not what it may use. */
  scope: string
  projects: Project[]
  onScopeChange: (scope: string) => void
}

/**
 * Settings → Agents: the reusable-agent registry — the LIST, and nothing else.
 *
 * One record is not edited here. Its profile is a workspace tab of its own
 * (`agent-profile/AgentProfileTab`), because the same page is reached from a mention in a
 * message, a reply's author line and a chat group's heading — and a surface three other screens
 * link INTO cannot be a dialog that only exists while this list is on screen. What stays here is
 * what a list answers: who exists, in which scope, and which of them are switched on.
 *
 * The split is the other half of the one this page already made. This page owns what an agent
 * IS; `capability_rule` owns what it MAY use, beside the installation's and the project's.
 */
export function AgentsSettings({ scope, projects, onScopeChange }: AgentsSettingsProps) {
  const { agents, loading, error, busy, busyLabel, refresh, toggle } = useAgents(scope)

  return (
    <div className="w-full">
      <SettingsPageHeader
        title="Agents"
        description="Who you can talk to, and who a run can delegate to."
        className="mb-5 border-b border-border-faint pb-4"
        actions={
          <>
            <ProjectSwitcher projects={projects} project={scope} onChange={onScopeChange} />
            <Button variant="mono" onClick={() => openNewAgentProfile(scope)}>
              New agent
            </Button>
          </>
        }
      />

      <SettingProblems
        className="mb-3"
        subject="Agents"
        errors={error ? [error] : []}
        onRetry={refresh}
      />

      <CapabilityRegistryBody
        count={agents.length}
        loading={loading}
        error={error}
        empty={
          <>No agents here yet. Create one with New agent, or import them from another AI agent.</>
        }
      >
        {agents.map((a) => (
          <AgentRow
            key={`${a.projectId}:${a.record.id}`}
            agent={a}
            projects={projects}
            busyLabel={busy === a.record.id ? (busyLabel ?? undefined) : undefined}
            actionsDisabled={busy === a.record.id}
            onToggle={() => void toggle(a)}
            onOpen={() =>
              openAgentProfile(a.record.id, a.projectId, a.record.label || a.record.handle)
            }
          />
        ))}
      </CapabilityRegistryBody>
    </div>
  )
}
