import { BookOpen, Library } from 'lucide-react'
import type { StatusItemState } from '@localixai/mini-app-sdk/ui'
import { miniAppWorkspace, statusMenuList } from '@localixai/mini-app-sdk/ui'
import { useMiniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime-hooks'

const BOOK_KIND = 'reader:book'
const WORKSPACE_KIND = 'reader:workspace'

/**
 * Which book is open — which is to say, what the agent is reading over your shoulder.
 *
 * Reader's premise is that an open book is CONTEXT: `reader_research` answers out of the sources
 * this session has open, and a `@`-reference to one is a durable citation. So the honest thing to
 * put in permanent chrome is not the shelf and not a reading percentage, but the identity of the
 * source the next question will be answered from — which is invisible the moment you leave the
 * book to go and ask.
 *
 * It costs nothing. Open books are work items, and the workspace snapshot is already a
 * subscription every contributed item holds: no request, no cache, no poll.
 *
 * Nothing open, no control — a session that is not reading hears nothing from this mini app.
 *
 * Both tab kinds are session kinds, so every row opens in the session the item is drawn for
 * (`sessionId`). Opened without one, the host had to guess a chat, and a book revealed from one
 * chat's titlebar landed in whichever chat was in front. No session, no item.
 */
export function useReaderStatusItem(sessionId: string | null): StatusItemState | null {
  const workspace = useMiniAppWorkspace()

  const books = Object.entries(workspace.items)
    .filter(([, item]) => item?.kind === BOOK_KIND)
    .map(([id, item]) => ({ id, title: item?.title ?? id }))

  if (sessionId === null || books.length === 0) return null

  const focusedId = workspace.focusedId
  const featured = books.find((book) => book.id === focusedId) ?? books[0]!
  const active = focusedId !== null && books.some((book) => book.id === focusedId)

  const reveal = (book: (typeof books)[number]) =>
    miniAppWorkspace.openWorkItem({
      workKind: BOOK_KIND,
      id: book.id,
      title: book.title,
      scope: sessionId,
    })

  const openLibrary = () =>
    miniAppWorkspace.openWorkItem({
      workKind: WORKSPACE_KIND,
      id: WORKSPACE_KIND,
      title: 'Reader',
      scope: sessionId,
    })

  return {
    label:
      books.length === 1
        ? `Reader — ${featured.title} is open as context`
        : `Reader — ${books.length} books open, showing ${featured.title}`,
    Icon: BookOpen,
    text: featured.title,
    ...(books.length > 1 ? { badge: { count: books.length } } : {}),
    active,
    onClick: () => reveal(featured),
    menu: [
      { id: 'library', label: 'Open Reader', icon: Library, onSelect: openLibrary },
      { separator: true },
      // INLINE, not behind a `Open books ▸` trigger. One collection is one dimension, and a
      // submenu over it costs a hover and a second panel to reach a row that was always going to
      // be the reason this menu was opened.
      ...statusMenuList({
        header: books.length === 1 ? 'Open book' : 'Open books',
        items: books,
        row: (book) => ({
          id: `book:${book.id}`,
          label: book.title,
          selected: book.id === featured.id,
          onSelect: () => reveal(book),
        }),
        onOverflow: openLibrary,
        overflowLabel: (hidden) => `${hidden} more on the shelf…`,
      }),
    ],
  }
}
