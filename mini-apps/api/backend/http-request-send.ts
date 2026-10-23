import type { AgentToolExecutionContext } from '@localixai/agent/agents'
import type { HttpRequestDeps } from './http-request'
import type { HttpRequestInput } from './http-request-schema'
import type { RequestSpec } from './request-spec'
import { specForSend } from './input-to-spec'
import { isHttpUrl } from './request-url-policy'
import { renderEnvironmentForSend } from './render-environment'
import { missingVarsProblem } from './render-spec'
import { resolveAuthSecrets } from './secrets'
import { RequestTimeoutError, sendRequest } from './send'
import { recordSend } from './history'
import { formatResponse } from './format-response'

interface HttpSendDeps extends Pick<
  HttpRequestDeps,
  'ctx' | 'store' | 'environments' | 'resolveSecret' | 'userId'
> {
  timeoutMs: number
  maxBodyBytes: number
  allowPrivateNetwork: boolean
  openRequest: (
    name: string,
    description: string,
  ) => ReturnType<HttpRequestDeps['ctx']['ui']['offer']>
}

/** Execute a validated send against the captured tool configuration and services. */
export function createHttpSendAction(deps: HttpSendDeps) {
  const {
    ctx,
    store,
    environments,
    resolveSecret,
    userId,
    timeoutMs,
    maxBodyBytes,
    allowPrivateNetwork,
    openRequest,
  } = deps

  /** The spec a `send` should use. The decision is `specForSend`'s; the store lookup is ours. */
  async function resolveSpec(input: HttpRequestInput): Promise<RequestSpec | string> {
    const name = input.name?.trim()
    const saved = name ? await store.get(name) : null
    return specForSend(input, saved)
  }

  return async (
    input: HttpRequestInput,
    signal?: AbortSignal,
    executionContext?: AgentToolExecutionContext,
  ) => {
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
        recordSend(userId, savedName, res, 'agent', observable, executionContext?.session?.id)
      }
      return {
        content: formatResponse(observable, res, input.filter),
        // Only a SAVED send has somewhere to land: the tab reads the history ring this
        // send just wrote, so the button shows the very response the model is reporting.
        ...(savedName
          ? {
              details: openRequest(savedName, `Open the ${res.status} response in API Client`),
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
