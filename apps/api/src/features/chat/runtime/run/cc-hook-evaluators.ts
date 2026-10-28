import { agentRoute, sessionRoute } from '../../../../contracts/session-route'
/**
 * The three ways a Claude Code hook can reach a VERDICT.
 *
 * A `command` hook is just a shell exit code and needs nothing from us. The other
 * three kinds each need a whole machine, and this module owns all three:
 *
 *  - `prompt`   → one non-streaming aux-LLM call ({ok, reason}).
 *  - `agent`    → a bounded, read-only verifier SUB-AGENT over the delegate service.
 *  - `mcp_tool` → a call into a CONNECTED MCP tool, folding its text like stdout.
 *
 * INVARIANT — every one of them FAILS OPEN. A missing provider, a timeout, a bad
 * reply, a throw: all yield `{ ok: true }`. The hook page names no fail-closed rule for a
 * prompt or agent hook, and a hook is a policy check bolted onto a turn; it must never be able
 * to hard-fail that turn by breaking itself. Callers therefore never need a try/catch around
 * these.
 *
 * Fail-open is not the same as fail-SILENT, and the difference is the whole point of
 * the `failed` marker: a broken guardrail would otherwise report itself as an explicit allow,
 * so the one person who could fix it — the user who wrote the hook — has no signal at all
 * that their policy stopped running. Every fail-open path here sets `failed` (the run shows a
 * hook error line) and logs why. A cancelled run is not a failure.
 */

import { hookPromptText, parsePromptHookResult, type PromptHookResult } from '../../../cc-hooks'
import { TOOL } from '../../../agent-core/tool-names'
import { resolveModelAlias } from '../../../agent-core/model-alias'
import { resolveRunProfile, type RunProfile } from '../../../agent-core/run-shape'
import type { SessionRecord } from '../../repository'
import { resolveLanguageModel } from '../model-resolution'
import { getAgentService } from '../agent-service-binding'
import { recordAuxCallUsage } from '../usage-normalize'
import { publishSessionUsageSnapshot } from '../session-usage'
import type { RunCatalog, RunEnv } from './types'
import { assistantText } from '../../../../lib/assistant-text'
import { prefixedWarnLogger } from '../plugin-hook-logger'

/** One sink for every fail-open path in this module (see the header). */
const hookWarn = prefixedWarnLogger('cc-hook')

/** An allow that says it is no verdict: the hook could not run, so the person is told. */
function failedOpen(why: string): PromptHookResult {
  return { ok: true, failed: why }
}

/** Options both LLM-backed evaluators take from the hook definition. */
interface HookEvalOptions {
  signal?: AbortSignal
  prompt: string
  inputJson: string
  model?: string
  timeoutMs: number
  maxTurns?: number
}

/**
 * `prompt` hooks use the hook's explicit model override or the session model.
 * One `complete` call, no streaming, no tools.
 */
export function createPromptHookEvaluator(input: {
  env: RunEnv
  userId: string
  session: SessionRecord
  agentId?: string
  catalog: RunCatalog
  effectiveModelId: string
}): (opts: HookEvalOptions) => Promise<PromptHookResult> {
  const { env, userId, session, catalog, effectiveModelId } = input
  const route = input.agentId ? agentRoute(session) : sessionRoute(session)
  return async (opts) => {
    if (opts.signal?.aborted) return { ok: true }
    const providerConnectionId = route?.providerConnectionId
    if (!providerConnectionId) return failedOpen('prompt hook has no provider connection to ask')
    // `haiku`, `sonnet`, `opus` are families, not catalog ids: the session model when it is of
    // that family, else the newest one the catalog lists.
    const modelId =
      resolveModelAlias(
        opts.model,
        effectiveModelId,
        catalog.models.map((m) => m.id),
      ) ?? effectiveModelId
    const resolved = await resolveLanguageModel({
      deps: env.deps,
      userId,
      modelId,
      preferredConnectionId: providerConnectionId,
      catalog,
    }).catch((err: unknown) => {
      hookWarn.warn(`prompt hook could not resolve model "${modelId}" — allowing: ${String(err)}`)
      return null
    })
    if (opts.signal?.aborted) return { ok: true }
    if (!resolved) return failedOpen(`prompt hook could not use the model "${modelId}"`)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
    try {
      const message = await resolved.model.complete({
        // Verbatim: the two evaluators' prompts share a sentence, but they are
        // deliberately NOT factored into a shared constant — the fragments read
        // differently around it ("reply with ONLY …" vs "end your FINAL message
        // with ONLY …"), and a prompt is behavior.
        systemPrompt:
          'You are a hook policy evaluator. Read the instruction and the event JSON, then reply with ONLY a JSON object ' +
          '{"ok": boolean, "reason"?: string, "impossible"?: boolean}. ok=true allows; ok=false blocks and the reason is shown. ' +
          'Add "impossible": true to an ok=false only when the condition can never be satisfied. No other text.',
        messages: [
          {
            role: 'user',
            content: hookPromptText(opts.prompt, opts.inputJson),
            timestamp: Date.now(),
          },
        ],
        temperature: 0,
        maxOutputTokens: 400,
        reasoningEffort: route?.reasoningEffort ?? 'off',
        signal: opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal,
      })
      // A hook verdict is a real, billed call on the user's key, and a `prompt` hook on
      // PreToolUse fires once per TOOL CALL — so it can easily outspend the turns it
      // guards. Unattributed, that shows up as an unexplained gap between the dashboard
      // and the provider bill. Fire-and-forget, like every other aux ledger write: the
      // fail-open invariant above must hold even if the ledger is unavailable.
      recordAuxCallUsage({
        usageRepo: env.usageRepo,
        userId,
        sessionId: session.id,
        modelId,
        providerConnectionId: resolved.providerConnectionId,
        providerId: resolved.entry.id,
        kind: 'hook',
        usage: message.usage,
        onRecorded: () =>
          publishSessionUsageSnapshot({
            repo: env.repo,
            usageRepo: env.usageRepo,
            streamRegistry: env.deps.streamRegistry,
            userId,
            sessionId: session.id,
          }),
      })
      return parsePromptHookResult(assistantText(message.content))
    } catch (err) {
      hookWarn.warn(`prompt hook evaluation failed — allowing: ${String(err)}`)
      return failedOpen(`prompt hook evaluation failed: ${String(err)}`)
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * `agent` hooks. Reuses the subagent machinery — the same service the
 * `Agent` tool binds — to run a short-lived, READ-ONLY (read + search) child
 * session to completion under a turn cap + timeout, then parses its final text.
 */
/**
 * The verifier's whole identity: read-only tools and a verdict-only instruction.
 *
 * It is resolved here, by the one caller that knows what a verifier is, rather than handed to
 * the run as loose `rolePrompt`/`agentTools` fields — those made every job turn carry a second,
 * partial way to say "which profile", and the runner had to rebuild a profile from them.
 */
function verifierProfile(): RunProfile {
  return resolveRunProfile(
    { sessionKind: 'job' },
    {
      prompt:
        'You are a hook policy verifier with read-only tools (read, search). Investigate as needed, ' +
        'then end your FINAL message with ONLY a JSON object {"ok": boolean, "reason"?: string} — ' +
        '"reason" is shown to the user when ok is false. Do not modify anything.',
      tools: [TOOL.Read, TOOL.Search],
    },
  )
}

export function createAgentHookRunner(input: {
  userId: string
  session: SessionRecord
  agentId?: string
  /** With the session's model: what a `haiku`/`sonnet`/`opus` alias in the hook resolves against. */
  catalog?: RunCatalog
  effectiveModelId?: string
}): (opts: HookEvalOptions) => Promise<PromptHookResult> {
  const { userId, session } = input
  const route = input.agentId ? agentRoute(session) : sessionRoute(session)
  return async (opts) => {
    if (opts.signal?.aborted) return { ok: true }
    const svc = getAgentService()
    if (!svc || !route?.providerConnectionId)
      return failedOpen('agent hook has no provider connection to run its verifier on')
    const parentModelId = route.modelId ?? input.effectiveModelId ?? undefined
    const modelId = opts.model
      ? resolveModelAlias(
          opts.model,
          parentModelId,
          input.catalog?.models.map((m) => m.id),
        )
      : parentModelId
    let child: { id: string }
    try {
      child = await svc.createSession(userId, {
        title: 'Hook verifier',
        parentSessionId: session.id,
        sessionKind: 'job',
        sourceToolCallId: `cc-hook-agent-${Date.now()}`,
        provenance: { kind: 'hook', parentSessionId: session.id, phase: 'verifier' },
        providerConnectionId: route.providerConnectionId,
        modelId: modelId || undefined,
        projectId: session.projectId,
      })
    } catch (err) {
      hookWarn.warn(`agent hook could not open its verifier session — allowing: ${String(err)}`)
      return failedOpen(`agent hook could not open its verifier session: ${String(err)}`)
    }
    const stop = () => {
      void Promise.resolve()
        .then(() => svc.stopSession?.(child.id))
        .catch(() => {})
    }
    const timer = setTimeout(stop, opts.timeoutMs)
    opts.signal?.addEventListener('abort', stop, { once: true })
    try {
      if (opts.signal?.aborted) {
        stop()
        return { ok: true }
      }
      await svc.runJobTask(userId, child.id, hookPromptText(opts.prompt, opts.inputJson), {
        invocation: { kind: 'hook', parentSessionId: session.id },
        wait: true,
        profileOverride: verifierProfile(),
        maxTurns: opts.maxTurns ?? 50,
      })
      const text = (await svc.finalAssistantText?.(userId, child.id)) ?? ''
      return parsePromptHookResult(text)
    } catch (err) {
      hookWarn.warn(`agent hook verifier run failed — allowing: ${String(err)}`)
      return failedOpen(`agent hook verifier run failed: ${String(err)}`)
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', stop)
    }
  }
}

export { createMcpHookCaller } from './mcp-hook-caller'
