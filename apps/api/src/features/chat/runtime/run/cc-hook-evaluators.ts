/**
 * The models a run's `prompt` and `agent` hooks ask (the kit's `ModelRunner`, through
 * `lateModelRunner`). The kit writes the prompt and reads the `{ok, reason}` verdict, and decides
 * what a failure means; this answers with the text: one aux-LLM call on the run's provider, or a
 * read-only verifier sub-agent over the delegate service. A throw is the kit's failure.
 *
 * Layer rule: run/ may import runtime infrastructure + agent-core, never features/chat/service*.
 */
import { agentRoute, sessionRoute } from '../../../../contracts/session-route'
import { TOOL } from '../../../agent-core/tool-names'
import { resolveModelAlias } from '../../../agent-core/model-alias'
import { resolveRunProfile, type RunProfile } from '../../../agent-core/run-shape'
import type { ModelBackend } from '../../../plugins/kit'
import type { SessionRecord } from '../../repository'
import { resolveLanguageModel } from '../model-resolution'
import { getAgentService } from '../agent-service-binding'
import { recordAuxCallUsage } from '../usage-normalize'
import { publishSessionUsageSnapshot } from '../session-usage'
import type { RunCatalog, RunEnv } from './types'
import { assistantText } from '../../../../lib/assistant-text'

export interface HookModelsInput {
  env: RunEnv
  userId: string
  session: SessionRecord
  agentId?: string
  catalog: RunCatalog
  /** The run's model: what a hook that names none, or an alias, resolves against. */
  effectiveModelId: string
}

function verifierProfile(): RunProfile {
  return resolveRunProfile(
    { sessionKind: 'job' },
    {
      prompt:
        'You are a hook policy verifier with read-only tools (read, search). Investigate as needed, ' +
        'then answer as the instructions ask. Do not modify anything.',
      tools: [TOOL.Read, TOOL.Search],
    },
  )
}

export function createHookModels(input: HookModelsInput): ModelBackend {
  const { env, userId, session, catalog, effectiveModelId } = input
  const route = input.agentId ? agentRoute(session) : sessionRoute(session)
  const modelOf = (named: string | undefined, parent: string) =>
    (named &&
      resolveModelAlias(
        named,
        parent,
        catalog.models.map((m) => m.id),
      )) ||
    parent
  const connection = () => {
    if (!route?.providerConnectionId) throw new Error('the session has no provider connection')
    return route.providerConnectionId
  }
  return {
    async complete(request) {
      const providerConnectionId = connection()
      const modelId = modelOf(request.model, effectiveModelId)
      const resolved = await resolveLanguageModel({
        deps: env.deps,
        userId,
        modelId,
        preferredConnectionId: providerConnectionId,
        catalog,
      })
      if (!resolved) throw new Error(`the model "${modelId}" is not available`)
      const message = await resolved.model.complete({
        systemPrompt: 'You are a hook policy evaluator. Answer exactly as the instructions ask.',
        messages: [{ role: 'user', content: request.prompt, timestamp: Date.now() }],
        temperature: 0,
        maxOutputTokens: 400,
        reasoningEffort: route?.reasoningEffort ?? 'off',
        signal: request.signal,
      })
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
      return assistantText(message.content)
    },

    async runAgent(request) {
      const svc = getAgentService()
      if (!svc) throw new Error('no agent service runs the verifier')
      const providerConnectionId = connection()
      const parentModelId = route?.modelId ?? effectiveModelId
      const child = await svc.createSession(userId, {
        title: 'Hook verifier',
        parentSessionId: session.id,
        sessionKind: 'job',
        sourceToolCallId: `cc-hook-agent-${Date.now()}`,
        provenance: { kind: 'hook', parentSessionId: session.id, phase: 'verifier' },
        providerConnectionId,
        modelId: modelOf(request.model, parentModelId) || undefined,
        projectId: session.projectId,
      })
      const stop = () => void Promise.resolve(svc.stopSession?.(child.id)).catch(() => {})
      // Cancelled while the child was being made: stop it before its run starts.
      if (request.signal.aborted) {
        stop()
        throw new Error('the hook was cancelled')
      }
      request.signal.addEventListener('abort', stop, { once: true })
      try {
        await svc.runJobTask(userId, child.id, request.prompt, {
          invocation: { kind: 'hook', parentSessionId: session.id },
          wait: true,
          profileOverride: verifierProfile(),
          maxTurns: request.maxTurns,
        })
        return (await svc.finalAssistantText?.(userId, child.id)) ?? ''
      } finally {
        request.signal.removeEventListener('abort', stop)
      }
    },
  }
}
