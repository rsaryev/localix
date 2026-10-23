import { FileSpreadsheet, FileText, Presentation } from 'lucide-react'
import type { IconComponent, StatusItemState } from '@localixai/mini-app-sdk/ui'
import { miniAppWorkspace, statusMenuList } from '@localixai/mini-app-sdk/ui'
import { fileExtension } from '@localixai/mini-app-sdk/ui/file-types'
import { useMiniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime-hooks'

/**
 * The formats this mini app OWNS a viewer for, and the glyph each reads as.
 *
 * Duplicated from `register.tsx`'s three sets on purpose — the same reason the comment there gives
 * for not re-reading the routing registry per match. What is shared here is the LIST, and it is
 * short enough that one map is clearer than an import that inverts the dependency: the status item
 * would otherwise pull the whole registration module, lazy viewer chunks and all, into the
 * titlebar's eager path.
 */
const VIEWER_MARKS: Readonly<Record<string, IconComponent>> = {
  pdf: FileText,
  docx: FileText,
  doc: FileText,
  odt: FileText,
  pptx: Presentation,
  xlsx: FileSpreadsheet,
  xls: FileSpreadsheet,
  xlsm: FileSpreadsheet,
  xlsb: FileSpreadsheet,
  csv: FileSpreadsheet,
}

/** The tail of a path, which is what a person calls the file. */
function basename(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? path : path.slice(cut + 1)
}

/**
 * The documents this session has open in a dedicated viewer.
 *
 * WHY this and not the count of formats the mini app can read, or a "Documents" launcher: the mini
 * app has no workspace of its own to launch. It is a set of VIEWERS, so the only live fact it owns
 * is which files are currently inside one — and that fact is genuinely hard to see. A PDF opened
 * into a second grid group, or into a group whose tab strip is scrolled, is open and invisible; the
 * file tree shows where it lives, never that it is on screen somewhere. This is the one place that
 * answers "where did that spreadsheet go".
 *
 * It costs NOTHING. Open tabs are the workspace snapshot every contributed item already subscribes
 * to: no request, no cache, no poll, and no import of the viewer chunks it names.
 *
 * Nothing open in a viewer, no control. A session that is not reading a document hears nothing
 * from this mini app — the same silence rule every other bundled item follows.
 *
 * A row re-opens its file in the session the item is drawn for (`sessionId`), never "the active
 * one": the item is mounted per surface, and a guessed chat opened the file in whichever chat was
 * in front. No session, no item — there is no chat to open the file into.
 */
export function useDocumentsStatusItem(sessionId: string | null): StatusItemState | null {
  const workspace = useMiniAppWorkspace()

  const documents = Object.entries(workspace.items)
    .filter(([, item]) => item?.kind === 'file')
    .map(([id, item]) => ({
      id,
      path: typeof item?.payload?.path === 'string' ? item.payload.path : '',
      title: item?.title ?? id,
    }))
    .filter((entry) => entry.path !== '' && VIEWER_MARKS[fileExtension(entry.path)] !== undefined)

  if (sessionId === null || documents.length === 0) return null

  const focusedId = workspace.focusedId
  const featured = documents.find((document) => document.id === focusedId) ?? documents[0]!
  const active = focusedId !== null && documents.some((document) => document.id === focusedId)

  // Re-opening an already-open file is how the host reveals it — the same gesture the file tree
  // uses, so a row here lands the person on the tab rather than making a second one.
  const reveal = (path: string) => () => miniAppWorkspace.openFile({ sessionId, path })

  return {
    label:
      documents.length === 1
        ? `Documents — ${basename(featured.path)} is open`
        : `Documents — ${documents.length} open, showing ${basename(featured.path)}`,
    Icon: VIEWER_MARKS[fileExtension(featured.path)] ?? FileText,
    text: basename(featured.path),
    ...(documents.length > 1 ? { badge: { count: documents.length } } : {}),
    active,
    onClick: reveal(featured.path),
    menu: statusMenuList({
      header: documents.length === 1 ? 'Open document' : 'Open documents',
      items: documents,
      row: (document) => ({
        id: `document:${document.id}`,
        label: basename(document.path),
        icon: VIEWER_MARKS[fileExtension(document.path)] ?? FileText,
        // `selected`, not `checked`: a checkbox's mark takes the icon's slot, so the featured
        // document lost the file-type glyph that tells a spreadsheet from a PDF.
        selected: document.id === featured.id,
        onSelect: reveal(document.path),
      }),
    }),
  }
}
