import { useEffect, useMemo, useRef } from 'react'
import type { CardActions } from './card-actions'

/**
 * Freeze a card-action set behind a latest-value ref.
 *
 * The underlying handlers legitimately change identity every board frame — most
 * close over `tasks` — so handing them to a card directly means every card's props
 * change every frame and `memo` never bails. This returns ONE object, created once,
 * that forwards to whatever the latest handlers are. The ref is refreshed in an
 * effect, which React flushes at commit time, i.e. strictly before the browser can
 * deliver the next click/drag — so a call can never route to a stale closure.
 */
export function useCardActions(live: CardActions): CardActions {
  const ref = useRef(live)
  useEffect(() => {
    ref.current = live
  }, [live])
  return useMemo<CardActions>(
    () => ({
      open: (taskId) => ref.current.open(taskId),
      quickMove: (taskId, to) => ref.current.quickMove(taskId, to),
      keyboardMove: (task, dir) => ref.current.keyboardMove(task, dir),
      select: (taskId, mods) => ref.current.select(taskId, mods),
      dragStart: (event, task) => ref.current.dragStart(event, task),
      dragEnd: () => ref.current.dragEnd(),
      requestDelete: (taskId) => ref.current.requestDelete(taskId),
    }),
    [],
  )
}
