import { useRulesAgent } from '../../model/useRulesAgent'
import { AgentSwitcher } from '../AgentSwitcher'
import { SettingsPage, SettingsSection } from '../SettingsScaffold'
import { ClaudeCodeRulesSection } from './ClaudeCodeRulesSection'
import { PermissionRulesView } from './PermissionRulesView'

/**
 * Settings → Permissions: what agents may do.
 *
 * A rule list belongs to one agent and nothing else (there is no global list and no chain), so
 * the page asks whose list to edit; it opens on the agent of the chat you came from. Rules the
 * person already keeps in Claude Code's settings files apply to every agent on top of it and are
 * shown read-only below.
 */
export function PermissionsSettings({ projectId }: { projectId: string }) {
  const { agents, agentId, agentScope, pick } = useRulesAgent(projectId)
  return (
    <SettingsPage
      title="Permissions"
      description="Decide what each agent may do on your computer: allow, ask or deny."
      actions={<AgentSwitcher agents={agents} agentId={agentId} onChange={pick} />}
    >
      {/* Keyed on the agent so no staged edit survives a switch from one role to another. */}
      <PermissionRulesView key={agentScope} scope={agentScope} />
      <ClaudeCodeRulesSection projectId={projectId} />
      <SettingsSection
        title="How rules combine"
        description="Within an agent's list the last matching rule wins, so write an exception after the rule it excepts. Your Claude Code settings apply to every agent on top of that list and can only tighten it: a deny in any file refuses the call, an ask turns an allow into a question, and among those files a deny beats an ask beats an allow, whatever their order."
      />
    </SettingsPage>
  )
}
