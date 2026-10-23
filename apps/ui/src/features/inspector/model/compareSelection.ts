// "Select for Compare" state + the compare action.
//
// A tiny store holds the "resource selected for compare" so the file tree can
// react without prop-drilling, while also
// recording the owning session: identical absolute paths can appear in distinct
// workspaces, and a selection must never leak across that boundary.
import { create } from 'zustand'
import { toast } from '@/shared/lib/notify'
import { backendClient } from '@/shared/api/client'
import { inspector } from '@/shared/lib/inspectorBus'
import { baseName, errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { buildCompareDiff, compareDiffPath } from '../lib/compare-diff'

interface CompareSelectionStore {
  /** Session that owns `selectedPath`; null when no compare source is selected. */
  selectedSessionId: string | null
  /** Absolute path last "Select for Compare"d, or null. */
  selectedPath: string | null
  selectForCompare: (sessionId: string, path: string) => void
  clear: () => void
}

export const useCompareSelection = create<CompareSelectionStore>((set) => ({
  selectedSessionId: null,
  selectedPath: null,
  selectForCompare: (sessionId, path) => set({ selectedSessionId: sessionId, selectedPath: path }),
  clear: () => set({ selectedSessionId: null, selectedPath: null }),
}))

/** Return a compare source only inside the workspace that selected it. */
export function selectedComparePathForSession(
  selectedSessionId: string | null,
  selectedPath: string | null,
  sessionId: string | null,
): string | null {
  return selectedSessionId === sessionId ? selectedPath : null
}

/**
 * Fetch both files' on-disk contents, build a two-file unified diff, and open it
 * as a dedicated compare tab in the editor grid. `aPath` is the ORIGINAL (left)
 * side, `bPath` the MODIFIED (right) side — the resource you picked first is the
 * original.
 */
export async function compareTwoFiles(
  sessionId: string | null,
  aPath: string,
  bPath: string,
  isCurrent: () => boolean,
): Promise<void> {
  if (!sessionId) return
  if (aPath === bPath) {
    toast.info('Select two different files to compare')
    return
  }
  try {
    const [a, b] = await Promise.all([
      backendClient.getFileContent(sessionId, aPath, { full: true }),
      backendClient.getFileContent(sessionId, bPath, { full: true }),
    ])
    if (!isCurrent()) return
    const diff = buildCompareDiff(aPath, bPath, a.content, b.content)
    inspector.openDiff({
      sessionId,
      // Synthetic identity keeps this tab distinct from any git diff of either file.
      path: compareDiffPath(aPath, bPath),
      diff,
      title: `${baseName(aPath)} ↔ ${baseName(bPath)}`,
      // Highlight + gutter-link against the modified (right) file's real path.
      languagePath: bPath,
    })
    if (!diff.includes('@@'))
      toast.info(`“${baseName(aPath)}” and “${baseName(bPath)}” are identical`)
  } catch (error) {
    if (isCurrent())
      toast.error('Could not read the files to compare', {
        description: errorMessage(error, '') || undefined,
      })
  }
}

/** Synthetic left-side path for a clipboard compare — its basename ("Clipboard")
 *  becomes the diff's left/original header, and it keeps a stable, collision-free
 *  tab id distinct from any real file path. */
const CLIPBOARD_COMPARE_PATH = 'clipboard://Clipboard'

/**
 * Diff the current clipboard text (left/original) against a file on disk
 * (right/modified) and open it as a compare tab — "Compare with
 * Clipboard" (labelled "Clipboard ↔ <file>" with the real file as the
 * modified side). Reuses the two-file compare plumbing with the clipboard text
 * as the A side. A denied/unavailable clipboard degrades to a toast, never a
 * throw.
 */
export async function compareFileWithClipboard(
  sessionId: string | null,
  path: string,
  isCurrent: () => boolean,
): Promise<void> {
  if (!sessionId) return
  const clip = await platformCapabilities().clipboard.readText()
  if (clip === null) {
    // Worded like the editor's and the terminal's paste: one failure, one headline.
    if (isCurrent())
      toast.error('Could not read the clipboard', {
        description: 'Clipboard access was denied or is unavailable here.',
      })
    return
  }
  if (!isCurrent()) return
  try {
    const file = await backendClient.getFileContent(sessionId, path, { full: true })
    if (!isCurrent()) return
    const diff = buildCompareDiff(CLIPBOARD_COMPARE_PATH, path, clip, file.content)
    inspector.openDiff({
      sessionId,
      path: compareDiffPath(CLIPBOARD_COMPARE_PATH, path),
      diff,
      title: `Clipboard ↔ ${baseName(path)}`,
      // Highlight + gutter-link against the file's real path (the modified side).
      languagePath: path,
    })
    if (!diff.includes('@@')) toast.info(`“${baseName(path)}” matches the clipboard`)
  } catch (error) {
    if (isCurrent())
      toast.error(`Could not read “${baseName(path)}” to compare`, {
        description: errorMessage(error, '') || undefined,
      })
  }
}
