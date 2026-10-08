import type { z } from 'zod'
import { defineAgentTool, type AgentTool, type AgentToolResult } from '@localixai/agent/agents'
import { TOOL } from '../../tool-names'
import type {
  PreviewAction,
  PreviewCommand,
  PreviewConsoleEntry,
  PreviewSendOutcome,
  PreviewSnapshot,
} from '../preview/preview-control'
import type { OpenPreviewCoreInput, OpenPreviewCoreResult } from '../preview/open-preview'
import {
  BROWSER_DESCRIPTION,
  MISSING_ACTION_MESSAGE,
  TAKE_SCREENSHOT,
  buildPreviewCommand,
  browserInputSchema,
  textOnlyBrowserInputSchema,
  inferAction,
  missingFieldMessage,
  prepareBrowserArguments,
  type BrowserInput,
  type ResolvedInput,
} from './browser-input'
import { classifyBrowserCall } from './browser-classify'
import { RELOAD_NOTICE, snapshotContent } from './browser-format'
import { openPreviewAndSnapshot } from './browser-open'
import { formatReply } from './browser-reply'

/**
 * `browser` — lets the agent DRIVE the Browser tabs the user has open, local previews and
 * remote sites alike: read the page as an accessibility snapshot (`@eN` refs),
 * click/type/press/scroll/hover on an element (as `steps`), screenshot an element, or read
 * console output. One tool, an `action` enum, a FLAT schema (see browser-input.ts).
 * Targeting is by `ref` (from the latest snapshot) or CSS `selector`.
 *
 * The tool is thin: it relays the command to the open tab via the injected
 * `PreviewControl` capability (a server→host→probe round-trip) and shapes the
 * reply (see browser-reply.ts). Screenshots come back as an image content
 * part for vision models.
 */

/**
 * The minimal remembered preview target this tool reads via injected deps. A local
 * shape — agent-core must NOT import the chat-runtime registry that owns it (the
 * boundary stays one-way; the host binds plain function deps below).
 */
export interface BrowserTarget {
  previewId?: string
  background?: boolean
  url?: string
  title?: string
  startCommand?: string
  startCwd?: string
  /** Whether the preview has already been opened for the current URL. */
  opened: boolean
}

/** Uniform UI detail shape across all actions (read by the tool card). The `open`
 *  and `close` actions are tool-only (never relayed to the probe), so they widen the
 *  relay-facing `PreviewAction` here without leaking into the probe protocol. */
export interface BrowserDetails {
  errorCode?: string
  error?: string
  previewId?: string
  ready?: boolean
  viewport?: { width: number; height: number }
  action: PreviewAction | 'open' | 'close'
  snapshot?: PreviewSnapshot
  console?: PreviewConsoleEntry[]
  rect?: { x: number; y: number; width: number; height: number } | null
  target?: string
  diff?: string
  value?: string
}

export interface BrowserToolDeps {
  /** Relay one command to the open preview, bound to this user + session.
   *  `opts.timeoutMs` bounds a BEST-EFFORT relay (the snapshot folded into an `open`
   *  result) so it doesn't freeze for the full default window when no probe is
   *  attached (an unattended/headless run). */
  send(command: PreviewCommand, opts?: { timeoutMs?: number }): Promise<PreviewSendOutcome>
  /** Open (or refresh) a preview — delegates to the shared `openPreviewCore`. */
  openPreview(input: OpenPreviewCoreInput): Promise<OpenPreviewCoreResult>
  /** The session's remembered preview target (for lazy auto-open before driving). */
  getTarget(): BrowserTarget | undefined
  /** Record the just-opened/resolved URL as the session's preview target. */
  recordTarget(input: {
    url?: string
    title?: string
    startCommand?: string
    startCwd?: string
  }): void
  /** Mark the current target as opened (after a successful open). */
  markOpened(): void
  /**
   * Close the preview: tell the UI to close the session's preview tab(s) AND forget
   * the remembered target so a later drive action won't auto-reopen it. Tool-only —
   * never relayed to the probe (a plain function dep; agent-core stays agnostic of
   * the stream registry + target registry that back it).
   */
  closePreview(previewIds: string[]): void
}

type ToolResult = AgentToolResult<BrowserDetails>

/** A finished action, plus whether the probe reported the page reloaded under us. */
interface ActionOutcome {
  result: ToolResult
  reloaded?: boolean
}

export function createBrowserTool(deps: BrowserToolDeps) {
  /** Lazy auto-open: a target exists but hasn't been opened yet (e.g. background bash
   *  just recorded a fresh dev-server URL). Idempotent (the UI dedups by origin). */
  async function ensurePreview(previewId?: string) {
    const target = deps.getTarget()
    if (previewId && target?.previewId !== previewId) return
    if (target?.url && !target.opened) {
      await deps.openPreview({
        url: target.url,
        start_command: target.startCommand,
        start_cwd: target.startCwd,
        title: target.title,
        background: target.background,
      })
      deps.markOpened()
    }
  }

  /** Relay the command, reopening + retrying ONCE when the preview isn't engaged
   *  (usually a closed tab or a restarted server). */
  async function relay(command: PreviewCommand): Promise<PreviewSendOutcome> {
    await ensurePreview(command.previewId)
    const outcome = await deps.send(command)
    // New hosts report a precise cause. In particular, a timeout does not prove
    // that a click did not happen; never reopen and execute it twice.
    if (!('error' in outcome)) return outcome
    if (!outcome.notEngaged || outcome.errorCode) return outcome
    const target = deps.getTarget()
    if (!target?.url) return outcome
    if (command.previewId && target.previewId !== command.previewId) return outcome
    await deps.openPreview({
      url: target.url,
      start_command: target.startCommand,
      start_cwd: target.startCwd,
      title: target.title,
      background: target.background,
    })
    deps.markOpened()
    return deps.send(command)
  }

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

  /** One resolved action, start to finish (open/close are tool-only; the rest relay). */
  async function runAction(input: ResolvedInput): Promise<ActionOutcome> {
    if (input.action === 'open') return { result: await openPreviewAndSnapshot(deps, input) }
    if (input.action === 'close') {
      // Closing without a resolved tab ID must never close an arbitrary shared tab.
      const ids = [
        ...new Set(input.preview_ids ?? [input.preview_id ?? deps.getTarget()?.previewId]),
      ].filter((id): id is string => !!id)
      if (!ids.length)
        return {
          result: {
            content: 'action="close" needs preview_id or preview_ids from Browser tabs context.',
            isError: true,
          },
        }
      deps.closePreview(ids)
      return {
        result: {
          content: `Closed ${ids.length} browser ${ids.length === 1 ? 'tab' : 'tabs'}.`,
          details: { action: 'close' },
        },
      }
    }

    const missing = missingFieldMessage(input)
    if (missing) return { result: { content: missing, isError: true } }

    // ACT, THEN LOOK, in one call. A batch that ended in a screenshot arrives here as a
    // screenshot carrying the steps before it (`liftTrailingScreenshot`), because a batch
    // result is text and only the call's own result can be an image. The steps run first and
    // their failure is the call's failure: photographing a page whose setup did not happen
    // returns a picture of the wrong thing, which is worse than an error.
    if (input.action === TAKE_SCREENSHOT && input.steps?.length) {
      const setup = await relay(buildPreviewCommand({ ...input, action: 'steps' }))
      if ('error' in setup) return relayFailure('steps', setup)
    }

    const outcome =
      input.action === 'history'
        ? await deps.send(buildPreviewCommand(input))
        : await relay(buildPreviewCommand(input))
    if ('error' in outcome) return relayFailure(input.action as PreviewAction, outcome)
    return {
      reloaded: outcome.result.reloaded,
      result: await formatReply(input, outcome.result, deps),
    }
  }

  const tool: AgentTool<BrowserInput, BrowserDetails> = defineAgentTool({
    name: TOOL.browser,
    label: 'Browser',
    activeVerb: 'Controlling browser',
    // The injected preview port owns availability. Engine-created sessions have no client
    // descriptor; requiring one hid the tool even when their preview was open and connected.
    // A missing UI probe is reported by the bounded relay, never as successful validation.
    description: BROWSER_DESCRIPTION,
    // The schema is the whole contract: the runtime input is exactly what it declares.
    inputSchema: browserInputSchema as unknown as z.ZodType<BrowserInput>,
    prepareArguments: prepareBrowserArguments,
    // The drive actions reach the user's running app and history pruning is durable, so the
    // static flag says "writes"; `classifyBrowserCall` answers per call, by what will run.
    mutates: true,
    classify: classifyBrowserCall,
    executionMode: 'sequential',
    async execute(_toolCallId, rawInput: BrowserInput): Promise<ToolResult> {
      // Lenient action inference: when a call omits `action` but its payload names
      // exactly one action's required field (e.g. only `expression` → evaluate), infer
      // it instead of hard-rejecting the whole call (a wasted round-trip).
      const action = rawInput.action ?? inferAction(rawInput)
      if (!action) return { content: MISSING_ACTION_MESSAGE, isError: true }

      const { result, reloaded } = await runAction({ ...rawInput, action })

      // Prepend a reload notice (DOM was reset since the agent's last command) to
      // whatever the action returned, and flag an INFERRED action so the model learns
      // to set it explicitly. Both compose; error results keep their own guidance.
      let content = result.content
      if (reloaded) content = `${RELOAD_NOTICE}\n\n${content}`
      if (!rawInput.action && !result.isError) {
        content = `[inferred action="${action}" from the payload — set "action" explicitly next time]\n\n${content}`
      }
      return content === result.content ? result : { ...result, content }
    },
    // A model that cannot read images keeps every action but the picture one: withholding the
    // whole tool would take away snapshot, steps and evaluate, which it can use fine.
    forModel: (modelInput) =>
      modelInput.includes('image')
        ? tool
        : {
            ...tool,
            inputSchema: textOnlyBrowserInputSchema as unknown as z.ZodType<BrowserInput>,
          },
  })
  return tool
}
