import type { MessageBindingTargetKind } from './contrib'

/** Composer dropzone pseudo-kind for native OS file uploads. */
export const OS_FILES_DRAG_KIND = 'files'

export const DROP_HINTS: Record<MessageBindingTargetKind, string> = {
  file: 'Link file to message',
  session: 'Link session to message',
  project: 'Link project to message',
  message: 'Link message to message',
  terminal: 'Link terminal to message',
  call: 'Link tool call to message',
  resource: 'Link resource to message',
  snippet: 'Attach snippet to message',
}

export function composerDropHint(kind: string): string {
  if (kind === OS_FILES_DRAG_KIND) return 'Drop files to attach'
  const known = (DROP_HINTS as Record<string, string>)[kind]
  if (known) return known
  if (kind !== 'binding' && /^[a-z][a-z-]*$/.test(kind))
    return `Link ${kind.replace(/-/g, ' ')} to message`
  return 'Link to message'
}
