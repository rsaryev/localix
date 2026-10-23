import type { ComponentType, ReactNode } from 'react'
import type { MiniAppOwnedContribution, PublishMessageContext } from './contrib'

/**
 * File-type editor contribution — a plugin that has a specialised editor for a
 * family of file paths (a Dockerfile / Compose manifest, …) registers a
 * predicate + component instead of the host's editor-grid routing table
 * hardcoding the detection + import. The grid consults contributions FIRST,
 * then falls back to its core file routing.
 */

/** The props the editor-grid passes when it opens a file tab. */
export interface FileEditorProps {
  itemId?: string
  /** The chat the file tab belongs to. Every file tab is opened into one, so an editor never has
   *  to guess — the old optional field sent plugin editors to the active chat to fill it. */
  sessionId: string
  path: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  revealAt?: number
  /**
   * A stored (dropped/uploaded) file has no on-disk `path` — it is addressed by a
   * media id instead, with `name` carrying the original filename. Only passed to
   * contributions that declare {@link FileEditorContribution.acceptsMedia}.
   */
  mediaId?: string
  /** Original filename of a media-backed file (routing/matching key). */
  name?: string
  /** Tab title hint (work-item title). */
  title?: string
  /**
   * Publish the context represented by the viewer's CURRENT UI state.
   *
   * File viewers use the same host-owned lifecycle as contributed work-item
   * bodies: the host scopes this callback to the tab, merges the publication
   * with the static file binding, and removes it on unmount. A specialised
   * binary viewer can therefore replace an unreadable `@file:` ref with the
   * extracted provider URI without importing any composer code.
   */
  publishMessageContext?: PublishMessageContext
}

export interface FileEditorContribution extends MiniAppOwnedContribution {
  /**
   * Stable identity, `<plugin>.<editor>` by convention (e.g. `sample.spreadsheet`,
   * `sample.sql`). Persisted as the user's remembered "open with" choice when
   * several contributions match the same file — so it must survive renames/reloads.
   */
  id: string
  /** Human name shown in the "Open with" chooser (e.g. "Table view", "SQL console"). */
  label: string
  /** Optional compound-format key for remembered choices (for example `board.json`, not `json`). */
  preferenceKey?: string
  /**
   * True when this editor should handle the given routing key: the file PATH for
   * on-disk files, or the original NAME for media-backed (dropped/uploaded) files
   * when {@link acceptsMedia} is set.
   */
  match: (path: string) => boolean
  /** The editor component (typically wraps the host's shared FileTab). */
  Component: ComponentType<FileEditorProps>
  /**
   * Also handle media-backed files (no on-disk path; bytes behind `mediaId`).
   * Off by default: a plain path editor never sees a dropped file, which instead
   * falls back to the host's generic media viewer.
   */
  acceptsMedia?: boolean
  /**
   * Open with this editor when other contributions also match, instead of asking first. The
   * others stay one step away through **Open with…**, and a remembered choice still wins. When
   * several matching editors claim it, none does and the chooser is shown.
   */
  preferred?: boolean
}

/**
 * An ENHANCER rides along with the host's own file editor instead of replacing it.
 *
 * The difference from {@link FileEditorContribution} is who owns the viewport: an editor
 * contribution answers "open this file with what?", while an enhancer answers "while the host's
 * editor is open on this file, also render this". A plugin that wants to add history, blame or a
 * conflict bar to EVERY file has no business claiming the editor itself, and before this seam
 * existed its only options were to do exactly that or to reach into host internals.
 */
/**
 * An enhancer receives the editor's own props PLUS the host's renderer.
 *
 * It is a render-prop, not a panel: an enhancer computes augmentations for a file — a dirty-diff
 * model, a blame source — and hands them back for the host to draw into its editor chrome. It does
 * not own pixels, which is why one can attach to a file type another plugin renders.
 *
 * The contribution record is deliberately open. The host owns the vocabulary of what an editor
 * augmentation may be, and today that vocabulary is `dirtyDiff` and `blameSource` — both in the
 * public design-system surface — but naming them here would freeze a list the host has not
 * finished writing. It narrows on its side; a plugin passes what it computed.
 */
export interface FileEditorEnhancerProps extends FileEditorProps {
  // A property, not a method shorthand: it is a callback the host passes down, and the shorthand
  // form reads as an unbound method to type-aware lint.
  render: (contribution: Readonly<Record<string, unknown>>) => ReactNode
}

export interface FileEditorEnhancerContribution extends MiniAppOwnedContribution {
  /** Stable identity, `<plugin>.<enhancer>` by convention. */
  id: string
  /** Which files this enhancer attaches to; `() => true` for all of them. */
  match: (path: string) => boolean
  /** Rendered by the host with the editor's props plus its renderer — see {@link FileEditorEnhancerProps}. */
  Component: ComponentType<FileEditorEnhancerProps>
}

/** One file's decoration in the tree: a letter badge, its meaning, and the token that colours it. */
export interface FileTreeDecoration {
  /** Single character shown beside the name (`M`, `A`, `?`). */
  letter: string
  /** What the letter means, for the tooltip and for assistive technology. */
  label: string
  /** A text-colour utility resolved from a theme token — never a literal colour. */
  color: string
}

/**
 * The live decoration lookup for one session's file tree.
 *
 * Returned from a hook rather than computed once because decorations track state that changes
 * under the user (a save, a checkout, a pull); the tree re-renders from the hook's own updates.
 */
export interface FileTreeDecorationIndex {
  /** The decoration for one path, or `undefined` when it has none. */
  decorationFor: (path: string) => FileTreeDecoration | undefined
  /** Whether anything beneath a directory is decorated, so a collapsed folder can still signal. */
  directoryHasDecorations: (path: string) => boolean
  /**
   * Offered as a context-menu action when present. The provider owns where the ignore list lives
   * and what a path means inside it; the tree only knows an entry can be ignored.
   */
  addToIgnore?: (path: string, isDirectory: boolean) => Promise<void>
  /**
   * What to call {@link addToIgnore} in the menu. The tree cannot name it: "Add to .gitignore" is
   * true of one provider and a lie about the next, and "Add to ignore list" is true of none of
   * them. Defaults to the generic wording when a provider offers the action without a name.
   */
  ignoreLabel?: string
}

/**
 * Decorations for the file tree. At most ONE contribution is honoured — the tree has a single
 * badge slot per row, so two providers would silently race for it; the host keeps the first.
 */
export interface FileTreeDecorationContribution extends MiniAppOwnedContribution {
  /** Stable identity, `<plugin>.<decoration>` by convention. */
  id: string
  /** The hook the tree calls, once, with the session whose tree is on screen. */
  useIndex: (sessionId: string | null) => FileTreeDecorationIndex
}
