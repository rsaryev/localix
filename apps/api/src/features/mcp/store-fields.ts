import type { ConfigField, ConfigValue, ItemAction, ListingConfig } from '@localixai/store'

import { InvalidRequestError } from '../../lib/domain-errors'
import { isRecord } from '../../lib/record'
import { MCP_TRANSPORTS, mcpServerNameSchema, type McpTransport } from './contracts'
import { joinCommandLine, splitCommandLine } from './command-line'
import type { McpServerRecord } from './repository'
import { mcpSecretsSet } from './store-secrets'

/**
 * THE FORM OF AN MCP SERVER, as the Store draws it: one field list for adding one and for its
 * Settings tab, over the record's own shape (`contracts.ts`). Which fields a transport uses is
 * said in each field's help, as the generic form knows no transport; saving refuses a server that
 * could not connect.
 */

const text = (key: string, label: string, help: string, more: Partial<ConfigField> = {}) =>
  ({ key, label, help, type: 'string', required: false, secret: false, ...more }) as ConfigField

export const NAME_FIELD = text('name', 'Name', 'Letters, numbers, dots, dashes and underscores.', {
  required: true,
})

export const SERVER_FIELDS: ConfigField[] = [
  text('description', 'Description', 'What it is for, in a few words.'),
  {
    key: 'transport',
    label: 'Connects by',
    type: 'choice',
    required: true,
    secret: false,
    options: [
      { value: 'stdio', label: 'A program on this computer' },
      { value: 'http', label: 'A web address (HTTP)' },
      { value: 'ws', label: 'A web socket' },
    ],
  },
  text('command', 'Command', 'A program on this computer: the program and its arguments.'),
  {
    key: 'env',
    label: 'Environment',
    help: 'A program on this computer: variables it starts with. Kept in the vault.',
    type: 'map',
    required: false,
    secret: true,
  },
  text('url', 'Address', 'A web address or socket: where to connect.'),
  {
    key: 'headers',
    label: 'Headers',
    help: 'A web address or socket: sent with every request, such as Authorization. Kept in the vault.',
    type: 'map',
    required: false,
    secret: true,
  },
  text('oauthClientId', 'OAuth client id', 'A web address that signs in with OAuth: its client.'),
  text('oauthClientSecret', 'OAuth client secret', 'Its secret, if it has one.', { secret: true }),
  text('oauthScope', 'OAuth scope', 'What to ask for; blank takes what the server advertises.'),
  {
    key: 'channel',
    label: 'Listen as a channel',
    help: 'Let the server speak into the chat that last used it, as Claude Code’s --channels does.',
    type: 'boolean',
    required: false,
    secret: false,
  },
  {
    key: 'timeout',
    label: 'Tool call timeout (ms)',
    help: 'How long one tool call may take; blank takes the default.',
    type: 'number',
    required: false,
    secret: false,
    min: 1000,
  },
]

/** The actions of a server: every one can be tested, only a web address signs in. */
export function actionsOf(transport: McpTransport): ItemAction[] {
  return [
    { id: 'test', label: 'Test connection', help: 'Connect now and list its tools.' },
    ...(transport === 'http'
      ? [
          { id: 'sign-in', label: 'Sign in', help: 'Open the server’s sign-in in your browser.' },
          { id: 'sign-out', label: 'Sign out', danger: true },
        ]
      : []),
  ]
}

/** The per-tool switches, once a connection has said which tools it has. */
export const toolsField = (names: readonly string[]): ConfigField => ({
  key: 'tools',
  label: 'Tools',
  help: 'The tools the agent may use from this server.',
  type: 'multichoice',
  required: false,
  secret: false,
  options: names.map((value) => ({ value })),
})

/** What a stored server shows on its Settings tab: its open values, and which secrets are set. */
export function settingsOf(
  record: McpServerRecord,
  extra: {
    scope: 'user' | 'project'
    tools: { names: readonly string[]; enabled: string[] } | null
  },
): ListingConfig {
  const { config } = record
  const oauth = isRecord(config.oauth) ? config.oauth : {}
  const argv = Array.isArray(config.command) ? config.command.map(String) : []
  const open: Record<string, string | number | boolean | null> = {
    description: record.description,
    transport: record.transport,
    command: argv.length > 0 ? joinCommandLine(argv) : null,
    url: typeof config.url === 'string' ? config.url : null,
    oauthClientId: typeof oauth.clientId === 'string' ? oauth.clientId : null,
    oauthScope: typeof oauth.scope === 'string' ? oauth.scope : null,
    timeout: typeof config.timeout === 'number' ? config.timeout : null,
    channel: config.channel === true,
  }
  return {
    fields: [...SERVER_FIELDS, ...(extra.tools ? [toolsField(extra.tools.names)] : [])],
    values: { ...open, ...(extra.tools ? { tools: extra.tools.enabled } : {}) },
    set: mcpSecretsSet(config),
    scope: extra.scope,
    scopes: [extra.scope],
    actions: actionsOf(record.transport),
  }
}

const asText = (value: ConfigValue | undefined): string => (typeof value === 'string' ? value : '')
const asMap = (value: ConfigValue | undefined): Record<string, string> =>
  isRecord(value) ? (value as Record<string, string>) : {}

/** A server's fields after a save: its stored shape with the given keys changed. */
export interface ServerShape {
  description: string
  transport: McpTransport
  config: Record<string, unknown>
}

/**
 * The server `base` becomes when `values` are saved: a key not given is kept, a secret left out
 * keeps its value, a blank one is cleared. Refuses what could not connect.
 */
export function applyValues(base: ServerShape, values: Record<string, ConfigValue>): ServerShape {
  const has = (key: string) => key in values
  const transport = has('transport') ? asText(values.transport) : base.transport
  if (!(MCP_TRANSPORTS as readonly string[]).includes(transport))
    throw new InvalidRequestError('mcp_store_transport', `"${transport}" is not a way to connect`)
  const config: Record<string, unknown> = { ...base.config }
  const set = (key: string, value: unknown) => {
    if (value === undefined || value === '' || (isRecord(value) && !Object.keys(value).length))
      delete config[key]
    else config[key] = value
  }
  if (has('command')) {
    const argv = splitCommandLine(asText(values.command))
    set('command', argv.length > 0 ? argv : undefined)
  }
  if (has('url')) set('url', asText(values.url).trim())
  if (has('env')) set('env', asMap(values.env))
  if (has('headers')) set('headers', asMap(values.headers))
  if (has('channel')) set('channel', values.channel === true ? true : undefined)
  if (has('timeout'))
    set('timeout', typeof values.timeout === 'number' ? values.timeout : undefined)
  const oauth: Record<string, unknown> = isRecord(config.oauth) ? { ...config.oauth } : {}
  const keep = (key: string, value: ConfigValue | undefined, field: string) => {
    if (!has(field)) return
    const given = asText(value)
    if (given === '') delete oauth[key]
    else oauth[key] = given
  }
  keep('clientId', values.oauthClientId, 'oauthClientId')
  keep('clientSecret', values.oauthClientSecret, 'oauthClientSecret')
  keep('scope', values.oauthScope, 'oauthScope')
  set('oauth', oauth)

  const shape: ServerShape = {
    description: has('description') ? asText(values.description) : base.description,
    transport: transport as McpTransport,
    config,
  }
  if (transport === 'stdio' && !Array.isArray(config.command))
    throw new InvalidRequestError('mcp_store_command', 'A server on this computer needs a command')
  if (transport !== 'stdio' && typeof config.url !== 'string')
    throw new InvalidRequestError('mcp_store_url', 'A server on the web needs an address (URL)')
  return shape
}

/** The name a new server is given, or why it cannot be. */
export function nameOf(values: Record<string, ConfigValue>): string {
  const parsed = mcpServerNameSchema.safeParse(values.name)
  if (!parsed.success)
    throw new InvalidRequestError(
      'mcp_store_name',
      parsed.error.issues[0]?.message ?? 'Give the server a name',
    )
  return parsed.data
}
