import { WorkspaceTipsCarousel } from '@/widgets/workspace-tips/ui/WorkspaceTipsCarousel'

/** What an editor group shows when no chat or tab is open in it (e.g. one created by a
 *  split, or left empty after its tabs were closed). Deliberately NOT the chat greeting
 *  (that is reserved for a truly empty workspace) so an empty group never reads as a
 *  duplicate chat home screen; it carries the workspace tips carousel instead.
 *
 *  Closing the focused session's chat tab can deliberately land here: the session
 *  remains in history and re-clicking it reopens its chat WorkItem. */
export function EmptyGroup() {
  return <WorkspaceTipsCarousel />
}
