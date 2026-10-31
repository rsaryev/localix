/**
 * Pure pieces of the composer `@`-reference picker: how an accepted row rewrites the draft,
 * the ref-path partial split, and the mode-aware empty/highlight copy. `useAtRefAutocomplete`
 * owns only the React state around them.
 */
import { refToken, resourceDrillPartial, type detectToken } from '@localixai/api/context-refs'
import { chatUriToNativeToken } from './chatResourceToken'
import type { AtRefSuggestion } from './atRefSuggestions'

export type AtRefToken = NonNullable<ReturnType<typeof detectToken>>

/** The token a container URI links as: a `localix://resource/chat` node maps back to its native
 *  `@project:`/`@session:`/`@message:` token; any other scheme is the generic
 *  `@resource:` token. Shared by the action rows and node linking (no trailing space). */
export function resourceLinkToken(uri: string): string {
  return chatUriToNativeToken(uri) ?? `@resource:${uri}`
}

/** Directory part ('' = working-dir root) and trailing segment of a ref-path partial. */
export function splitRefPathPartial(token: AtRefToken | null): {
  dirPart: string
  segment: string
} {
  if (token?.mode !== 'ref-path') return { dirPart: '', segment: '' }
  const slash = token.partial.lastIndexOf('/')
  return slash >= 0
    ? { dirPart: token.partial.slice(0, slash + 1), segment: token.partial.slice(slash + 1) }
    : { dirPart: '', segment: token.partial }
}

export interface AcceptAtRefInput {
  prompt: string
  token: AtRefToken
  suggestion: AtRefSuggestion
  /** 'default' = Enter/click (drill a container, link a leaf); 'link' = link the node itself. */
  action: 'default' | 'link'
  setPrompt: (value: string) => void
  linkRef?: (token: string) => boolean
}

/** Rewrite the draft for one accepted suggestion. */
export function acceptAtRefSuggestion({
  prompt,
  token,
  suggestion,
  action,
  setPrompt,
  linkRef,
}: AcceptAtRefInput): void {
  const before = prompt.slice(0, token.start)
  // Preserve any text after the token — the caret-aware detector can match a
  // token being edited MID-draft, and the rewrite must not eat the tail.
  const after = prompt.slice(token.end)
  const insert = (replacement: string) => setPrompt(`${before}${replacement}${after}`)
  // A COMPLETED link becomes a structured pinned ref (a chip in the composer
  // frame) and the typed partial is REMOVED — no raw token text left behind.
  // Falls back to inserting the token text when the host declines (or for a
  // token shape the pinned channel can't represent).
  const link = (tokenText: string) => {
    if (linkRef?.(tokenText)) {
      // Remove the typed partial, collapsing the seam so no double space is left.
      const joined =
        before.endsWith(' ') && after.startsWith(' ') ? before + after.slice(1) : before + after
      setPrompt(joined)
      return
    }
    insert(`${tokenText} `)
  }
  // ACTION rows (container actions, folder "Link this folder"…) carry a ready-made
  // token (always LINKS, never drills).
  if (suggestion.actionInsert !== undefined) {
    link(suggestion.actionInsert)
    return
  }
  if (suggestion.kind === 'type') {
    insert(suggestion.id)
    return
  }
  if (suggestion.kind === 'ref-path') {
    const path = suggestion.path ?? suggestion.id
    if (action === 'link') {
      // Link the node regardless of type — a directory links as @folder:, a file
      // as @file: (independent of which token kind the user started in).
      link(refToken(suggestion.isDir ? 'folder' : 'file', path))
      return
    }
    if (suggestion.isDir) {
      // Drill: keep typing into the directory (text stays a partial).
      insert(`${refToken(token.kind ?? 'file', path)}/`)
      return
    }
    link(refToken(token.kind ?? 'file', path))
    return
  }
  if (suggestion.kind === 'session') {
    link(refToken('session', suggestion.sessionId ?? suggestion.id))
    return
  }
  if (suggestion.kind === 'project') {
    link(refToken('project', suggestion.projectId ?? suggestion.id))
    return
  }
  if (suggestion.kind === 'terminal' || suggestion.kind === 'call') {
    link(suggestion.insertToken ?? suggestion.id)
    return
  }
  if (suggestion.kind === 'resource') {
    const uri = suggestion.uri ?? suggestion.id
    // Drill (default action on a node WITH children): keep the menu open with a
    // trailing `/`, no space. Otherwise LINK the node (leaf, or the `→`/link
    // gesture on a container): a `localix://resource/chat` node maps back to its NATIVE token
    // (@project:/@session:/@message:) so the pill/expander match the drag-minted
    // native refs; any other scheme links as the generic `@resource:` token.
    if (action === 'default' && suggestion.hasChildren) {
      insert(`@resource:${resourceDrillPartial(uri)}`)
      return
    }
    // Provider categories are navigation-only and can never become a model ref.
    if (suggestion.navigationOnly) {
      insert(`@resource:${resourceDrillPartial(uri)}`)
      return
    }
    link(resourceLinkToken(uri))
    return
  }
  // mention: insert a link-only `@path` token — mentions stay TEXT (only the
  // path reaches the model, and the inline highlight pill is its representation).
  // A directory pick stays open (trailing slash, no space).
  const path = suggestion.path ?? suggestion.id
  insert(suggestion.isDir ? `@${path}/` : `@${path} `)
}

/** Mode-aware empty-state copy (the menu used to say "No matching files." for everything). */
export function atRefEmptyLabel(mode: AtRefToken['mode'] | undefined): string {
  switch (mode) {
    case 'session':
      return 'No matching sessions.'
    case 'project':
      return 'No matching projects.'
    case 'terminal':
      return 'No live terminals.'
    case 'call':
      return 'No matching tool calls.'
    case 'resource':
      return 'Nothing to link here.'
    case 'mention':
    case 'ref-path':
    case 'type':
    case undefined:
      return 'No matching files.'
  }
}

/** The partial the user is typing — used to match-highlight suggestion labels. */
export function atRefHighlightQuery(
  token: AtRefToken | null,
  resourceSegment: string,
  refPathSegment: string,
): string {
  if (!token) return ''
  switch (token.mode) {
    case 'type':
    case 'session':
    case 'project':
    case 'terminal':
    case 'call':
      return token.partial
    case 'resource':
      return resourceSegment
    case 'ref-path':
      return refPathSegment
    case 'mention':
      return token.partial.replace(/^\//, '')
  }
}
