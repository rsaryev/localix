import type { ReactNode } from 'react'
import { Globe2 } from 'lucide-react'
import {
  WorkbenchListRow,
  WorkbenchListRowLeading,
  WorkbenchListRowText,
  WorkbenchListRowTrigger,
} from '@localixai/kit/workbench-list-row'
import { visitName, type BrowserVisit } from '../model/browserHistory'

/**
 * One visited page, drawn the same wherever the browser lists them: the new tab's recent pages
 * and the History tab. The two drew their own rows before — one named an untitled page by the
 * same address twice, the other printed the raw URL in a code font.
 */
export function BrowserVisitRow({
  visit,
  onOpen,
  children,
}: {
  visit: BrowserVisit
  onOpen: (url: string) => void
  /** What follows the page: passive detail and the row's own actions, siblings of the trigger. */
  children?: ReactNode
}) {
  const name = visitName(visit)
  return (
    <WorkbenchListRow>
      <WorkbenchListRowTrigger onClick={() => onOpen(visit.url)} title={visit.url}>
        <WorkbenchListRowLeading>
          <Globe2 className="size-3.5" />
        </WorkbenchListRowLeading>
        <WorkbenchListRowText title={name.title} description={name.address} />
      </WorkbenchListRowTrigger>
      {children}
    </WorkbenchListRow>
  )
}
