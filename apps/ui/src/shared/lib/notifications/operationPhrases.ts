/**
 * The headline a person reads when a request failed and its caller said nothing.
 *
 * The transport's last-resort row used to be titled with the trace's own summary — "PATCH mcp
 * failed", "POST sessions failed", "send failed" — a verb and a URL segment nobody outside this
 * repository can act on, in the place the app reserves for sentences. The trace keeps that
 * technical summary (it is a diagnostic, shown under "Details"); the HEADLINE comes from here.
 *
 * One registry, keyed by what the transport knows: an HTTP method plus the route's first segment,
 * or a socket request's type. An operation nobody registered still gets a sentence — chosen by its
 * method — and never the raw operation, so a new route degrades to vague, not to jargon.
 */

type Verb = 'load' | 'create' | 'save' | 'delete'

/** What each route's first segment is, to a person, and any verb it words differently. */
const RESOURCES: Readonly<Record<string, { noun: string; verbs?: Partial<Record<Verb, string>> }>> =
  {
    sessions: { noun: 'the conversation', verbs: { create: 'update' } },
    mcp: { noun: 'the MCP settings' },
    plugins: { noun: 'the plugin settings' },
    agents: { noun: 'the agent' },
    skills: { noun: 'the skill' },
    projects: { noun: 'the project settings' },
    user: { noun: 'your settings' },
    tools: { noun: 'the tool settings' },
    'effective-config': { noun: 'the effective configuration' },
    models: { noun: 'the model settings' },
    'provider-connections': { noun: 'the provider connection' },
    capabilities: { noun: 'the permission rules' },
    secrets: { noun: 'the Vault item' },
    search: { noun: 'the search results', verbs: { create: 'load' } },
    terminal: { noun: 'the terminal', verbs: { create: 'update' } },
    preview: { noun: 'the preview', verbs: { create: 'open' } },
    attention: { noun: 'your answer', verbs: { create: 'send' } },
    comments: { noun: 'the comment' },
    plans: { noun: 'the plan', verbs: { create: 'update' } },
    system: { noun: 'the system settings' },
    'shell-command': { noun: 'the localix command', verbs: { create: 'update' } },
    loops: { noun: 'the loop' },
    usage: { noun: 'the usage figures' },
    'ui-locations': { noun: 'the layout' },
    'resource-refs': { noun: 'the linked resource' },
  }

/** How an unregistered route is worded: by what its method does, with a neutral object. */
const GENERIC: Readonly<Record<Verb, string>> = {
  load: 'Could not load the data',
  create: 'Could not complete the action',
  save: 'Could not save the change',
  delete: 'Could not delete the item',
}

function verbOf(method: string): Verb {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return 'load'
    case 'PUT':
    case 'PATCH':
      return 'save'
    case 'DELETE':
      return 'delete'
    default:
      return 'create'
  }
}

/** The headline for a failed HTTP request, from its method and its route's first segment. */
export function requestFailureTitle(method: string, resource: string): string {
  const verb = verbOf(method)
  const entry = RESOURCES[resource]
  if (!entry) return GENERIC[verb]
  return `Could not ${entry.verbs?.[verb] ?? verb} ${entry.noun}`
}

/** HTTP operations are `<METHOD> <resource>` (`shared/api/internal.ts`, `apiRequestMetadata`). */
export function httpOperationTitle(operation: string): string {
  const [method = 'POST', resource = ''] = operation.split(' ')
  return requestFailureTitle(method, resource)
}

/** Socket requests, by their message type (`shared/api/eventSocket/rpc.ts`). */
const SOCKET_OPERATIONS: Readonly<Record<string, string>> = {
  send: 'Could not send the message',
  interact: 'Could not send your answer',
  'submit-secret': 'Could not send the secret',
  'session.watch': 'Could not follow the conversation',
  'session.revoke-permission': 'Could not revoke the permission',
  run_terminal: 'Could not run the command',
  input: 'Could not reach the terminal',
  resize: 'Could not reach the terminal',
  cancel: 'Could not cancel the request',
  'preview-result': 'Could not return the preview result',
  'plugin-command-result': 'Could not return the command result',
  'inline.complete': 'Could not get a suggestion',
  predictNextEdit: 'Could not get a suggestion',
}

/** The headline for a failed socket request; any `lsp.*` request is the language server's. */
export function socketOperationTitle(operation: string): string {
  const known = SOCKET_OPERATIONS[operation]
  if (known) return known
  if (operation.startsWith('lsp.')) return 'The language server did not answer'
  return 'Could not complete the action'
}
