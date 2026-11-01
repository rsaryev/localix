// How the `browser` tool sends a resolved action to the open tab: vault references resolved for
// the wire copy only, the tab's secret taint checked and taught (browser-taint.ts), a lifted
// trailing screenshot run as its steps then the picture, and a failed relay folded into one
// result. Split from browser.ts, which keeps the tool's contract and dispatch.

import type { PreviewAction, PreviewSendOutcome } from '../preview/preview-control'
import { TAKE_SCREENSHOT, buildPreviewCommand, type ResolvedInput } from './browser-input'
import { snapshotContent } from './browser-format'
import { formatReply } from './browser-reply'
import { relayTimeoutMs } from './browser-wait'
import { TAINT_REFUSAL, type createTabTaint } from './browser-taint'
import { prepareSecretSteps } from './browser-secrets'
import type { ActionOutcome, BrowserToolDeps, ToolResult } from './browser-types'

export function createRelay(deps: BrowserToolDeps, taint: ReturnType<typeof createTabTaint>) {
  /** A relay that failed. A self-healed failure (stale ref / covered target) rides a
   *  FRESH snapshot back — fold it into the error so the agent retargets in the SAME
   *  turn instead of spending a call to re-snapshot (the re-snapshot churn trap). */
  function relayFailure(
    action: PreviewAction,
    outcome: Extract<PreviewSendOutcome, { ok: false }>,
  ): ActionOutcome {
    const recovered = outcome.result
    const reloaded = recovered?.reloaded
    if (recovered?.snapshot) {
      return {
        reloaded,
        result: {
          content: `${outcome.error}\n\n${snapshotContent(recovered)}`,
          isError: true,
          details: { action, snapshot: recovered.snapshot },
          supersedeKey: 'browser',
        },
      }
    }
    return {
      reloaded,
      result: {
        content: `${outcome.errorCode && outcome.errorCode !== 'failed' ? `${outcome.errorCode}: ` : ''}${outcome.error}`,
        isError: true,
        details: {
          action,
          errorCode: outcome.errorCode,
          error: outcome.error,
          previewId: recovered?.previewId,
          viewport: recovered?.viewport,
        },
      },
    }
  }

  /** A relayed action with its typed vault references resolved and its reply shielded. */
  async function secured(input: ResolvedInput): Promise<ActionOutcome> {
    // Typed vault references resolve for the relay only; the page's reply is shielded.
    const prepared = await prepareSecretSteps(input, deps.secrets)
    if (!prepared.ok) return { result: { content: prepared.error, isError: true } }
    // A tab that was typed a secret refuses what could expose it (see browser-taint.ts).
    const evaluating = input.steps?.some((step) => step.action === 'evaluate')
    if (taint.refuses(input) || (prepared.typedSecret && evaluating))
      return { result: { content: TAINT_REFUSAL, isError: true } }
    const outcome = await relayResolved(input, prepared.input, prepared.typedSecret)
    return { ...outcome, result: prepared.shield(outcome.result) }
  }

  /** Teach the taint what a finished call showed: the tab's URL, and whether it was typed a secret. */
  function settle(input: ResolvedInput, result: ToolResult, typed: boolean) {
    taint.settle(
      input,
      { previewId: result.details?.previewId, url: result.details?.snapshot?.url },
      typed,
    )
  }

  /** `wire` is `input` with its typed references resolved: the only copy that reaches the page. */
  async function relayResolved(
    input: ResolvedInput,
    wire: ResolvedInput,
    typed: boolean,
  ): Promise<ActionOutcome> {
    const outcome = await relayWire(input, wire, typed)
    // The photograph is refused, not the typing: the steps before it already ran.
    settle(input, outcome.result, typed)
    return outcome
  }

  async function relayWire(
    input: ResolvedInput,
    wire: ResolvedInput,
    typed: boolean,
  ): Promise<ActionOutcome> {
    // ACT, THEN LOOK, in one call. A batch that ended in a screenshot arrives here as a
    // screenshot carrying the steps before it (`liftTrailingScreenshot`), because a batch
    // result is text and only the call's own result can be an image. The steps run first and
    // their failure is the call's failure: photographing a page whose setup did not happen
    // returns a picture of the wrong thing, which is worse than an error.
    if (input.action === TAKE_SCREENSHOT && input.steps?.length) {
      const setupTimeout = relayTimeoutMs(input)
      const setup = await deps.send(
        buildPreviewCommand({ ...wire, action: 'steps' }),
        setupTimeout === undefined ? undefined : { timeoutMs: setupTimeout },
      )
      if ('error' in setup) return relayFailure('steps', setup)
      if (typed)
        return {
          result: {
            content: `The steps ran and typed the secret. The screenshot was not taken. ${TAINT_REFUSAL}`,
            isError: true,
            details: {
              action: 'steps',
              previewId: setup.result.previewId,
              snapshot: setup.result.snapshot,
            },
          },
        }
    }

    const timeoutMs = relayTimeoutMs(input)
    const outcome = await deps.send(
      buildPreviewCommand(wire),
      timeoutMs === undefined ? undefined : { timeoutMs },
    )
    if ('error' in outcome) return relayFailure(input.action as PreviewAction, outcome)
    return {
      reloaded: outcome.result.reloaded,
      result: await formatReply(input, outcome.result, deps),
    }
  }

  return { secured, relayFailure }
}
