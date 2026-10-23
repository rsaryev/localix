import { runMiniAppAction, toast } from '@localixai/mini-app-sdk/ui'
import { miniAppFiles } from '@localixai/mini-app-sdk/ui/runtime'
import { captureBoard } from '@localixai/kit/canvas'
import { platformCapabilities } from '@localixai/kit/platform'
import type { SpaceDocument, SpaceElement } from '../../shared/format/document'
import { contentBounds } from '../../shared/ops/geometry'
import { boundsOfBoxes } from '../../shared/ops/layout'

/**
 * "Copy as image": the selection, or the whole board, as a PNG on the clipboard.
 *
 * The picture is the board at reading size, not the person's view of it: while it is taken the
 * board is drawn at full depth (connector labels and fine print back, whatever the zoom) with the
 * selection chrome off (`reading.css`, `[data-capturing]`), and `--space-zoom` at 1 so a frame's
 * title is its real size rather than the enlarged one a far camera gives it. All of that is undone
 * the moment the copy is cloned (`captureBoard`).
 *
 * A clipboard that refuses an image — the engine only lets a page write one it trusts — gets a
 * saved file instead, and the toast says which happened.
 */
export function copyBoardImage(
  root: HTMLElement | null,
  space: SpaceDocument,
  ids: readonly string[],
  /** Draw every element, also those out of view, until the returned release is called. */
  drawAll: () => Promise<() => void> = async () => () => {},
  /** `save` writes a PNG file instead of trying the clipboard first. */
  mode: 'copy' | 'save' = 'copy',
) {
  runMiniAppAction(async () => {
    if (!root) return
    const live = ids.filter((id) => space.elements[id])
    const box = live.length
      ? boundsOfBoxes(live.map((id) => space.elements[id] as SpaceElement))
      : contentBounds(space)
    if (!box) return void toast.info('The board is empty: there is nothing to copy')
    const release = await drawAll()
    const blob = await captureBoard(
      root,
      { x: box.x, y: box.y, width: box.w, height: box.h },
      { prepare: () => drawForTheCopy(root) },
    ).finally(release)
    const what = live.length ? `${live.length} element${live.length === 1 ? '' : 's'}` : 'The board'
    if (mode === 'save') {
      await miniAppFiles.saveBlob('project-space.png', blob)
      return void toast.success(`${what} saved as project-space.png`)
    }
    if (await platformCapabilities().clipboard.writeBlob(blob, 'image/png'))
      return void toast.success(`${what} copied as an image`)
    await miniAppFiles.saveBlob('project-space.png', blob)
    toast.info(`${what} saved as project-space.png`, {
      description: 'The clipboard did not take the image.',
    })
  }, 'Could not copy the board as an image.')
}

function drawForTheCopy(root: HTMLElement): () => void {
  const depth = root.getAttribute('data-depth')
  const zoom = root.style.getPropertyValue('--space-zoom')
  root.setAttribute('data-capturing', '')
  root.setAttribute('data-depth', 'full')
  root.style.setProperty('--space-zoom', '1')
  return () => {
    root.removeAttribute('data-capturing')
    if (depth) root.setAttribute('data-depth', depth)
    if (zoom) root.style.setProperty('--space-zoom', zoom)
    else root.style.removeProperty('--space-zoom')
  }
}
