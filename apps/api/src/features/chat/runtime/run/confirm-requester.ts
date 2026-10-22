import type {
  ConfirmToolRequest,
  ConfirmToolResponse,
} from '../../../agent-core/tools/hitl/confirm'
import type { ConfirmOutcome, RequestConfirmArgs } from '../../../agent-core/permission-engine'
import { runHitlRequestHooks, runHitlResolvedHooks } from '../../../plugins/hooks'
import type { RunHookContext } from './run-hook-context'
import { isDangerous } from '../../../agent-core/tools/bash/bash-command-safety'
import { grantCoversCall } from '../../../agent-core/permission-grant-scope'
import { surfaceConfirmRequest } from '../hitl-confirm'
import { isHitlTimeout } from '../../../agent-core/tools/hitl/decision-deadline'
import { reachableHitlTarget } from './hitl-reachable'
import { grantedScopes, grantScope as recordGrant } from '../session-grants'
import { confirmTitle, readConfirmAnswer, wireGrants } from './confirm-answer'
import { hostPolicy } from '../../policy/session-policy'
import { hookConfirmOutcome, raceCardWithPermissionHooks } from './permission-request-hook'

/**
 * Builds the per-run "request a tool-approval confirm" function: tracks the
 * HITL request, streams it to the right (parent) session, fires plugin
 * onHitlRequest/onHitlResolved hooks, and resolves to the user's decision.
 * Extracted from event-handlers.ts — it is a self-contained HITL concern.
 */
export function createConfirmRequester(
  args: RunHookContext & {
    abortSignal: AbortSignal
    /** The run's closed-wait ledger (`RunTurnState.hitlWaitedMs`): approval time, not tool time. */
    hitlWaitedMs?: Map<string, number>
    /** Stop the run: a PermissionRequest hook's deny with `interrupt: true`. */
    stopRun?: () => void
  },
) {
  const { env, userId, session, assistantMessageId, ccHooks } = args
  return async (
    confirmArgs: RequestConfirmArgs,
    call?: { input: unknown },
  ): Promise<ConfirmOutcome> => {
    // Missing ancestors, cycles, ownership mismatches and parentless automation jobs
    // all mean "no human will see this card" — one shared rule, also used to set
    // `context.interactive` for tools that self-gate (see run/hitl-reachable.ts).
    const targetSessionId = reachableHitlTarget({
      sessionKind: session.sessionKind,
      sessionId: session.id,
      hitlTargetSessionId: args.hitlTargetSessionId,
    })
    if (!targetSessionId) return false
    // "Always allow" short-circuit: if the user already approved this tool for
    // the whole session, auto-approve without surfacing another card. The
    // `session-grant` provenance lets the gate mark the tool item so the UI can
    // explain WHY no confirm was shown (revocable via the permissions chip).
    // A grant is scoped to the SUBJECT the card showed — a program, a path, a folder — not to
    // the tool; see permission-grant-scope.ts. Independently of that, a grant never covers a
    // command the gate itself calls DANGEROUS: a destructive call gets its own card whatever
    // was granted earlier.
    const dangerousCall =
      confirmArgs.subject !== 'path' &&
      confirmArgs.subject !== 'resource' &&
      !!confirmArgs.command &&
      isDangerous(confirmArgs.command)
    // The requester is THIS run — its own session and agent — so a grant one participant or one
    // sub-agent was given never approves another (see `session-grants.ts`).
    const requester = { sessionId: session.id, agentId: args.agentId }
    const granted = grantedScopes(env.state.sessionAutoApprovedTools, targetSessionId, requester)
    if (!dangerousCall && [...granted].some((scope) => grantCoversCall(scope, confirmArgs))) {
      return { approved: true, via: 'session-grant' }
    }
    const sourceTitle =
      confirmArgs.sourceTitle?.trim() ||
      (hostPolicy(session).presentsAsSubagent ? session.title : undefined)
    const toolName = sourceTitle ? `sub-agent · ${confirmArgs.toolName}` : confirmArgs.toolName
    // The act and its object ("Read useTheme.ts"); who asked is the line under it.
    const title = confirmTitle(confirmArgs)
    // A persistent rule lives on the AGENT whose turn raised the card — rules have no other
    // scope — so it can be written whenever the call reduces to a grant, project or not. A
    // host that cannot persist (no port) offers the same breadths for the session only.
    const offered = (confirmArgs.grants ?? []).map((grant) =>
      grant.rule && !env.deps.persistPermissionRule ? { ...grant, rule: undefined } : grant,
    )
    const payload = {
      command: confirmArgs.command ?? confirmArgs.toolName,
      ...(confirmArgs.subject ? { subject: confirmArgs.subject } : {}),
      // A shell call runs somewhere; a file call already names where in its own path, and a
      // working directory under it is a second answer to a question nobody asked.
      ...(confirmArgs.subject === 'command' || confirmArgs.subject === undefined
        ? { cwd: confirmArgs.cwd }
        : {}),
      // The matched rule's own words, when it carried any. A sub-agent's card used to replace
      // them with `Sub-agent "X" wants to: …`, and the client then replaced THAT with a fixed
      // "Run this sub-agent" — so the reason was lost twice. Who asked is its own field.
      ...(confirmArgs.message ? { description: confirmArgs.message } : {}),
      ...(sourceTitle ? { sourceKind: 'subagent' as const, sourceTitle } : {}),
      // The breadths an answer may widen to — only the ones this host will honour, so a card
      // with none offers neither "This session" nor "Always" (see `ConfirmToolPayload.grants`).
      ...(offered.length > 0 ? { grants: wireGrants(offered) } : {}),
    }
    const request = surfaceConfirmRequest({
      hitlRegistry: env.deps.hitlRegistry,
      streamRegistry: env.deps.streamRegistry,
      userId,
      sessionId: targetSessionId,
      sourceSessionId: session.id,
      messageId: assistantMessageId,
      toolCallId: confirmArgs.toolCallId,
      toolName,
      title,
      payload,
    })
    const requestId = request.id
    // `surfaceConfirmRequest` returns the SHOWN request — its payload has been through the vault
    // shield — so the plugin hook below hands third-party code the same redacted copy the client got,
    // not the raw `payload` this function built from `call.command`.
    const shownPayload = request.payload
    // CC Notification hook — the agent needs the user to approve a tool call
    // (CC's `permission_prompt` notification type). Observer-only, fire-and-forget.
    // The message is shielded as well: a gate is free to compose it from the command.
    const notificationMessage = `${toolName} needs approval: ${confirmArgs.message ?? payload.command}`
    void ccHooks
      .runNotification({
        message:
          (env.deps.sanitizeToolInput?.(userId, notificationMessage) as string | undefined) ??
          notificationMessage,
        notificationType: 'permission_prompt',
        title,
      })
      .catch(() => {})
    const fireHitlResolved = (outcome: { response: unknown } | { dismissed: true }) => {
      if (args.pluginHooksForRun.length === 0) return
      void runHitlResolvedHooks(
        args.pluginHooksForRun,
        { sessionId: session.id, requestId, kind: 'confirm', toolName, ...outcome },
        args.hookRunOptions,
      )
    }
    if (args.pluginHooksForRun.length > 0) {
      void runHitlRequestHooks(
        args.pluginHooksForRun,
        {
          sessionId: session.id,
          requestId,
          kind: 'confirm',
          toolName,
          title,
          payload: shownPayload,
        },
        args.hookRunOptions,
      )
    }
    // From here until the answer the run is waiting on a person, not on the tool. The wait
    // CLOSES before the tool runs, so it is booked as a settled span the tool-end handler adds
    // to HITL time and subtracts from the tool's own duration.
    const waitStartedAt = Date.now()
    // The card lives as long as both the run and the call that raised it: a script's nested call
    // ends with its script, while the run goes on.
    const signal = confirmArgs.signal
      ? AbortSignal.any([args.abortSignal, confirmArgs.signal])
      : args.abortSignal
    try {
      // CC PermissionRequest hooks run beside the card; whichever decides first applies.
      const raced = await raceCardWithPermissionHooks(
        ccHooks,
        { toolName: confirmArgs.toolName, input: call?.input },
        signal,
        (cardSignal) =>
          env.deps.hitlRegistry.controller.request<ConfirmToolRequest, ConfirmToolResponse>(
            request,
            cardSignal,
          ),
      )
      if (raced.kind === 'hook') {
        fireHitlResolved({ dismissed: true })
        return hookConfirmOutcome(ccHooks, confirmArgs.toolCallId, raced.decision, args.stopRun)
      }
      const response = raced.value
      // An answer to a withdrawn card approves nothing and records no grant or rule.
      if (signal.aborted) throw signal.reason
      fireHitlResolved({ response: response.payload.answers })
      // Re-read against what THIS card offered: the answer is client input, and a grant id it
      // did not list widens nothing (see `confirm-answer.ts`).
      const answer = readConfirmAnswer(response.payload.answers, offered)
      const { confirmed, grant } = answer
      const reply = answer.message ? { message: answer.message } : {}
      // "Always" → a row in `capability_rule` for the agent that asked, which outlives the
      // process and is visible and revocable in Settings. The key is `args.agentId`: the rule
      // repository is keyed by agent, and a rule stored under any other id is never read. It is
      // written BEFORE the session grant, and a failed write withholds that grant too, so the
      // user is asked again instead of believing a permanent answer that nothing recorded.
      let persistFailed = false
      if (confirmed && answer.scope === 'always' && grant?.rule) {
        try {
          await env.deps.persistPermissionRule?.(userId, args.agentId, grant.rule)
        } catch (error) {
          persistFailed = true
          args.hookRunOptions.logger.warn(
            `[permissions] "Always" rule not saved for ${args.agentId}: ${String(error)}`,
          )
        }
      }
      // "This session" (and "Always", for the rest of this turn) → remember the chosen breadth
      // so later confirms it covers auto-approve (see RuntimeState.sessionAutoApprovedTools).
      // No offered grant — an interpreter, a chained line, a credential path — means the
      // approval covers this one call and the next one asks again.
      if (confirmed && !persistFailed && grant) {
        const listed = recordGrant(
          env.state.sessionAutoApprovedTools,
          targetSessionId,
          requester,
          grant.scope,
        )
        // Surface the new grant so the composer permissions chip can show + revoke it.
        env.deps.streamRegistry.publish(userId, targetSessionId, {
          type: 'session_permissions.updated',
          sessionId: targetSessionId,
          autoApprovedTools: listed,
        })
      }
      return { approved: confirmed, via: 'user', ...reply }
    } catch (error) {
      fireHitlResolved({ dismissed: true })
      // A dismissal is a person closing the card; a timeout is nobody being there. Both refuse
      // the call, and the gate says which to the model in different words.
      return { approved: false, via: isHitlTimeout(error) ? 'timeout' : 'user' }
    } finally {
      env.deps.hitlRegistry.clearRequest(requestId)
      const ledger = args.hitlWaitedMs
      if (ledger) {
        ledger.set(
          confirmArgs.toolCallId,
          (ledger.get(confirmArgs.toolCallId) ?? 0) + Math.max(0, Date.now() - waitStartedAt),
        )
      }
    }
  }
}
