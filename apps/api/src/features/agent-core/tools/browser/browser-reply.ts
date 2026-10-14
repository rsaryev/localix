// What a SUCCESSFUL probe reply becomes as the tool's result: which content the model
// reads, which details the tool card gets, and which older result the new one
// supersedes out of context. The relay flow that gets the reply stays in
// browser.ts; the wording of each part lives in browser-format.ts.

import type { AgentToolResult } from '@localixai/agent/agents'
import type { BrowserDetails, BrowserToolDeps } from './browser'
import type { ResolvedInput } from './browser-input'
import type { PreviewCommandResult } from '../preview/preview-control'
import {
  actionContent,
  consoleContent,
  screenshotFailureContent,
  snapshotContent,
} from './browser-format'

/** Drop oversized screenshots from the model payload (keep the text result). base64
 *  inflates ~4/3; ~7MB base64 ≈ ~5MB binary — comfortably under provider limits. */
const MAX_IMAGE_BASE64 = 7 * 1024 * 1024

/** Shape a successful probe reply into the tool result for its action. */
export async function formatReply(
  input: ResolvedInput,
  r: PreviewCommandResult,
  deps: Pick<BrowserToolDeps, 'send'>,
): Promise<AgentToolResult<BrowserDetails>> {
  switch (r.action) {
    case 'viewport':
      if (!r.viewport)
        return {
          content: 'The browser tab did not confirm its actual viewport.',
          isError: true,
          details: { action: 'viewport', previewId: r.previewId },
        }
      return {
        content: `Actual CSS viewport: ${JSON.stringify(r.viewport)}. Layout only; touch is not emulated.`,
        details: { action: 'viewport', previewId: r.previewId, viewport: r.viewport },
      }
    case 'snapshot':
      return {
        content: snapshotContent(r),
        details: {
          action: r.action,
          snapshot: r.snapshot,
          previewId: r.previewId,
          viewport: r.viewport,
        },
        supersedeKey: 'browser',
      }

    case 'console': {
      const entries = r.console ?? []
      // Only the latest console read matters — supersede older ones out of context.
      return {
        content: consoleContent(entries),
        details: { action: r.action, console: entries },
        supersedeKey: 'browser:console',
      }
    }

    case 'evaluate': {
      const value = r.value ?? 'undefined'
      // Opt-in (snapshotAfter:true): after an evaluate that MUTATED the page, fold
      // the resulting page snapshot into the SAME result so the agent sees the
      // effect without spending a separate snapshot turn. The probe just answered,
      // so it's engaged — a normal-timeout follow-up relay replies fast.
      if (input.snapshot_after === true) {
        const after = await deps.send({ action: 'snapshot', previewId: r.previewId })
        if (after.ok && after.result.snapshot) {
          return {
            content: `${value}\n\n${snapshotContent(after.result)}`,
            details: { action: r.action, value, snapshot: after.result.snapshot },
          }
        }
      }
      // No supersedeKey: successive evaluates usually read DIFFERENT state (score,
      // then board, then …) — each is independently meaningful, unlike a snapshot.
      return { content: value, details: { action: r.action, value } }
    }

    case 'history':
      return {
        content: r.value ?? '{}',
        details: { action: 'history', value: r.value },
        supersedeKey: 'browser:history',
      }

    case 'screenshot': {
      const img = r.image
      const label = r.target ? `Screenshot of ${r.target}` : 'Screenshot'
      // Screenshots are base64 images (up to ~7MB each); without superseding they
      // pile up and balloon the context (one run hit ~1M input tokens in one
      // turn). Keep only the LATEST preview screenshot in the model's view.
      if (img && img.data.length <= MAX_IMAGE_BASE64) {
        return {
          content: `${label} (${img.width}×${img.height}).`,
          contentParts: [
            {
              type: 'image',
              mediaType: img.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
              data: img.data,
            },
          ],
          details: { action: r.action, rect: r.rect, target: r.target },
          supersedeKey: 'browser:screenshot',
        }
      }
      return {
        content: screenshotFailureContent(label, r.rect, img ? img.data.length : undefined),
        details: { action: r.action, rect: r.rect, target: r.target },
        supersedeKey: 'browser:screenshot',
      }
    }

    case 'click':
    case 'hover':
    case 'press':
    case 'scroll':
    case 'steps':
    case 'type':
      // A snapshotAfter result carries the page board → supersede stale ones too.
      return {
        content: actionContent(r),
        details: {
          action: r.action,
          target: r.target,
          rect: r.rect,
          diff: r.diff,
          snapshot: r.snapshot,
        },
        ...(r.snapshot ? { supersedeKey: 'browser' as const } : {}),
      }
  }
}
