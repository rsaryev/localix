const waiting = new Map<string, () => void>()

/** A hidden WebKit window can commit DOM without receiving an animation frame. */
export function waitForTransferredLayout(id: string, budgetMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const complete = () => {
      clearTimeout(timer)
      waiting.delete(id)
      resolve()
    }
    const timer = setTimeout(
      () => {
        waiting.delete(id)
        reject(new Error('The transferred tab did not mount'))
      },
      Math.max(0, budgetMs),
    )
    waiting.set(id, complete)
  })
}

/** Called after the grid commits its active panels, before requesting native visibility. */
export function acknowledgeTransferredLayout(root: HTMLElement): void {
  if (!waiting.size) return
  for (const panel of root.querySelectorAll<HTMLElement>('[data-work-item-id]')) {
    if (!panel.isConnected || panel.closest('[hidden], [data-grid-hidden]')) continue
    const id = panel.getAttribute('data-work-item-id')
    if (id) waiting.get(id)?.()
  }
}
