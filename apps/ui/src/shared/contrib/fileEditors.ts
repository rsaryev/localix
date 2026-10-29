import type { FileEditorContribution } from '@localixai/mini-app-sdk/ui'
import { isMiniAppContributionEnabled } from './miniAppActivation'

/**
 * OPEN file-type editor registry — a feature that has a specialised editor for a
 * family of file paths (a Dockerfile / Compose manifest, a spreadsheet, …)
 * registers a predicate + component here from its `contrib.{ts,tsx}` / mini app
 * `ui/register.tsx` instead of core's editor-grid routing table hardcoding the
 * detection + import. The grid consults this registry FIRST, then falls back to
 * its core file routing (media viewer, plain code editor).
 *
 * SEVERAL contributions may claim the same file (two mini apps both handling
 * `.xyz`): the grid lists ALL matches (`fileEditorsFor`) and, when there is more
 * than one, shows an "Open with" chooser. Core picks no winner itself: only a single
 * contribution that declares `preferred` (the core PDF viewer) opens without asking.
 *
 * The contribution CONTRACT is OWNED by `@localixai/mini-app-sdk/ui`; re-exported so
 * internal import sites stay unchanged.
 */
export type { FileEditorContribution, FileEditorProps } from '@localixai/mini-app-sdk/ui'

const editors: FileEditorContribution[] = []

/** Register a specialised file-type editor. */
export function registerFileEditor(contribution: FileEditorContribution): void {
  const existing = editors.find((editor) => editor.id === contribution.id)
  if (existing === contribution) return
  if (existing) {
    console.warn(
      `[file-editors] duplicate editor id "${contribution.id}" — keeping the first owner`,
    )
    return
  }
  editors.push(contribution)
}

/** EVERY registered editor whose `match` accepts the key, in registration order. */
/** Drop every editor `owner` registered (a mini app reload or unload). */
export function removeFileEditorsOf(owner: string): void {
  for (let index = editors.length - 1; index >= 0; index -= 1) {
    if (editors[index]?.miniAppName === owner) editors.splice(index, 1)
  }
}

export function fileEditorsFor(path: string): FileEditorContribution[] {
  return editors.filter(
    (editor) => isMiniAppContributionEnabled(editor.miniAppName) && editor.match(path),
  )
}

/** A registered editor by its stable id (the persisted "open with" choice). */
export function fileEditorById(id: string): FileEditorContribution | undefined {
  return editors.find(
    (editor) => editor.id === id && isMiniAppContributionEnabled(editor.miniAppName),
  )
}
