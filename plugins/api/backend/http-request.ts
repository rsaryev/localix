/**
 * The `http_request` tool body. Wiring only: validate → resolve → act → format. Every rule about
 * misuse lives in `http-request-schema.ts`, every rule about the wire lives in `send.ts`.
 */

import type { AgentTool, AgentToolExecutionContext } from '@localixai/agent/agents'
import type { PluginContext } from '@localixai/plugin-sdk/backend'
import path from 'node:path'
import { classifyHttpRequestCall } from './call-class'
import { requestFilePath } from './collection/paths'
import type { EnvironmentService } from './environments/service'
import { formatResponse } from './format-response'
import {
  buildHttpRequestSchema,
  httpRequestProblem,
  type HttpRequestInput,
} from './http-request-schema'
import { exportDirFor, exportRequests, readExportedFiles } from './git-sync/action'
import { recordSend } from './history'
import { runImportAction } from './import-action'
import type { StoreSecret } from './vault-auth'
import { overlayInput, specForSend, specFromInput } from './input-to-spec'
import { isHttpUrl, type RequestSpec } from './request-spec'
import { missingVarsProblem } from './render-spec'
import { renderEnvironmentForSend } from './render-environment'
import { resolveAuthSecrets, type ResolveSecret } from './secrets'
import { bindAuthSecrets, type BindSecret } from './vault-bindings'
import { RequestTimeoutError, sendRequest } from './send'
import { redactSpec } from './store'
import type { CollectionRequest, CollectionStore } from './collection/store'
import { buildCollectionUri, buildRequestUri } from './uri'

export interface HttpRequestDeps {
  ctx: PluginContext
  store: CollectionStore
  environments: EnvironmentService
  resolveSecret: ResolveSecret
  /** Absent when no host bound the vault writer — an imported literal then stays as written. */
  storeSecret?: StoreSecret
  /** Absent when the host offers no binding registry — references then go unrecorded. */
  bindSecret?: BindSecret
  userId: string
  /** Resolve the collection actually owned by the executing session. */
  resolveScope?: (
    sessionId?: string,
  ) =>
    | { store: CollectionStore; environments: EnvironmentService }
    | Promise<{ store: CollectionStore; environments: EnvironmentService }>
}

function describe(saved: CollectionRequest): string {
  const spec = redactSpec(saved.spec)
  const auth = spec.auth.type === 'none' ? '' : ` [auth: ${spec.auth.type}]`
  return `${saved.name}: ${spec.method} ${spec.url}${auth}`
}

export function createHttpRequestTool(deps: HttpRequestDeps): AgentTool {
  const { ctx, store, environments, resolveSecret, storeSecret, bindSecret, userId } = deps

  /**
   * The transcript button that turns a tool result into a place the user can GO.
   *
   * `offer`, never `open`: the agent was asked to do work, not to show a surface, so a result
   * that seized the grid mid-conversation would be the plugin deciding what the user should be
   * looking at. `offer` renders the same button and leaves the click to them. (`open` is right
   * when the ASK was "show me" — see the learning plugin's course tool.)
   */
  const openRequest = (name: string, description: string) =>
    ctx.ui.offer({ uri: buildRequestUri(name), label: `Open "${name}"`, description })
  const openCollection = (description: string) =>
    ctx.ui.offer({ uri: buildCollectionUri(), label: 'Open API Client', description })

  const timeoutMs = ctx.helpers.configNumber(ctx.config.TIMEOUT_MS, 30_000)
  const maxBodyBytes = ctx.helpers.configNumber(ctx.config.MAX_BODY_BYTES, 1_000_000)
  const allowPrivateNetwork = ctx.helpers.configBoolean(ctx.config.ALLOW_PRIVATE_NETWORK, false)

  /** The spec a `send` should use. The decision is `specForSend`'s; the store lookup is ours. */
  async function resolveSpec(input: HttpRequestInput): Promise<RequestSpec | string> {
    const name = input.name?.trim()
    const saved = name ? await store.get(name) : null
    return specForSend(input, saved)
  }

  return ctx.defineTool({
    name: 'http_request',
    label: 'HTTP request',
    activeVerb: 'Calling',
    // Reads and writes alike are cheap and independent; nothing here shares mutable state that a
    // second concurrent call could corrupt (the store serialises its own writes per user).
    executionMode: 'parallel',
    description:
      'Send HTTP requests and save them for reuse. ' +
      'action="send" performs a request, e.g. {"action":"send","url":"https://api.github.com/users/octocat"}. ' +
      'action="save" stores one under a name; action="send" with that name re-sends it, so a ' +
      'credential is configured once and never repeated. ' +
      'action="import" turns a cURL command copied from API docs or a browser, or a HAR archive, ' +
      'into saved requests — prefer it over transcribing headers by hand, and paste the command ' +
      'verbatim: a credential in it is moved into the secrets vault on import, so you do not need ' +
      'to strip it first. ' +
      'A url may use environment variables, e.g. `{{base_url}}/users`; manage them with target="environment" on `api_client`. ' +
      'When writing a credential by hand, a vault reference like `${secret:GITHUB_TOKEN}` is ' +
      'preferred over a literal — either way it is resolved at send time, and a saved request ' +
      'never shows the value back to you.',
    inputSchema: buildHttpRequestSchema(ctx.z),
    // Writes: `send` with a non-safe method, and every action that persists something —
    // `save`/`delete` touch the store, `import` moves credentials into the vault,
    // `export` writes a file into the workspace.
    mutates: true,
    /**
     * The collection and export helpers enforce that every plugin-owned file stays under
     * `ctx.cwd`. Import is the broad case: names come from the parsed payload, and imported
     * environments may make the first environment active, so declare the collection directory
     * and the host-provided state file rather than inventing filenames before parsing.
     *
     * `send` mutates the remote HTTP service for unsafe methods, and import/save may also call the
     * host's vault/binding capability. Neither mutation has a filesystem path from this input that
     * a path rule could truthfully judge; the URL/private-network policy and host vault capability
     * are their real boundaries.
     */
    permissionPaths: (input) => {
      const call = (input ?? {}) as {
        action?: unknown
        dir?: unknown
        name?: unknown
        save?: unknown
      }
      const collectionRoot = store.root()

      if (call.action === 'save' || call.action === 'delete') {
        if (typeof call.name !== 'string' || !call.name.trim()) return []
        const file = requestFilePath(collectionRoot, call.name)
        // Save may create parent directories; delete may prune empty ones back to the root.
        return file ? [file, collectionRoot] : []
      }

      if (call.action === 'import' && call.save === true) {
        return [collectionRoot, path.join(ctx.stateDir, 'active-environment.json')]
      }

      if (call.action === 'export') {
        const dir = exportDirFor(ctx.cwd, typeof call.dir === 'string' ? call.dir : undefined)
        return dir ? [dir] : []
      }

      return []
    },
    classify: classifyHttpRequestCall,

    async execute(
      _toolCallId,
      input: HttpRequestInput,
      signal?: AbortSignal,
      _onUpdate?: unknown,
      executionContext?: AgentToolExecutionContext,
    ) {
      const problem = httpRequestProblem(input)
      if (problem) return ctx.helpers.errorResult(problem)

      try {
        switch (input.action) {
          case 'list': {
            const all = await store.list()
            if (all.length === 0) {
              return {
                content:
                  'No saved requests yet. Save one with {"action":"save","name":"github-user","url":"https://api.github.com/users/octocat"}.',
              }
            }
            return { content: all.map(describe).join('\n') }
          }

          case 'get': {
            const saved = await store.get(input.name!.trim())
            if (!saved) return ctx.helpers.errorResult(`No saved request named "${input.name}".`)
            return { content: JSON.stringify(redactSpec(saved.spec), null, 2) }
          }

          case 'delete': {
            const id = input.name!.trim()
            const saved = await store.get(id)
            if (!saved) return ctx.helpers.errorResult(`No saved request named "${id}".`)
            await store.remove(id)
            return { content: `Deleted saved request "${id}".` }
          }

          case 'save': {
            const id = input.name!.trim()
            const existing = await store.get(id)
            const spec = existing ? overlayInput(existing.spec, input) : specFromInput(input)
            // `save` replaces the file that already carries this name, which is the overwrite
            // semantics we want: a name is the identity, so re-saving edits in place.
            const written = await store.save(id, spec)
            if (!written.ok) return ctx.helpers.errorResult(written.problem)
            // Same bookkeeping the UI's auth route does — an agent-authored `${secret:KEY}` is a
            // reference like any other, and the vault should know who points at it.
            await bindAuthSecrets(userId, id, spec.auth, bindSecret)
            return {
              content: `${existing ? 'Updated' : 'Saved'} request "${id}": ${spec.method} ${spec.url}\nSaved only — no HTTP call was made. To call it now, use {"action":"send","name":"${id}"}.`,
              details: openRequest(
                id,
                existing ? 'Review the change in API Client' : 'Edit and send it in API Client',
              ),
            }
          }

          case 'import': {
            // A `dir` reads the repo's shared requests; each file goes through the SAME chain a
            // pasted one does, so an exported request and a hand-committed one are read once.
            let sources: string[]
            if (input.dir !== undefined) {
              const files = await readExportedFiles(ctx.cwd, input.dir)
              if ('problem' in files) return ctx.helpers.errorResult(files.problem)
              if (files.length === 0) {
                return ctx.helpers.errorResult(
                  `No exported request files in "${input.dir || '.localix/rest'}". Export some first with {"action":"export"}.`,
                )
              }
              sources = files
            } else {
              sources = [input.source!]
            }

            const outcome = await runImportAction(
              { store, userId, storeSecret, environments },
              sources,
              input.save === true,
              { baseUrl: input.baseUrl },
            )
            // An import that SAVED something changed the user's collection — the button is how
            // they see the eight requests that just appeared without asking what was created.
            return outcome.ok
              ? {
                  content: outcome.content,
                  ...(input.save === true
                    ? { details: openCollection('See the imported requests') }
                    : {}),
                }
              : ctx.helpers.errorResult(outcome.problem)
          }

          case 'export': {
            const out = await exportRequests({
              store,
              userId,
              cwd: ctx.cwd,
              subdir: input.dir,
              names: input.names,
            })
            if ('problem' in out) return ctx.helpers.errorResult(out.problem)

            const rel = out.dir
            const lines: string[] = []
            if (out.written.length > 0) {
              lines.push(
                `Exported ${out.written.length} request(s) to ${rel} — one file each, so a review reads as a diff. Commit them to share with the team.`,
                ...out.written.map((f) => `  ${f}`),
              )
            }
            // A refusal is the POINT of this action, not an aside: it is the difference between
            // sharing a request and committing a credential.
            if (out.problems.length > 0) lines.push('', ...out.problems)
            if (out.written.length === 0) {
              return ctx.helpers.errorResult(lines.join('\n') || 'Nothing was exported.')
            }
            return { content: lines.join('\n') }
          }

          case 'send': {
            const base = await resolveSpec(input)
            if (typeof base === 'string') return ctx.helpers.errorResult(base)

            // Render against the ACTIVE environment on a copy — the saved request keeps its
            // `{{ base_url }}` and re-renders next time, against whatever is active then.
            const rendered = await renderEnvironmentForSend(
              base,
              environments,
              userId,
              input.name?.trim() || undefined,
            )
            if (rendered.safe.missing.length > 0) {
              return ctx.helpers.errorResult(
                missingVarsProblem(rendered.safe.missing, await environments.activeName(userId)),
              )
            }
            // A render that broke the body is a request the server cannot read. Refusing beats
            // sending malformed JSON and reporting whatever 400 comes back as the API's fault.
            if (rendered.wire.problems.length > 0) {
              return ctx.helpers.errorResult(rendered.wire.problems.join(' '))
            }
            const resolved = rendered.wire.spec
            const observable = rendered.safe.spec
            // NOW the url exists, so now it can be checked. A saved `{{base_url}}/x` was accepted
            // on the promise that an environment would make it a url; this is where that promise
            // is kept or reported.
            if (!isHttpUrl(resolved.url)) {
              return ctx.helpers.errorResult(
                `This request resolves to "${resolved.url}", which is not an http(s) URL. Check the active environment's variables.`,
              )
            }

            // The saved request's name rides along so the vault's activity log attributes the
            // read to it; an ad-hoc send has no name to give and stays attributed to the plugin.
            const auth = await resolveAuthSecrets(
              userId,
              resolved.auth,
              resolveSecret,
              input.name?.trim() || undefined,
            )
            try {
              const requestTimeoutMs = resolved.timeoutMs ?? timeoutMs
              if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
                return ctx.helpers.errorResult(
                  `This request's timeout (${resolved.timeoutMs}ms) must be a positive number of milliseconds.`,
                )
              }
              const res = await sendRequest(
                { ...resolved, auth },
                {
                  timeoutMs: requestTimeoutMs,
                  maxBodyBytes,
                  allowPrivateNetwork,
                  signal,
                  secretValues: rendered.secretValues,
                },
              )
              // A SAVED request's send lands in the same response history the workbench dropdown
              // reads, so the user sees what the agent got. An ad-hoc (unnamed) send has no row
              // to hang history on and is not recorded. Tagged 'agent' — the workbench's own Send
              // records 'user' — and the rendered spec is snapshotted (redacted, in recordSend).
              const savedName = input.name?.trim()
              if (savedName) {
                recordSend(
                  userId,
                  savedName,
                  res,
                  'agent',
                  observable,
                  executionContext?.session?.id,
                )
              }
              return {
                content: formatResponse(observable, res, input.filter),
                // Only a SAVED send has somewhere to land: the tab reads the history ring this
                // send just wrote, so the button shows the very response the model is reporting.
                ...(savedName
                  ? {
                      details: openRequest(
                        savedName,
                        `Open the ${res.status} response in API Client`,
                      ),
                    }
                  : {}),
              }
            } catch (err) {
              // The timeout is `sendRequest`'s now, so this no longer wraps the call in a second
              // one (`ctx.helpers.withTimeoutSignal`). Two timers of the same length racing would
              // have made `didTimeout()` — and therefore this message — a coin flip. All that is
              // left here is the part only a TOOL knows: a timeout is worth retrying.
              if (err instanceof RequestTimeoutError) {
                return ctx.helpers.errorResult(err.message, { retryable: true })
              }
              throw err
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return ctx.helpers.errorResult(message)
      }
    },
  })
}
