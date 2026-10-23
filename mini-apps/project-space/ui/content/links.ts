import type { MessageContextBindingDraft } from '@localixai/mini-app-sdk/ui'
import type { RefProps } from '../../shared/types/app-links'

/**
 * What an app link BECOMES on the board — the one decision every way a link arrives goes through:
 * a drag from the chat, a file tree, a tab, a mini app's panel, or a pasted `@session:…` /
 * `localix://…` (turned into the same link by the host's grammar, `@localixai/kit/context-links`).
 *
 * A link to a file or a folder is the board's file or folder card, which reads the file; a
 * snippet is a code card holding its text, because a snippet has nothing else to point at; every
 * other link — a session, a message, a tool call, a terminal, a project, a provider's resource, a
 * stored attachment — is an app link card that the host draws live.
 */
export type LinkContent =
  | { kind: 'path'; path: string; isDir: boolean }
  | { kind: 'element'; type: string; props: Record<string, unknown> }

export function contentOfLink(link: MessageContextBindingDraft): LinkContent | null {
  const { target } = link
  const attributes = target.attributes ?? {}
  const path = attributes.path
  if (target.kind === 'file' && typeof path === 'string' && path && !attributes.mediaId)
    return { kind: 'path', path: path.replace(/\/+$/u, '') || path, isDir: path.endsWith('/') }
  if (target.kind === 'snippet') {
    const code = attributes.content
    if (typeof code !== 'string') return null
    const language = typeof attributes.language === 'string' ? attributes.language : ''
    return { kind: 'element', type: 'code', props: { code, language, title: target.label } }
  }
  const props: RefProps = {
    kind: target.kind,
    token: target.token,
    label: target.label,
    ...(target.uri ? { uri: target.uri } : {}),
    ...(target.attributes ? { attributes: target.attributes } : {}),
    ...(link.miniApp ? { miniApp: link.miniApp } : {}),
  }
  return { kind: 'element', type: 'ref', props }
}
