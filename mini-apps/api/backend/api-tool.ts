/**
 * `api_client` — the plugin's ONE agent tool. Wiring only: validate → pick the subject → delegate.
 *
 * The two bodies it fronts are unchanged and still live apart, because they are two subjects:
 * `http-request.ts` answers "what call do I make", `manage-environment.ts` answers "against which
 * deployment". Merging the CONTRACT the model sees is what was asked for; merging the two
 * implementations into one switch would have produced a four-hundred-line function whose halves
 * never touch.
 *
 * So this file is the seam: one name, one schema, one classifier, and a dispatch on `target`.
 */

import type { AgentTool, AgentToolExecutionContext } from '@localixai/agent/agents'
import {
  buildApiToolSchema,
  resolveTarget,
  targetProblem,
  type ApiOperationInput,
} from './api-tool-schema'
import {
  UNKNOWN_CALL_CLASS,
  widestCallClass,
  type CallClass,
} from '@localixai/mini-app-sdk/backend'
import { classifyEnvironmentCall, classifyHttpRequestCall } from './call-class'
import { COLLECTION_DIR } from './collection/paths'
import { createHttpRequestTool, type HttpRequestDeps } from './http-request'
import { createManageEnvironmentTool } from './manage-environment'
import type { HttpRequestInput } from './http-request-schema'
import type { ManageEnvironmentInput } from './manage-environment-schema'
import { API_MINI_APP, API_WORKSPACE_CHANNEL } from './collection-command'

/** Kept as data so tests can pin the intent routing the model is expected to follow. */
export const API_TOOL_DESCRIPTION =
  'One API client for performing HTTP calls, saving reusable requests, and managing their environments. ' +
  'Choose by user intent: call/test/check/fetch now → action="send"; add/create/save for later → action="save" (save never sends); ' +
  'when the task needs two or more operations, make exactly ONE action="batch" call with all ordered operations — never call api_client once per request; ' +
  'save and test belongs in one batch as save then send with the same name; ' +
  'pasted cURL/OpenAPI/Postman/Insomnia/HAR → action="import" instead of transcribing it. ' +
  'For an immediate ad-hoc call, send with a url. For a saved call, send with its name; optional fields override the saved request for that call. ' +
  'Request actions are the default target. Add target="environment" only to list/get/save/delete/use environments; ' +
  'the active environment renders `{{variables}}` at send time. Literal credentials saved as secret environment variables or imported from source ' +
  'move into Localix native Vault; prefer `${secret:KEY}` when authoring credentials directly.'

const BATCH_CONTENT_LIMIT = 30_000
const BATCH_ITEM_CONTENT_LIMIT = 6_000

function batchItemLabel(operation: ApiOperationInput): string {
  const target = resolveTarget(operation)
  const name = typeof operation.name === 'string' ? operation.name.trim() : ''
  return `${operation.action} ${target}${name ? ` "${name}"` : ''}`
}

function boundedBatchContent(content: string): string {
  if (content.length <= BATCH_ITEM_CONTENT_LIMIT) return content
  return `${content.slice(0, BATCH_ITEM_CONTENT_LIMIT)}\n… (truncated in batch; use a response filter for a smaller exact result)`
}

function combinedNavigationDetails(results: Array<{ details?: unknown }>): unknown {
  const byUri = new Map<string, Record<string, unknown>>()
  for (const result of results) {
    const details = result.details
    if (!details || typeof details !== 'object') continue
    const value = details as Record<string, unknown>
    const candidates =
      value.type === 'ui.navigate.suggestions' && Array.isArray(value.suggestions)
        ? value.suggestions
        : value.type === 'ui.navigate' || typeof value.uri === 'string'
          ? [value]
          : []
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue
      const action = candidate as Record<string, unknown>
      if (typeof action.uri === 'string' && !byUri.has(action.uri)) byUri.set(action.uri, action)
    }
  }
  const suggestions = [...byUri.values()].slice(0, 10)
  return suggestions.length > 0 ? { type: 'ui.navigate.suggestions', suggestions } : undefined
}

export function createApiTool(deps: HttpRequestDeps): AgentTool {
  const { ctx } = deps
  // The two bodies, built once. Their own schemas are no longer model-facing — this tool's is —
  // but their `execute` remains the single owner of what each subject actually does.
  const requests = createHttpRequestTool(deps)
  const environments = createManageEnvironmentTool({
    ctx,
    environments: deps.environments,
    userId: deps.userId,
  })

  return ctx.defineTool({
    name: 'api_client',
    label: 'API client',
    activeVerb: 'Calling',
    // Requests are independent and cheap; environments touch one active-pointer. The stricter of
    // the two wins, because one tool cannot be two execution modes and a concurrent `use` racing
    // a `save` would decide the active environment by arrival order.
    executionMode: 'sequential',
    description: API_TOOL_DESCRIPTION,
    inputSchema: buildApiToolSchema(ctx.z),
    mutates: true,
    /**
     * A session id only exists in the execution context, after permission planning. When dynamic
     * scope resolution is enabled, declare the narrow common ancestor of every possible session
     * collection for mutations. Export remains project-scoped and can use the request body's exact
     * path. Standalone/unscoped tools keep delegating their exact legacy paths.
     */
    permissionPaths: (input) => {
      const call = (input ?? {}) as { target?: string }
      if ((input as { action?: unknown } | null)?.action === 'batch') {
        const operations = (input as { operations?: unknown } | null)?.operations
        if (!Array.isArray(operations)) return []
        return [
          ...new Set(
            operations.flatMap((operation) =>
              operation && typeof operation === 'object'
                ? (apiPermissionPaths(operation as Record<string, unknown>) ?? [])
                : [],
            ),
          ),
        ]
      }
      return apiPermissionPaths(call as Record<string, unknown>)
    },
    classify: classifyApiClientCall,

    async execute(
      toolCallId,
      input: Record<string, unknown>,
      signal?: AbortSignal,
      _onUpdate?: unknown,
      executionContext?: AgentToolExecutionContext,
    ) {
      // Plugin discovery is cached per project, while collections are owned by sessions. Resolve
      // once for the whole batch so every operation observes the same exact session scope.
      const scoped = deps.resolveScope
        ? await deps.resolveScope(executionContext?.session?.id)
        : null
      const requestTool = scoped
        ? createHttpRequestTool({ ...deps, ...scoped, resolveScope: undefined })
        : requests
      const environmentTool = scoped
        ? createManageEnvironmentTool({
            ctx,
            environments: scoped.environments,
            userId: deps.userId,
          })
        : environments

      const executeOne = async (operation: ApiOperationInput, callId: string) => {
        const action = operation.action
        const target = resolveTarget(operation)
        const problem = targetProblem(action, target)
        if (problem) return ctx.helpers.errorResult(problem)

        const savedSendName =
          target === 'request' && action === 'send' && typeof operation.name === 'string'
            ? operation.name.trim()
            : ''
        const emitSendPhase = (phase: 'started' | 'completed' | 'failed') => {
          if (!savedSendName) return
          executionContext?.session?.emitCommand?.(API_MINI_APP, API_WORKSPACE_CHANNEL, {
            type: 'request_send',
            name: savedSendName,
            phase,
          })
        }

        emitSendPhase('started')
        let result
        try {
          result =
            target === 'environment'
              ? await environmentTool.execute(
                  callId,
                  operation as unknown as ManageEnvironmentInput,
                  signal,
                  undefined,
                  executionContext,
                )
              : await requestTool.execute(
                  callId,
                  operation as unknown as HttpRequestInput,
                  signal,
                  undefined,
                  executionContext,
                )
          emitSendPhase(result.isError ? 'failed' : 'completed')
        } catch (error) {
          emitSendPhase('failed')
          throw error
        }

        const changed =
          target === 'environment'
            ? action === 'save' || action === 'use' || action === 'delete'
            : action === 'save' ||
              action === 'delete' ||
              (action === 'import' && operation.save === true)
        if (changed && !result.isError) {
          executionContext?.session?.emitCommand?.(API_MINI_APP, API_WORKSPACE_CHANNEL, {
            type: 'collection_changed',
            target,
            action,
          })
        }
        return result
      }

      if (input.action === 'batch') {
        const operations = input.operations
        if (!Array.isArray(operations) || operations.length === 0 || operations.length > 12) {
          return ctx.helpers.errorResult('action="batch" needs 1–12 operations.')
        }
        const results = []
        // Ordered on purpose: save→send and environment save→use are common dependencies. The
        // expensive model round trips are removed while filesystem/active-pointer semantics stay
        // deterministic.
        for (const [index, raw] of operations.entries()) {
          if (!raw || typeof raw !== 'object' || (raw as { action?: unknown }).action === 'batch') {
            results.push(ctx.helpers.errorResult(`Operation ${index + 1} is invalid.`))
            continue
          }
          results.push(await executeOne(raw as ApiOperationInput, `${toolCallId}:${index + 1}`))
        }
        const failures = results.filter((result) => result.isError).length
        const sections = results.map((result, index) => {
          const operation = operations[index] as ApiOperationInput
          return `[${index + 1}/${results.length}] ${result.isError ? '✗' : '✓'} ${batchItemLabel(operation)}\n${boundedBatchContent(result.content)}`
        })
        const summary = `Batch completed: ${results.length - failures} succeeded, ${failures} failed.`
        const content = `${summary}\n\n${sections.join('\n\n')}`
        const details = combinedNavigationDetails(results)
        return {
          content:
            content.length <= BATCH_CONTENT_LIMIT
              ? content
              : `${content.slice(0, BATCH_CONTENT_LIMIT)}\n… (batch output truncated)`,
          ...(failures === results.length ? { isError: true } : {}),
          ...(details ? { details } : {}),
        }
      }

      if (typeof input.action !== 'string' || input.action === 'batch') {
        return ctx.helpers.errorResult('Choose an action, or use action="batch" with operations.')
      }
      return executeOne(input as ApiOperationInput, toolCallId)
    },
  })

  function apiPermissionPaths(input: Record<string, unknown>): string[] {
    const call = input as { target?: string }
    const tool = resolveTarget(call) === 'environment' ? environments : requests
    const rawAction = (input as { action?: unknown } | null)?.action
    const action = typeof rawAction === 'string' ? rawAction : ''
    const writesSessionCollection =
      action !== 'list' &&
      action !== 'get' &&
      action !== 'send' &&
      action !== 'export' &&
      !(action === 'import' && !(input as { save?: unknown } | null)?.save)
    if (deps.resolveScope && writesSessionCollection) {
      // Relative on purpose: the host resolves declared paths against the executing session's
      // cwd. `ctx.cwd` can belong to the boot-time plugin load and would point permission rules
      // at a different workspace than execute ultimately mutates.
      return [COLLECTION_DIR]
    }
    return tool.permissionPaths?.(input) ?? []
  }
}

/**
 * One `api_client` call, routed to the classifier of the subject its `target` names (the same
 * `resolveTarget` default the body uses, so the two cannot disagree about an omitted target). A
 * batch is one call to the gate and answers the widest of its operations; a non-object
 * operation is unknown, so it widens the batch to `external`.
 */
export function classifyApiClientCall(input: unknown): CallClass {
  const call = (input ?? {}) as Record<string, unknown>
  if (call.action !== 'batch') return classifyApiOperation(call)
  const operations = Array.isArray(call.operations) ? call.operations : []
  return widestCallClass(
    operations.map((operation) =>
      operation && typeof operation === 'object'
        ? classifyApiOperation(operation as Record<string, unknown>)
        : UNKNOWN_CALL_CLASS,
    ),
  )
}

function classifyApiOperation(call: Record<string, unknown>): CallClass {
  return resolveTarget(call as { target?: string }) === 'environment'
    ? classifyEnvironmentCall(call)
    : classifyHttpRequestCall(call)
}
