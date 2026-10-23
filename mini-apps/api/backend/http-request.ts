/**
 * The `http_request` tool body. Wiring only: validate → resolve → act → format. Every rule about
 * misuse lives in `http-request-problem.ts`, every rule about the wire lives in `send.ts`.
 */

import type { AgentTool, AgentToolExecutionContext } from '@localixai/agent/agents'
import type { PluginContext } from '@localixai/mini-app-sdk/backend'
import path from 'node:path'
import { classifyHttpRequestCall } from './call-class'
import { requestFilePath } from './collection/paths'
import type { EnvironmentService } from './environments/service'
import { buildHttpRequestSchema, type HttpRequestInput } from './http-request-schema'
import { httpRequestProblem } from './http-request-problem'
import { createHttpSendAction } from './http-request-send'
import { exportDirFor, exportRequests, readExportedFiles } from './git-sync/action'
import { runImportAction } from './import-action'
import type { StoreSecret } from './vault-auth'
import { overlayInput, specFromInput } from './input-to-spec'
import type { ResolveSecret } from './secrets'
import { bindAuthSecrets, type BindSecret } from './vault-bindings'
import { redactSpec } from './store'
import { describeRequest } from './request-summary'
import type { CollectionStore } from './collection/store'
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

export function createHttpRequestTool(deps: HttpRequestDeps): AgentTool {
  const { ctx, store, environments, resolveSecret, storeSecret, bindSecret, userId } = deps

  /**
   * The transcript button that turns a tool result into a place the user can GO.
   *
   * `offer`: the agent was asked to do work, not to show a surface, so a result
   * that seized the grid mid-conversation would be the plugin deciding what the user should be
   * looking at. `offer` renders the same button and leaves the click to them.
   */
  const openRequest = (name: string, description: string) =>
    ctx.ui.offer({ uri: buildRequestUri(name), label: `Open "${name}"`, description })
  const openCollection = (description: string) =>
    ctx.ui.offer({ uri: buildCollectionUri(), label: 'Open API Client', description })

  const timeoutMs = ctx.helpers.configNumber(ctx.config.TIMEOUT_MS, 30_000)
  const maxBodyBytes = ctx.helpers.configNumber(ctx.config.MAX_BODY_BYTES, 1_000_000)
  const allowPrivateNetwork = ctx.helpers.configBoolean(ctx.config.ALLOW_PRIVATE_NETWORK, false)

  const executeSend = createHttpSendAction({
    ctx,
    store,
    environments,
    resolveSecret,
    userId,
    timeoutMs,
    maxBodyBytes,
    allowPrivateNetwork,
    openRequest,
  })

  return ctx.defineTool({
    name: 'http_request',
    label: 'HTTP request',
    activeVerb: 'Calling',
    // Independent calls may run in parallel; collection writes are atomic and last-write-wins.
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
     * `ctx.cwd`. Import names come from the parsed payload, so declare the collection directory
     * and host-provided state file before those names are known.
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
        // Cover the request file and its parent collection directories.
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
            return { content: all.map(describeRequest).join('\n') }
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

          case 'send':
            return await executeSend(input, signal, executionContext)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return ctx.helpers.errorResult(message)
      }
    },
  })
}
