import { createEventChannel } from './eventChannel'

/**
 * One-way "reveal a file in the Explorer (file tree)" channel.
 * The editor tab menu (a `widgets/editor-grid` slice)
 * asks to reveal a file's location in the sidebar tree (a `features/inspector`
 * slice) without the two features importing each other: both subscribe to this
 * shared bus. ChatPage switches the sidebar to the Files section; the file tree
 * expands the path's ancestors, scrolls to it and selects it.
 *
 * Mirrors the split-responsibility pattern of {@link inspectorBus} — sibling
 * slices coordinate through `shared`, so the dependency arrow stays one-way.
 */

type RevealListener = (absolutePath: string) => void

const channel = createEventChannel<[absolutePath: string]>()

/** Ask every subscriber to reveal `absolutePath` in the Explorer tree. */
export function revealInTree(absolutePath: string): void {
  channel.publish(absolutePath)
}

/** Subscribe to reveal requests; returns an unsubscribe for teardown/HMR. */
export function subscribeRevealInTree(listener: RevealListener): () => void {
  return channel.subscribe(listener)
}

// ── Focus the tree's search field ────────────────────────────────────────────
// The Command Palette "Show Search" / find-in-files entry (a `pages/chat` slice)
// asks the file tree (a `features/inspector` slice) to open its search field in a
// given mode, without the two importing each other. ChatPage switches the sidebar
// to Files, then fires this so the tree reveals + focuses the search field.

/** Which search the tree field should run: `names` = filename filter, `content` = find-in-files. */
export type TreeSearchMode = 'names' | 'content'

type TreeSearchListener = (mode: TreeSearchMode) => void

const searchChannel = createEventChannel<[mode: TreeSearchMode]>()

/** Ask the file tree to open + focus its search field in `mode`. */
export function focusTreeSearch(mode: TreeSearchMode): void {
  searchChannel.publish(mode)
}

/** Subscribe to tree-search focus requests; returns an unsubscribe for teardown/HMR. */
export function subscribeTreeSearch(listener: TreeSearchListener): () => void {
  return searchChannel.subscribe(listener)
}

// ── Begin a new file at the project root ─────────────────────────────────────
// The native File ▸ New File menu item (a `pages/chat` slice via the menu bridge)
// asks the file tree (a `features/inspector` slice) to start an inline new-file
// entry at the workspace root — the same flow as the tree's own "New File" button.
// ChatPage switches the sidebar to Files first, then fires this.

type NewFileListener = () => void

const newFileChannel = createEventChannel<[]>()

/** Ask the file tree to begin an inline new-file entry at the root. */
export function beginNewFile(): void {
  newFileChannel.publish()
}

/** Subscribe to new-file requests; returns an unsubscribe for teardown/HMR. */
export function subscribeNewFile(listener: NewFileListener): () => void {
  return newFileChannel.subscribe(listener)
}
