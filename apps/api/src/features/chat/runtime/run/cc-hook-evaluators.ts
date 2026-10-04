import { agentRoute, sessionRoute } from '../../session-route'
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
 * reply, a throw: all yield `{ ok: true }`. A hook is a policy check bolted onto a
 * turn; it must never be able to hard-fail that turn by breaking itself. Callers
 * therefore never need a try/catch around these.
 *
 * Fail-open is not the same as fail-SILENT, and the difference is the whole point of
 * the warnings below: a broken guardrail reports itself as an explicit allow, so the
 * one person who could fix it — the user who wrote the hook — otherwise has no signal
 * at all that their policy stopped running. Every fail-open path here says why.
 */
import type { AgentTool } from '@localixai/agent/agents'

import {
  parsePromptHookResult,
  type PromptHookResult,
  type CcMcpToolResult,
} from '../../../cc-hooks'
import type { LoadedPlugins } from '../../../plugins/loader'
import { TOOL } from '../../../agent-core/tool-names'
import { resolveRunProfile, type RunProfile } from '../../../agent-core/run-shape'
import type { SessionRecord } from '../../repository'
import { resolveLanguageModel } from '../model-resolution'
import { getAgentService } from '../agent-service-binding'
import { resolveMcpTools } from './mcp-tools'
import type { AvailabilityReader } from '../../../capabilities/availability'
import { recordAuxCallUsage } from '../usage-normalize'
import { publishSessionUsageSnapshot } from '../session-usage'
import type { RunCatalog, RunEnv } from './types'
import { assistantText } from '../../../../lib/assistant-text'
import { prefixedWarnLogger } from '../plugin-hook-logger'

/** One sink for every fail-open path in this module (see the header). */
const hookWarn = prefixedWarnLogger('cc-hook')

/** Options both LLM-backed evaluators take from the hook definition. */
interface HookEvalOptions {
  signal?: AbortSignal
  prompt: string
  inputJson: string
  model?: string
  timeoutMs: number
  maxTurns?: number
}

/** CC-hook name form (`mcp__server__tool`) → the engine's (`mcp_server_tool`). */
function normalizeMcpName(name: string): string {
  return name.replace(/^mcp__/, 'mcp_').replace(/__/g, '_')
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
  const route = input.agentId ? agentRoute(session, input.agentId) : sessionRoute(session)
  return async (opts) => {
    if (opts.signal?.aborted) return { ok: true }
    const providerConnectionId = route?.providerConnectionId
    if (!providerConnectionId) return { ok: true }
    const modelId = opts.model || effectiveModelId
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
    if (!resolved || opts.signal?.aborted) return { ok: true }
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
          '{"ok": boolean, "reason"?: string}. ok=true allows; ok=false blocks and the reason is shown. No other text.',
        messages: [
          {
            role: 'user',
            content: `${opts.prompt}\n\n${opts.inputJson}`,
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
      return { ok: true }
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * `agent` hooks. Reuses the delegate/subsession machinery — the same service the
 * delegate tool binds — to run a short-lived, READ-ONLY (read + search) child
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
      tools: [TOOL.read, TOOL.search],
    },
  )
}

export function createAgentHookRunner(input: {
  userId: string
  session: SessionRecord
  agentId?: string
}): (opts: HookEvalOptions) => Promise<PromptHookResult> {
  const { userId, session } = input
  const route = input.agentId ? agentRoute(session, input.agentId) : sessionRoute(session)
  return async (opts) => {
    if (opts.signal?.aborted) return { ok: true }
    const svc = getAgentService()
    if (!svc || !route?.providerConnectionId) return { ok: true }
    let child: { id: string }
    try {
      child = await svc.createSession(userId, {
        title: 'Hook verifier',
        parentSessionId: session.id,
        sessionKind: 'job',
        sourceToolCallId: `cc-hook-agent-${Date.now()}`,
        provenance: { kind: 'hook', parentSessionId: session.id, phase: 'verifier' },
        providerConnectionId: route.providerConnectionId,
        modelId: opts.model || route.modelId || undefined,
        projectId: session.projectId,
      })
    } catch (err) {
      hookWarn.warn(`agent hook could not open its verifier session — allowing: ${String(err)}`)
      return { ok: true }
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
      await svc.runJobTask(userId, child.id, `${opts.prompt}\n\n${opts.inputJson}`, {
        invocation: { kind: 'hook', parentSessionId: session.id },
        wait: true,
        profileOverride: verifierProfile(),
        maxTurns: opts.maxTurns ?? 50,
      })
      const text = (await svc.finalAssistantText?.(userId, child.id)) ?? ''
      return parsePromptHookResult(text)
    } catch (err) {
      hookWarn.warn(`agent hook verifier run failed — allowing: ${String(err)}`)
      return { ok: true }
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', stop)
    }
  }
}

/**
 * `mcp_tool` hooks. Call a CONNECTED MCP tool by full name (CC `mcp__server__tool`
 * or Localix `mcp_server_tool`) with the hook input as arguments. Built from the
 * same MCP resolution the run itself uses (process-lifetime client manager →
 * cached clients); the gather is MEMOIZED per run, so a per-tool-call hook does
 * not re-list servers on every fire.
 */
export function createMcpHookCaller(input: {
  env: RunEnv
  userId: string
  session: SessionRecord
  agentId?: string
  loadedPlugins: LoadedPlugins
  defaultCwd: string
  disabledTools: string[]
  /** What the run's rules say about its MCP servers. */
  availability: AvailabilityReader
}): (name: string, toolInput: unknown, signal?: AbortSignal) => Promise<CcMcpToolResult> {
  const { env, userId, session, loadedPlugins, defaultCwd, disabledTools, availability } = input
  let toolsPromise: Promise<AgentTool[]> | null = null

  return async (name, toolInput, signal) => {
    if (!toolsPromise) {
      toolsPromise = resolveMcpTools({
        env,
        userId,
        session,
        pluginMcpServers: loadedPlugins.mcpServers,
        defaultCwd,
        disabledTools,
        availability,
      })
        .then((r) => r.gather?.tools ?? [])
        .catch((err: unknown) => {
          hookWarn.warn(`mcp_tool hook could not resolve MCP tools: ${String(err)}`)
          return []
        })
    }
    const tools = await toolsPromise
    const target = normalizeMcpName(name)
    const tool = tools.find(
      (t) => t.name === name || t.name === target || normalizeMcpName(t.name) === target,
    )
    if (!tool) return { notConnected: true }
    try {
      const result = await tool.execute('cc-hook-mcp', toolInput, signal)
      const text =
        typeof result.content === 'string' ? result.content : String(result.content ?? '')
      return { text, isError: result.isError === true }
    } catch (err) {
      // The tool IS connected — it ran and threw. Reporting that as `notConnected`
      // sends the operator hunting a server outage; the caller contract is only that
      // this never throws, so hand back the failure as what it is.
      return { text: err instanceof Error ? err.message : String(err), isError: true }
    }
  }
}
