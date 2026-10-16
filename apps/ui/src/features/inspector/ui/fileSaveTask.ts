import type { RefObject } from 'react'

export interface PendingFileSave {
  content: string
  task: Promise<boolean>
}

/** A completed older write must not clear the slot now occupied by a newer write. */
export function trackFileSaveTask(
  pending: RefObject<PendingFileSave | null>,
  content: string,
  task: Promise<boolean>,
): Promise<boolean> {
  pending.current = { content, task }
  const clear = () => {
    if (pending.current?.task === task) pending.current = null
  }
  void task.then(clear, clear)
  return task
}
