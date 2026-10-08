import { visibleNativePageFrame } from '@/features/inspector/model/nativePageFrame'
import type { WindowDragPacket } from './provisionalWindowDrag'

export type SnapshotRect = [number, number, number, number]
export interface WorkspaceDragSnapshot {
  rect: SnapshotRect
  browser?: { pageId: string; rect: SnapshotRect }
}

function visibleRect(element: HTMLElement): SnapshotRect | undefined {
  if (!element.isConnected || element.closest('[hidden], [data-grid-hidden]')) return
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return
  const bounds = element.getBoundingClientRect()
  const left = Math.max(0, bounds.left)
  const top = Math.max(0, bounds.top)
  const right = Math.min(window.innerWidth, bounds.right)
  const bottom = Math.min(window.innerHeight, bounds.bottom)
  if (right > left && bottom > top) return [left, top, right - left, bottom - top]
}

/** Inactive tabs must never borrow the visible conversation or Browser's picture. */
export function workspaceDragSnapshot(packet: WindowDragPacket): WorkspaceDragSnapshot | undefined {
  const panel = [...document.querySelectorAll<HTMLElement>('[data-work-item-id]')].find(
    (element) =>
      element.getAttribute('data-work-item-id') === packet.payload.item.id && visibleRect(element),
  )
  if (!panel) return
  const rect = visibleRect(panel)!
  const pageId = packet.payload.browser?.activeId
  if (
    pageId &&
    ![...panel.querySelectorAll<HTMLElement>('[data-browser-page-id]')].some(
      (element) => element.getAttribute('data-browser-page-id') === pageId && visibleRect(element),
    )
  )
    return
  const host = [...panel.querySelectorAll<HTMLElement>('[data-native-page-id]')].find(
    (element) => element.getAttribute('data-native-page-id') === pageId && visibleRect(element),
  )
  // The inner page being detached may be inactive while its Browser panel is visible.
  if (pageId && !host && panel.querySelector('[data-native-page-id]')) return
  const frame = host && visibleNativePageFrame(host)
  const browserRect: SnapshotRect | undefined = frame
    ? [frame.x, frame.y, frame.width, frame.height]
    : undefined
  return {
    rect,
    ...(pageId && browserRect ? { browser: { pageId, rect: browserRect } } : {}),
  }
}
