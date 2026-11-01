import type { z } from 'zod'
import {
  defineAgentTool,
  type AgentTool,
  type AgentToolUpdateCallback,
} from '@localixai/agent/agents'
import { TOOL } from '../../tool-names'
import {
  MISSING_ACTION_MESSAGE,
  inferAction,
  missingFieldMessage,
  prepareBrowserArguments,
  type BrowserInput,
  type ResolvedInput,
} from './browser-input'
import { browserDescription, browserInputSchemaFor } from './browser-input-variants'
import { classifyBrowserCall } from './browser-classify'
import { RELOAD_NOTICE } from './browser-format'
import { openPreviewAndSnapshot } from './browser-open'
import { createViewportMemory } from './browser-viewport'
import { runGoal } from './browser-goal'
import { createTabTaint } from './browser-taint'
import { withUnresolvedNote } from './browser-secrets'
import { createRelay } from './browser-relay'
import type { ActionOutcome, BrowserDetails, BrowserToolDeps, ToolResult } from './browser-types'

export type { BrowserDetails, BrowserToolDeps } from './browser-types'

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

export function createBrowserTool(hostDeps: BrowserToolDeps) {
  // Every relay carries the tab's fixed size (if any), and every open re-decides it.
  const viewports = createViewportMemory()
  const taint = createTabTaint()
  const deps: BrowserToolDeps = {
    ...hostDeps,
    send: (command, opts) => hostDeps.send(viewports.apply(command), opts),
    async openPreview(input) {
      const opened = await hostDeps.openPreview(input)
      if (opened.ok) viewports.remember(opened.previewId, input.viewport)
      return opened
    },
  }

  const relay = createRelay(deps, taint)

  /** One resolved action, start to finish (open/close are tool-only; the rest relay). */
  async function runAction(
    input: ResolvedInput,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<BrowserDetails>,
  ): Promise<ActionOutcome> {
    if (input.action === 'goal') {
      const missing = missingFieldMessage(input)
      if (missing) return { result: { content: missing, isError: true } }
      return {
        result: await runGoal(
          { ...deps, redact: deps.secrets?.redact },
          {
            goal: input.goal!.trim(),
            values: input.values ?? [],
            previewId: input.preview_id,
            signal,
            onProgress: (steps) => onUpdate?.({ action: 'goal', steps }),
          },
        ),
      }
    }
    const outcome = await relayAction(input)
    const { result } = outcome
    if (result.isError) return outcome
    if (input.action === 'viewport')
      viewports.remember(input.preview_id ?? result.details?.previewId, input.viewport)
    if (!['open', 'viewport', 'snapshot'].includes(input.action)) return outcome
    const note = viewports.note(result.details?.previewId ?? input.preview_id)
    return note ? { ...outcome, result: { ...result, content: result.content + note } } : outcome
  }

  async function relayAction(input: ResolvedInput): Promise<ActionOutcome> {
    if (input.action === 'open') return { result: await openPreviewAndSnapshot(deps, input) }
    if (input.action === 'close') {
      // Closing without a tab ID must never close an arbitrary shared tab.
      const ids = [...new Set(input.preview_ids ?? [input.preview_id])].filter(
        (id): id is string => !!id,
      )
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
    return relay.secured(input)
  }

  const goal = !!deps.decide
  const tool: AgentTool<BrowserInput, BrowserDetails> = defineAgentTool({
    name: TOOL.Browser,
    label: 'Browser',
    activeVerb: 'Controlling browser',
    // The injected preview port owns availability. Engine-created sessions have no client
    // descriptor; requiring one hid the tool even when their preview was open and connected.
    // A missing UI probe is reported by the bounded relay, never as successful validation.
    // `goal` is offered only when a decision model can answer for this run (`deps.decide`).
    description: browserDescription(goal),
    // The schema is the whole contract: the runtime input is exactly what it declares.
    inputSchema: browserInputSchemaFor({
      images: true,
      goal,
    }) as unknown as z.ZodType<BrowserInput>,
    prepareArguments: prepareBrowserArguments,
    // The drive actions reach the user's running app and history pruning is durable, so the
    // static flag says "writes"; `classifyBrowserCall` answers per call, by what will run.
    mutates: true,
    classify: classifyBrowserCall,
    executionMode: 'sequential',
    async execute(
      _toolCallId,
      rawInput: BrowserInput,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback<BrowserDetails>,
    ): Promise<ToolResult> {
      // Lenient action inference: when a call omits `action` but its payload names
      // exactly one action's required field (e.g. only `expression` → evaluate), infer
      // it instead of hard-rejecting the whole call (a wasted round-trip).
      const action = rawInput.action ?? inferAction(rawInput)
      if (!action) return { content: MISSING_ACTION_MESSAGE, isError: true }

      const { result, reloaded } = await runAction({ ...rawInput, action }, signal, onUpdate)

      // Prepend a reload notice (DOM was reset since the agent's last command) to
      // whatever the action returned, and flag an INFERRED action so the model learns
      // to set it explicitly. Both compose; error results keep their own guidance.
      let content = result.content
      if (reloaded) content = `${RELOAD_NOTICE}\n\n${content}`
      content = withUnresolvedNote(content, { ...rawInput, action })
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
            inputSchema: browserInputSchemaFor({
              images: false,
              goal,
            }) as unknown as z.ZodType<BrowserInput>,
          },
  })
  return tool
}
