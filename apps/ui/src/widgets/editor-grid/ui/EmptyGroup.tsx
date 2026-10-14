import { LayoutGrid } from 'lucide-react'
import { StateNotice } from '@localixai/kit/state-notice'

/** Neutral placeholder for a SECONDARY empty editor group (e.g. one created by a
 *  split, or left empty after its tabs were closed). Deliberately NOT the chat
 *  greeting (that is reserved for a truly empty workspace) so an empty group
 *  never reads as a duplicate chat home screen.
 *
 *  Closing the focused session's chat tab can deliberately land here: the session
 *  remains in history and re-clicking it reopens its chat WorkItem. */
export function EmptyGroup() {
  return (
    <StateNotice
      icon={LayoutGrid}
      title="Empty group"
      body="Drag a tab here, or open a file from the sidebar."
    />
  )
}
