/**
 * The permission class of one call to each of the api mini app's two subjects — saved requests and
 * environments. `api_client` routes an operation to one of these and combines a batch with the
 * SDK's `widestCallClass`, so a `DELETE` cannot ride behind a `list` (`api-tool.ts`).
 */

import { UNKNOWN_CALL_CLASS, type CallClass } from '@localixai/mini-app-sdk/backend'

const READ_CALL: CallClass = { effect: 'read' }
const FILES_CALL: CallClass = { effect: 'files' }
const FILES_IRREVERSIBLE_CALL: CallClass = { effect: 'files', irreversible: true }
const EXTERNAL_CALL = UNKNOWN_CALL_CLASS

/** RFC 9110 §9.2.1: the methods a client may send without asking for a change. */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE'])

/**
 * One `http_request` call. `list`/`get` inspect saved requests; `save`/`export` write the
 * collection on disk and `delete` removes a file from it; `import` writes only with `save: true`
 * (without it the parsed requests are previewed and nothing is stored).
 *
 * `send` depends on the METHOD, and the line is the standard's, not ours. A safe method is not a
 * promise the server keeps — it is the strongest statement available before the request is sent,
 * and the gate needs exactly that: let reads through, confirm the rest. An unsafe method reaches
 * past the machine (`external`), and a `DELETE` cannot be taken back.
 *
 * A send that names a SAVED request inherits the stored method when the input omits one
 * (`input-to-spec.ts`: `parseMethod(input.method) ?? base.method`, and the schema has no zod
 * default). Judging the input alone therefore read a saved DELETE as safe: `{action:"list"}` is
 * itself a read and prints every saved method, so an agent could pick one and fire it past the
 * confirmation. This classifier cannot resolve the store — it is pure and synchronous — so an
 * omitted method on a NAMED send is the widest send there is: external AND irreversible, since
 * the stored method may be `DELETE`. Only a method present in THIS call can narrow it.
 */
export function classifyHttpRequestCall(input: unknown): CallClass {
  const call = (input ?? {}) as {
    action?: unknown
    method?: unknown
    name?: unknown
    save?: unknown
  }
  switch (call.action) {
    case 'list':
    case 'get':
      return READ_CALL
    case 'save':
    case 'export':
      return FILES_CALL
    case 'delete':
      return FILES_IRREVERSIBLE_CALL
    case 'import':
      return call.save === true ? FILES_CALL : READ_CALL
    case 'send':
      break
    default:
      return EXTERNAL_CALL
  }
  const method = typeof call.method === 'string' ? call.method.trim().toUpperCase() : ''
  if (!method) {
    return typeof call.name === 'string' && call.name
      ? { effect: 'external', irreversible: true }
      : READ_CALL
  }
  if (SAFE_METHODS.has(method)) return READ_CALL
  return method === 'DELETE' ? { effect: 'external', irreversible: true } : EXTERNAL_CALL
}

/**
 * One `manage_environment` call. `list`/`get` inspect; `save` writes an environment file and
 * `use` rewrites the active-environment pointer every `{{variable}}` resolves through — both
 * files; `delete` removes an environment file for good. Anything else is unknown: external.
 */
export function classifyEnvironmentCall(input: unknown): CallClass {
  switch ((input as { action?: unknown } | null)?.action) {
    case 'list':
    case 'get':
      return READ_CALL
    case 'save':
    case 'use':
      return FILES_CALL
    case 'delete':
      return FILES_IRREVERSIBLE_CALL
    default:
      return EXTERNAL_CALL
  }
}
