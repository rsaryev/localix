import type { ActionContext } from '@localixai/mini-app-sdk/ui'
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { SPACE_KIND, SPACE_TITLE } from '../shared/resource'
import { spaceApi } from './api'
import { canAddToSpace, contentOperation } from './action-target'
import { requestAddedFocus } from './camera/useAddedFocus'
import { keepActionImage } from './keep-action-image'
import { prepareFragmentId } from './fragmentIdentity'

export async function addContentToSpace(context: ActionContext) {
  if (!canAddToSpace(context)) throw new Error('This content cannot be added to the board.')
  const { sessionId, target } = context
  const id = await prepareFragmentId(target)
  const operation =
    target.kind === 'image'
      ? {
          op: 'create' as const,
          type: 'image',
          props: {
            ...(await keepActionImage(sessionId, target.src)),
            alt: target.alt ?? target.title ?? '',
          },
        }
      : contentOperation(target)
  const answer = await spaceApi.apply(sessionId, [{ ...operation, id }]).catch(async (failure) => {
    // A lost response does not imply a lost save. Read back the stable id without retrying the
    // write; a completed save is shown once and a genuine failure remains a failure.
    const recovered = await spaceApi.space(sessionId).catch(() => null)
    if (!recovered?.space.elements[id]) throw failure
    return { ...recovered, results: [{ ok: true as const, id }] }
  })
  const result = answer.results[0]
  // A second surface may have sent the same copy before seeing the first save. The server's
  // taken-id refusal is already-present content, not a failed add, and creates no extra undo.
  if (!result?.ok && !answer.space?.elements[id])
    throw new Error(result?.error || 'The board did not accept the content.')
  // Asked before the tab opens: a board that mounts for it takes the request on its first look.
  requestAddedFocus(sessionId, [id])
  miniAppWorkspace.openWorkItem({
    workKind: SPACE_KIND,
    id: SPACE_KIND,
    title: SPACE_TITLE,
    scope: sessionId,
  })
  return { message: 'Added to Project Space' }
}
