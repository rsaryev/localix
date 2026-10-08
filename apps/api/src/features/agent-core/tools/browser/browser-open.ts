import type { AgentToolResult } from '@localixai/agent/agents'
import type { BrowserToolDeps, BrowserDetails } from './browser'
import type { ResolvedInput } from './browser-input'
import type { PreviewCommandResult, PreviewSendOutcome } from '../preview/preview-control'
import { snapshotContent } from './browser-format'

// Opening a URL and observing a ready page are separate outcomes. A failed
// readiness check must stay visible so a task cannot claim visual verification.
const OPEN_SNAPSHOT_TIMEOUT_MS = 12_000

export async function openPreviewAndSnapshot(
  deps: BrowserToolDeps,
  input: ResolvedInput,
): Promise<AgentToolResult<BrowserDetails>> {
  const res = await deps.openPreview({
    url: input.url,
    file_path: input.file_path,
    start_command: input.start_command,
    background: input.background,
    viewport: input.viewport,
  })
  if (!res.ok) return { content: res.content, isError: true, details: { action: 'open' } }
  deps.recordTarget({
    url: res.url,
    title: res.title,
    startCommand: input.start_command?.trim() || undefined,
    startCwd: res.startCwd,
  })
  deps.markOpened()

  let openSnap: PreviewCommandResult | undefined
  let readinessError: Extract<PreviewSendOutcome, { ok: false }> | undefined
  try {
    const after = await deps.send(
      { action: 'snapshot', previewId: res.previewId },
      { timeoutMs: OPEN_SNAPSHOT_TIMEOUT_MS },
    )
    if (after.ok && after.result.snapshot) openSnap = after.result
    else if ('error' in after) readinessError = after
  } catch (error) {
    readinessError = {
      ok: false,
      errorCode: 'failed',
      error: error instanceof Error ? error.message : 'Browser readiness check failed.',
    }
  }
  return {
    content: `${res.content}\nBrowser tab ID: ${res.previewId}. ${openSnap ? 'Agent bridge ready.' : 'Agent bridge not ready; opening is not evidence of a completed check.'}${readinessError ? `\n${readinessError.errorCode ?? 'bridge_not_ready'}: ${readinessError.error}` : ''}${openSnap ? `\n\n${snapshotContent(openSnap)}` : ''}`,
    details: {
      action: 'open',
      previewId: res.previewId,
      ready: Boolean(openSnap),
      errorCode: readinessError?.errorCode,
      error: readinessError?.error,
      viewport: openSnap?.viewport,
      target: res.url,
      ...(openSnap?.snapshot ? { snapshot: openSnap.snapshot } : {}),
    },
    ...(openSnap ? { supersedeKey: 'browser' as const } : {}),
  }
}
