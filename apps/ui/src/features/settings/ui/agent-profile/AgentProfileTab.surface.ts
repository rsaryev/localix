import { Bot } from 'lucide-react'
import { defineUiLocation } from '@localixai/plugin-sdk/ui'
import { pluginContribSnapshot } from '@/shared/contrib/enabledPlugins'
import { resolveAuthorIdentity } from '@/shared/contrib/useAgentIdentity'
import {
  AGENT_PROFILE_WORK_KIND,
  agentProfileTabId,
  type AgentProfilePayload,
} from '../../model/agentProfileTab'

/**
 * One agent's profile, addressed by the record's own id.
 *
 * Every click that means "show me this agent" — a mention chip, a transcript's author line, a
 * chat group's heading, the registry row — resolves THROUGH here, so all of them open the same
 * tab and the agent's own UI navigation reaches it on the same terms. The alternative, each
 * caller reaching for the inspector bus itself, is how one of them ends up with a different tab
 * id and a second tab for the same record.
 *
 * The title is read from the active capability document rather than passed in: a URI carries an
 * id, and the name beside it is whatever the registry says NOW. An agent the document does not
 * know still opens — the profile loads the record itself — under its id.
 */
export default defineUiLocation({
  id: 'agent.profile.open',
  uri: 'localix://ui/work-item/agent',
  title: 'Agent profile',
  description: 'Open an agent’s profile — who it is, what it runs on, and what it may use.',
  agent: {
    description: 'Open the profile of one agent, by the id its record carries.',
  },
  keywords: ['agent', 'profile', 'persona', 'role', 'assistant'],
  group: 'Application',
  Icon: Bot,
  effect: 'read',
  surface: 'work-item',
  params: {
    // Lowercase by the URI grammar — see `UI_LOCATION_PARAM_KEY`.
    agent: {
      type: 'string',
      description: 'The agent record id, as the registry lists it.',
      maxLength: 256,
    },
    scope: {
      type: 'string',
      description: 'The project the record lives in; omit it for the global registry.',
      optional: true,
      allowEmpty: true,
      maxLength: 256,
    },
  },
  exposure: { search: false },
  present: ({ agent, scope }) => ({
    label: `Open ${identityOf(agent, scope).name}`,
  }),
  resolve: ({ agent, scope }) => {
    const identity = identityOf(agent, scope)
    return {
      kind: 'work-item',
      workKind: AGENT_PROFILE_WORK_KIND,
      id: agentProfileTabId(agent, identity.scope),
      title: identity.name,
      payload: { agentId: agent, projectId: identity.scope } satisfies AgentProfilePayload,
    }
  },
})

/**
 * What this agent is called, and which scope its record lives in.
 *
 * A caller that knows the scope wins: it may be naming a project agent from a document loaded
 * for another scope, where the lookup below would answer the global registry's `''` and open a
 * profile of a record that is not there.
 */
function identityOf(agentId: string, scope?: string) {
  const identity = resolveAuthorIdentity(
    agentId,
    undefined,
    pluginContribSnapshot().document?.agents ?? [],
  )
  return scope === undefined ? identity : { ...identity, scope }
}
