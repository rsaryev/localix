import type { ActionContext } from '@localixai/mini-app-sdk/ui'
import { canAddToSpace } from './action-target'
import { knownFragmentId, prepareFragmentId } from './fragmentIdentity'
import { savedSpaceView, watchSpaceUpdates } from './spaceUpdates'
import { containsFragment } from './fragmentPresence'

/** The mini app, including its read model, decides whether a destination still needs this copy. */
export function needsContent(context: ActionContext) {
  if (!canAddToSpace(context)) return false
  const id = knownFragmentId(context.target)
  const view = savedSpaceView(context.sessionId)
  return !!id && !!view && !view.space.elements[id] && !containsFragment(view.space, context.target)
}

export function subscribeContent(context: ActionContext, onChange: () => void) {
  if (!canAddToSpace(context)) return () => {}
  let active = true
  void prepareFragmentId(context.target)
    .then(() => {
      if (active) onChange()
    })
    .catch(() => {})
  const release = watchSpaceUpdates(context.sessionId, onChange)
  return () => {
    active = false
    release()
  }
}
