/**
 * Host wiring for the `browser` tool: OPEN the preview and drive the one
 * the user already has open, through the injected in-page probe. Every capability
 * is bound to THIS user + session so a relayed command can only reach this
 * session's probe, and `open` reuses the shared openPreviewCore (no second open
 * path).
 *
 * Nothing is remembered here: a command names its tab by `preview_id`, which `open` returns and
 * derives from the target, and `close` only tells the UI which tabs to close.
 *
 * A `plugin:<name>` target is a plugin's workbench view, not a page: nothing is served or
 * proxied for it. The workbench claims every command for it
 * and opens the view itself (`contracts/plugin-view-target.ts`).
 */
import type { OptionalToolPorts } from '../../../agent-core/tool-registry'
import { isToolDirect, type RunProfile } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import {
  openPreviewCore,
  type OpenPreviewCoreResult,
} from '../../../agent-core/tools/preview/open-preview'
import { parsePluginViewTarget, pluginViewTarget } from '../../../../contracts/plugin-view-target'
import { sessionScratchDir } from '../../../agent-core/tools/workspace'
import type { SessionRecord } from '../../repository'
import type { RunnerDeps } from '../agent-runner-types'

export function buildBrowserOptions(input: {
  /** Whether a decision model answers for this user now (the `goal` action's model). */
  decisionsAvailable?: boolean
  deps: RunnerDeps
  userId: string
  session: SessionRecord
  defaultCwd: string
  agentProfile: RunProfile
}): OptionalToolPorts['browser'] {
  const { deps, userId, session, defaultCwd, agentProfile } = input
  const previewControl = deps.previewControl
  if (!isToolDirect(agentProfile, TOOL.browser) || !previewControl) return undefined

  return {
    send: (command, opts) =>
      previewControl.send({
        userId,
        sessionId: session.id,
        command: {
          ...command,
          previewId: command.action === 'history' ? undefined : command.previewId,
        },
        timeoutMs: opts?.timeoutMs,
      }),
    openPreview: async (openInput) => {
      const plugin = parsePluginViewTarget(openInput.url)
      const opened = plugin
        ? openPluginView(plugin)
        : await openPreviewCore(
            {
              userId,
              sessionId: session.id,
              streamRegistry: deps.streamRegistry,
              defaultCwd,
              // The second root a file may be served from. The prompt sends throwaway render
              // targets here; without this the tool that renders from a file refused them.
              scratchDir: sessionScratchDir(session.id),
            },
            openInput,
          )
      return opened
    },
    // The `goal` action's decision model, billed to this session (`features/decisions`).
    // Bound only when a decision model can answer for this user now: without it the tool does not
    // offer `goal` at all (`browserInputSchemaFor`).
    ...(deps.decisions && input.decisionsAvailable
      ? {
          decide: (ask, options) =>
            deps.decisions!.decide(userId, ask, {
              purpose: 'browser.goal',
              usageKind: 'decision',
              sessionId: session.id,
              ...(options.signal ? { signal: options.signal } : {}),
            }),
        }
      : {}),
    closePreview: (previewIds) => {
      deps.streamRegistry.publish(userId, session.id, {
        type: 'preview.closed',
        sessionId: session.id,
        previewIds,
      })
    },
  }
}

/** A plugin view "opens" by being addressed: the workbench opens the tab on the first command. */
function openPluginView(plugin: string): OpenPreviewCoreResult {
  const target = pluginViewTarget(plugin)
  return {
    ok: true,
    url: target,
    previewId: target,
    title: plugin,
    version: 0,
    frameBlocked: false,
    autoServed: false,
    background: false,
    content: `The "${plugin}" plugin's view, open in its own workbench tab — not a web page. Drive it with snapshot, take_screenshot and steps (click, type, press, scroll) and read its errors with console; evaluate and viewport are not available on it.`,
  }
}
