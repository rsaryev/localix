import type { DragEvent } from 'react'
import type { MessageContextBindingDraft } from '@localixai/mini-app-sdk/ui'
import { setMessageBindingDrag } from '@localixai/mini-app-sdk/ui/message-binding-drag'

/**
 * Makes anything the chat SHOWS as a link draggable as that link — a sent pill, a composer chip,
 * a message, an attachment, a path in a tool card — onto any surface that takes links: another
 * composer, a plugin board, an editor tab.
 *
 * Every one of those used to be click-only, so a person could see a session, a call or a file in
 * the chat and have no way to carry it anywhere but by retyping its token. One helper, so each
 * surface only says WHICH link it is; the transport (`setMessageBindingDrag`), the compact ghost
 * and the `text/plain` token fallback are the same for all of them.
 *
 * The drag does not stop the element's click: a press that does not move is still a click.
 */
export function linkDragProps(link: () => MessageContextBindingDraft | null) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      const binding = link()
      if (!binding) return event.preventDefault()
      event.stopPropagation()
      const token = binding.target.token
      setMessageBindingDrag(event.dataTransfer, binding, token ? { plainText: token } : undefined)
    },
  } as const
}
