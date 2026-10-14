// How a probe reply READS BACK to the model: the snapshot header, the
// change-diff body, and the hints that stop the agent misdiagnosing a page it
// cannot see (an empty page, a 404'd stylesheet, an error thrown mid-click, a
// reload that reset the DOM). Pure formatting over a PreviewCommandResult —
// separate from the relay flow in browser.ts.

import type { PreviewCommandResult, PreviewSnapshot } from '../preview/preview-control'
import { plural } from '../tool-output'

// Prepended when the preview reloaded between the agent's commands. The dev-server
// file-watch auto-reload (or a location.reload()) resets the DOM — so a value you set
// (a theme attribute, a form field) reverts and every earlier [ref=eN] is invalid.
// Naming it stops the model misreading the reset as a broken control.
export const RELOAD_NOTICE =
  '[page reloaded since your previous command — the DOM state was RESET (anything you toggled/typed reverted) and every [ref=eN] from before is now invalid. Re-read the page below and re-target from the fresh refs. If YOU triggered this by editing the served file, expect it each edit.]'

/**
 * An almost-empty page (≤2 nodes) right after opening usually means the page
 * didn't actually render: the dev server wasn't ready yet, OR a live SPA dev-server
 * URL rendered blank through the injecting proxy (its module/HMR paths broke). Tell
 * the agent so it doesn't keep driving / screenshotting a blank page (the 2048 churn
 * cause) — and point at the reliable path: preview the BUILT output.
 */
function emptyPageHint(s: PreviewSnapshot): string {
  if (s.stats.nodes > 2) return ''
  return `\n\n[heads-up: this page is essentially empty (${plural(s.stats.nodes, 'node')}). The dev server may not be ready yet, or a live dev-server URL rendered blank through the proxy. If you've built the app, open the BUILT output instead (e.g. browser action="open" file_path="dist/index.html") — it auto-serves with the probe inlined, no proxy.]`
}

// A page whose stylesheet/script/image 404'd is silently broken — the theme flips
// but nothing restyles. Surface the failed resources so the agent stops
// blaming a working control and fixes the missing file/path instead.
function failedResourcesHint(s: PreviewSnapshot): string {
  const failed = s.failedResources
  if (!failed?.length) return ''
  return `\n\n⚠ failed to load: ${failed.join(', ')} — the page is running WITHOUT these resources (a wrong path / missing file). If styling or behavior looks broken, fix that before touching the UI controls.`
}

/** A snapshot reply: page header + the accessibility tree + the page-health hints. */
export function snapshotContent(r: PreviewCommandResult): string {
  const s = r.snapshot
  if (!s) return 'No snapshot.'
  const head = `Page "${s.title}" — ${s.url}\n${s.stats.nodes} nodes (${s.stats.interactive} interactive). Use a node's [ref=eN] to act on it; re-snapshot after the page changes.`
  const viewport = r.viewport
    ? `\nActual CSS viewport: ${r.viewport.width} × ${r.viewport.height}.`
    : ''
  return `${head}${viewport}\n\n${s.tree}${emptyPageHint(s)}${failedResourcesHint(s)}`
}

// Errors/warnings the probe captured DURING this action (uncaught throws, unhandled
// rejections, auto-dismissed native dialogs) + subresources that NEWLY failed to load.
// Appended so a click whose handler threw or popped an alert() isn't read as a silent
// "(no visible change)". Present only when the probe attached something.
function actionWarnings(r: PreviewCommandResult): string {
  const blocks: string[] = []
  if (r.recentErrors?.length) {
    blocks.push(
      `⚠ error${r.recentErrors.length === 1 ? '' : 's'} during this action (auto-captured):\n${r.recentErrors.map((e) => `- ${e}`).join('\n')}`,
    )
  }
  if (r.failedResources?.length) {
    blocks.push(
      `⚠ newly failed to load: ${r.failedResources.join(', ')} — a wrong path / missing file; fix that before blaming a control.`,
    )
  }
  return blocks.length ? `\n\n${blocks.join('\n\n')}` : ''
}

/** An interaction reply: the note, then the fresh tree (snapshotAfter) or the change-diff. */
export function actionContent(r: PreviewCommandResult): string {
  const lines = [r.note ?? `${r.action} done`]
  // With snapshotAfter the agent gets the new page state right here (no extra call);
  // otherwise a compact interactive diff of what changed.
  if (r.snapshot)
    lines.push(
      '',
      `Page now — ${r.snapshot.stats.nodes} nodes:`,
      r.snapshot.tree + emptyPageHint(r.snapshot) + failedResourcesHint(r.snapshot),
    )
  else if (r.diff) lines.push('', 'Changes:', r.diff)
  // Errors/dialogs that fired during the action ride the SAME result.
  return lines.join('\n') + actionWarnings(r)
}

/** A console reply: one `[level] text` row per entry. */
export function consoleContent(entries: Array<{ level: string; text: string }>): string {
  return entries.length
    ? entries.map((e) => `[${e.level}] ${e.text}`).join('\n')
    : '(console is empty)'
}

/**
 * A screenshot reply that came back WITHOUT usable image bytes. Screenshots are
 * rendered IN-PROBE (programmatic DOM→canvas rasterize — no screen-share permission
 * involved), so a null result means the target couldn't be RENDERED: almost always a
 * zero-size element (rect 0×0) — an empty/not-yet-loaded page or a selector that
 * matched nothing — not a declined capture. Say that, and point at the fix.
 */
export function screenshotFailureContent(
  label: string,
  rect: { width: number; height: number } | null | undefined,
  oversizedBytes: number | undefined,
): string {
  if (oversizedBytes != null) {
    return `${label} captured but too large to inline (${Math.round(oversizedBytes / 1024)}KB).`
  }
  const zeroSize = !rect || (rect.width === 0 && rect.height === 0)
  return zeroSize
    ? `Couldn't render a screenshot — the target has no visible size (rect ${JSON.stringify(rect)}). The page is likely empty / not finished loading, or the selector matched nothing. Take a "snapshot" first to confirm the page actually rendered (more than a handful of nodes), then screenshot a concrete element.`
    : `Couldn't render a screenshot of the target (rect ${JSON.stringify(rect)}). Re-snapshot and target a specific [ref=eN] element.`
}
