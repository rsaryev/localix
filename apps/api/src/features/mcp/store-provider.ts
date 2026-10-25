import { createChangeSignal } from '@localixai/store'
import type {
  ActionResult,
  ConfigValue,
  CreateForm,
  Listing,
  ListingConfig,
  ListingRef,
  Scope,
  StoreActor,
  StoreProvider,
} from '@localixai/store'

import { ConflictError, InvalidRequestError, NotFoundError } from '../../lib/domain-errors'
import type { AvailabilityReader } from '../capabilities/availability'
import type { McpServerInput } from './contracts'
import type { McpRepository, McpServerRecord } from './repository'
import type { McpService } from './service'
import { applyValues, nameOf, NAME_FIELD, SERVER_FIELDS, settingsOf } from './store-fields'
import {
  fileOf,
  idOf,
  inProject,
  refOf,
  serverDetail,
  serverListing,
  type ServerRef,
} from './store-listing'
import { hydrateMcpRecords, mcpSecretsSet } from './store-secrets'

/** What the provider asks of the MCP service: the writes, the connection test and the sign-in. */
export type McpStoreService = Pick<
  McpService,
  | 'createServer'
  | 'updateServer'
  | 'deleteServer'
  | 'testServer'
  | 'startServerOAuth'
  | 'logoutServerOAuth'
>

export interface McpStoreDeps {
  /** The servers the person added, as stored. */
  repo: McpRepository
  service: McpStoreService
  /** Whether each server and tool may run: rules, shared with the Capabilities screen. */
  availability: {
    reader(userId: string): Promise<AvailabilityReader>
    set(userId: string, switches: Array<{ name: string; enabled: boolean }>): Promise<void>
  }
  /** The servers Claude Code's files define: the person's, and those of a project's folder. */
  files: { user(): McpServerRecord[]; project(cwd: string): McpServerRecord[] }
  projectCwd(userId: string, projectId: string): Promise<string | null>
  /**
   * Hear a change made outside the Store (a switch from the Capabilities screen, a file written by
   * a tool); returns the unsubscribe. The Store's own writes are announced here too.
   */
  onChange(listener: () => void): () => void
}

interface Found {
  ref: ServerRef
  record: McpServerRecord
}

const fileScope = (record: McpServerRecord) => record.id.split(':')[1] ?? 'user'

/**
 * MCP SERVERS AS A STORE PROVIDER (`docs/internals/store.md`, "MCP servers"). A server is not
 * downloaded: it is made here, so the provider lists what the person has (Yours, and the open
 * project's on its shelf), adds one from a form and keeps its settings on its page. The servers
 * of Claude Code's files are listed too and are read-only; their switch is a rule like any
 * other. A server a plugin bundles is a component of that plugin and is not listed.
 */
export function createMcpStoreProvider(deps: McpStoreDeps): StoreProvider {
  const { changed, subscribe } = createChangeSignal((listener) => deps.onChange(listener))
  /** The tools each server said it has when last tested: the switches a page can show. */
  const tools = new Map<string, string[]>()
  const toolsKey = (userId: string, record: McpServerRecord) => `${userId}:${record.id}`

  const enabledOf = async (userId: string) => {
    const reader = await deps.availability.reader(userId)
    return (name: string) => reader.effectFor('mcp', name) !== 'deny'
  }

  const projectOf = (scope: Scope, actor: StoreActor): string => {
    if (scope === 'user') return ''
    if (!actor.projectId)
      throw new InvalidRequestError('mcp_store_no_project', 'Open a project to add a server for it')
    return actor.projectId
  }

  const ownIn = async (userId: string, projectId: string) =>
    (await deps.repo.listForScope(userId, projectId)).filter((r) => r.projectId === projectId)

  async function find(id: string, actor: StoreActor): Promise<Found> {
    const ref = refOf(id)
    const missing = () => new NotFoundError('mcp_store_not_found', `No MCP server "${id}"`)
    if (!ref) throw missing()
    let records: McpServerRecord[] = []
    if (ref.origin === 'own') {
      if (ref.scope === 'user' || actor.projectId)
        records = await ownIn(actor.userId, ref.scope === 'user' ? '' : actor.projectId!)
    } else if (inProject(ref)) {
      const cwd = actor.projectId ? await deps.projectCwd(actor.userId, actor.projectId) : null
      records = cwd ? deps.files.project(cwd) : []
    } else records = deps.files.user()
    const record = records.find(
      (r) => r.name === ref.name && (ref.origin === 'own' || fileScope(r) === ref.scope),
    )
    if (!record) throw missing()
    return { ref, record }
  }

  const own = async (id: string, actor: StoreActor): Promise<Found & { ref: ServerRef }> => {
    const found = await find(id, actor)
    if (found.ref.origin === 'file')
      throw new InvalidRequestError(
        'mcp_store_file',
        `${found.record.name} is defined in ${fileOf(found.ref.scope)}: change it there`,
      )
    return found
  }

  const fileRef = (record: McpServerRecord): ServerRef => ({
    origin: 'file',
    scope: fileScope(record),
    name: record.name,
  })

  async function listing(
    record: McpServerRecord,
    ref: ServerRef,
    enabled: (name: string) => boolean,
  ): Promise<Listing> {
    return serverListing(record, { ref, enabled: enabled(record.name) })
  }

  async function ownListings(userId: string, projectId: string, scope: Scope) {
    const enabled = await enabledOf(userId)
    const records = await ownIn(userId, projectId)
    return Promise.all(
      records.map((r) => listing(r, { origin: 'own', scope, name: r.name }, enabled)),
    )
  }

  return {
    kind: 'mcp-server',

    async listings(actor) {
      const enabled = await enabledOf(actor.userId)
      const own = await ownListings(actor.userId, '', 'user')
      const files = await Promise.all(deps.files.user().map((r) => listing(r, fileRef(r), enabled)))
      return { listings: [...own, ...files], problems: [] }
    },

    async projectListings(actor) {
      const cwd = await deps.projectCwd(actor.userId, actor.projectId)
      const enabled = await enabledOf(actor.userId)
      const files = (cwd ? deps.files.project(cwd) : []).map((r) => listing(r, fileRef(r), enabled))
      return [
        ...(await ownListings(actor.userId, actor.projectId, 'project')),
        ...(await Promise.all(files)),
      ]
    },

    async detail(id, actor) {
      const { ref, record } = await find(id, actor)
      return serverDetail(await listing(record, ref, await enabledOf(actor.userId)), record, ref)
    },

    async remove(id, _scope, actor) {
      const { record } = await own(id, actor)
      await deps.service.deleteServer(actor.userId, record.id)
      tools.delete(toolsKey(actor.userId, record))
      changed()
    },

    async setEnabled(id, _scope, enabled, actor) {
      const { record } = await find(id, actor)
      await deps.availability.set(actor.userId, [{ name: record.name, enabled }])
      changed()
    },

    async config(id, scope, actor): Promise<ListingConfig | null> {
      const found = await find(id, actor)
      if (found.ref.origin === 'file' || found.ref.scope !== scope) return null
      const names = tools.get(toolsKey(actor.userId, found.record))
      const enabled = await enabledOf(actor.userId)
      return settingsOf(found.record, {
        scope,
        tools: names
          ? { names, enabled: names.filter((tool) => enabled(`${found.record.name}/${tool}`)) }
          : null,
      })
    },

    async setConfig(id, _scope, values, actor) {
      const { record: stored } = await own(id, actor)
      const [record = stored] = await hydrateMcpRecords(actor.userId, [stored])
      const { tools: wanted, ...rest } = values
      // A secret the vault cannot give back would be written back as nothing: say so instead.
      const lost = mcpSecretsSet(stored.config).filter(
        (key) => !(key in values) && !mcpSecretsSet(record.config).includes(key),
      )
      if (lost.length > 0)
        throw new InvalidRequestError(
          'mcp_store_secret_unreadable',
          `The saved ${lost.join(' and ')} could not be read from the vault: enter it again to save`,
        )
      if (Object.keys(rest).length > 0) {
        const next = applyValues(record, rest)
        await deps.service.updateServer(actor.userId, record.id, {
          name: record.name,
          description: next.description,
          transport: next.transport,
          config: next.config as McpServerInput['config'],
        })
      }
      const names = tools.get(toolsKey(actor.userId, record))
      if (Array.isArray(wanted) && names)
        await deps.availability.set(
          actor.userId,
          names.map((tool) => ({ name: `${record.name}/${tool}`, enabled: wanted.includes(tool) })),
        )
      changed()
    },

    async createFields(actor): Promise<CreateForm> {
      return {
        fields: [NAME_FIELD, ...SERVER_FIELDS],
        scopes: actor.projectId ? ['user', 'project'] : ['user'],
        noun: 'MCP server',
      }
    },

    async create(scope, values: Record<string, ConfigValue>, actor): Promise<ListingRef> {
      const projectId = projectOf(scope, actor)
      const name = nameOf(values)
      if ((await ownIn(actor.userId, projectId)).some((r) => r.name === name))
        throw new ConflictError('mcp_name_conflict', `An MCP server named "${name}" already exists`)
      const shape = applyValues(
        { description: '', transport: 'stdio', config: {} },
        { transport: 'stdio', ...values },
      )
      await deps.service.createServer(actor.userId, {
        name,
        description: shape.description,
        transport: shape.transport,
        projectId: projectId || null,
        config: shape.config as McpServerInput['config'],
      })
      changed()
      return { kind: 'mcp-server', id: idOf({ origin: 'own', scope, name }) }
    },

    async runAction(id, _scope, action, actor): Promise<ActionResult> {
      const { record } = await own(id, actor)
      if (action === 'test') {
        const status = await deps.service.testServer(actor.userId, record.id)
        if (!status.ok) return { ok: false, message: status.error ?? 'Could not connect' }
        const names = status.availableTools ?? status.tools
        tools.set(toolsKey(actor.userId, record), names)
        changed()
        return {
          ok: true,
          message: `Connected: ${names.length} ${names.length === 1 ? 'tool' : 'tools'}`,
        }
      }
      if (action === 'sign-in') {
        const start = await deps.service.startServerOAuth(actor.userId, record.id)
        if (start.authenticated) return { ok: true, message: 'Already signed in' }
        if (!start.authorizationUrl) return { ok: false, message: 'The server gave no sign-in' }
        return {
          ok: true,
          message: 'Finish signing in in your browser',
          open: start.authorizationUrl,
        }
      }
      if (action === 'sign-out') {
        await deps.service.logoutServerOAuth(actor.userId, record.id)
        changed()
        return { ok: true, message: 'Signed out' }
      }
      throw new InvalidRequestError('mcp_store_action', `An MCP server cannot "${action}"`)
    },

    subscribe,
  }
}
