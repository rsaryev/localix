import type {
  ActionResult,
  ConfigValue,
  CreateForm,
  ListingConfig,
  ListingRef,
  Scope,
  StoreActor,
  StoreProvider,
} from '@localixai/store'

import { ConflictError, InvalidRequestError, NotFoundError } from '../../lib/domain-errors'
import type { AgentModelChoicesPort } from './model-choices-port'
import type { AgentSummary } from './contracts'
import type { AgentsService } from './service-contract'
import {
  DESCRIPTION_FIELD,
  NAME_FIELD,
  agentConfig,
  agentDetail,
  agentListing,
  choiceFromValues,
  inputFromValues,
  scopeOf,
} from './store-listing'

export type AgentStoreDeps = {
  agents: Pick<
    AgentsService,
    | 'listAgents'
    | 'createAgent'
    | 'updateAgent'
    | 'deleteAgent'
    | 'duplicateAgent'
    | 'moveAgent'
    | 'setAgentEnabled'
  >
  /** How many chats an agent is used by. */
  chatsOf?(agentId: string): Promise<number>
  /** The version of an agent file as it is now: a save made over an older one is refused. */
  revisionOf?(path: string): Promise<string>
  /** The person's model choices for agents, kept in their settings (`agentSettings`). */
  choices?: AgentModelChoicesPort
  /** Hear a change to the agents (a file, a switch, a plugin); returns the unsubscribe. */
  onChange(listener: () => void): () => void
}

const PLACEHOLDER_BODY = 'Describe what this agent does and how it works.'

/** A copy's name: a plugin's `plugin:name` becomes `plugin-name`, then a free `-copy` suffix. */
const copyName = (name: string, taken: ReadonlySet<string>) => {
  const base = name.replace(/[^A-Za-z0-9_-]/g, '-')
  for (let n = 0; ; n++) {
    const name = `${base}-copy${n ? `-${n + 1}` : ''}`
    if (!taken.has(name)) return name
  }
}

/**
 * AGENTS AS A STORE PROVIDER (`docs/internals/agents-claude-code.md`, "Agents in the Store"). The
 * listings are the catalog: the person's files, the open project's, managed files, plugins' agents
 * and the shipped types. Nothing is fetched or installed; an agent is written, copied, switched
 * and deleted, and each goes through the agents service, whose watcher is the one reader of files.
 */
export function createAgentStoreProvider(deps: AgentStoreDeps): StoreProvider {
  const { agents } = deps

  const scopeList = (userId: string, projectId: string) =>
    agents.listAgents(userId, { projectId: projectId || null })

  /** Everything an actor sees: the person's catalog, and the open project's own files. */
  async function visible(actor: StoreActor): Promise<AgentSummary[]> {
    const own = await scopeList(actor.userId, '')
    if (!actor.projectId) return own
    const project = await scopeList(actor.userId, actor.projectId)
    const seen = new Set(own.map((agent) => agent.record.id))
    return [...own, ...project.filter((agent) => !seen.has(agent.record.id))]
  }

  async function find(id: string, actor: StoreActor): Promise<AgentSummary> {
    const found = (await visible(actor)).find((agent) => agent.record.id === id)
    if (!found) throw new NotFoundError('agent_store_not_found', `No agent "${id}"`)
    return found
  }

  const editable = async (id: string, actor: StoreActor) => {
    const found = await find(id, actor)
    if (!found.editable)
      throw new InvalidRequestError(
        'agent_not_editable',
        'This agent comes from elsewhere. Copy it to Yours to change it.',
      )
    return found
  }

  /** Duplicate and copy work on any agent; a move only on a file the person owns. */
  const editableOrAny = (id: string, actor: StoreActor, action: string) =>
    action === 'move' ? editable(id, actor) : find(id, actor)

  return {
    kind: 'agent',

    async listings(actor) {
      const list = await scopeList(actor.userId, '')
      return { listings: list.map(agentListing), problems: [] }
    },

    async projectListings(actor) {
      const list = await scopeList(actor.userId, actor.projectId)
      return list.filter((agent) => agent.scope === 'project').map(agentListing)
    },

    async detail(id, actor) {
      const found = await find(id, actor)
      return agentDetail(found, (await deps.chatsOf?.(found.record.id)) ?? 0)
    },

    async remove(id, _scope, actor) {
      const found = await editable(id, actor)
      await agents.deleteAgent(actor.userId, found.record.id, found.projectId || null)
      // A deleted agent's choice would only fill the settings up.
      const all = await deps.choices?.read(actor.userId)
      if (all?.some((c) => c.agentId === found.record.id))
        await deps.choices!.write(
          actor.userId,
          all.filter((c) => c.agentId !== found.record.id),
        )
    },

    async setEnabled(id, _scope, enabled, actor) {
      const found = await find(id, actor)
      await agents.setAgentEnabled(actor.userId, found.record.id, enabled, found.projectId || null)
    },

    async config(id, scope, actor): Promise<ListingConfig | null> {
      const found = await find(id, actor)
      if (scopeOf(found) !== scope) return null
      const revision = found.editable ? await deps.revisionOf?.(found.path) : undefined
      const choices = await deps.choices?.read(actor.userId)
      return agentConfig(
        found,
        revision,
        choices?.find((c) => c.agentId === found.record.id),
      )
    },

    async setConfig(id, _scope, { _revision, ...values }, actor) {
      const found = await editable(id, actor)
      if (typeof _revision === 'string' && (await deps.revisionOf?.(found.path)) !== _revision)
        throw new ConflictError(
          'agent_changed',
          'This agent’s file changed since you opened it. Reload to see the change, or save again to replace it.',
        )
      await agents.updateAgent(
        actor.userId,
        found.record.id,
        inputFromValues(found, values),
        found.projectId || null,
      )
      if (deps.choices && ('model' in values || 'effort' in values)) {
        const all = await deps.choices.read(actor.userId)
        const id = found.record.id
        const next = choiceFromValues(
          id,
          values,
          all.find((c) => c.agentId === id),
        )
        await deps.choices.write(actor.userId, [
          ...all.filter((c) => c.agentId !== id),
          ...(next ? [next] : []),
        ])
      }
    },

    async createFields(actor): Promise<CreateForm> {
      return {
        fields: [NAME_FIELD, DESCRIPTION_FIELD],
        scopes: actor.projectId ? ['user', 'project'] : ['user'],
        noun: 'agent',
      }
    },

    async create(scope: Scope, values: Record<string, ConfigValue>, actor): Promise<ListingRef> {
      if (scope === 'project' && !actor.projectId)
        throw new InvalidRequestError('agent_store_no_project', 'Open a project to add an agent')
      const name = typeof values.name === 'string' ? values.name.trim() : ''
      const description = typeof values.description === 'string' ? values.description.trim() : ''
      if (!name) throw new InvalidRequestError('agent_store_name', 'Name the agent')
      const created = await agents.createAgent(actor.userId, {
        name,
        description,
        instructions: PLACEHOLDER_BODY,
        projectId: scope === 'project' ? actor.projectId! : null,
      })
      return { kind: 'agent', id: created.record.id }
    },

    async runAction(id, _scope, action, actor): Promise<ActionResult> {
      if (action !== 'duplicate' && action !== 'copy' && action !== 'move')
        throw new InvalidRequestError('agent_store_action', `An agent cannot "${action}"`)
      const found = await editableOrAny(id, actor, action)
      if (action === 'move') {
        const toProject = found.scope === 'project' ? null : (actor.projectId ?? null)
        if (found.scope !== 'project' && !toProject)
          throw new InvalidRequestError('agent_store_no_project', 'Open a project to move it there')
        const moved = await agents.moveAgent(
          actor.userId,
          found.record.id,
          toProject,
          found.projectId || null,
        )
        return { ok: true, message: `Moved ${moved.record.name}` }
      }
      const taken = new Set(
        (await scopeList(actor.userId, found.projectId)).map((agent) => agent.record.name),
      )
      const copy = await agents.duplicateAgent(
        actor.userId,
        found.record.id,
        copyName(found.record.name, taken),
        found.projectId || null,
      )
      return { ok: true, message: `Created ${copy.record.name}` }
    },

    subscribe: (listener) => deps.onChange(listener),
  }
}
