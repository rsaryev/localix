/**
 * Greedy value-budget allocator (pure). Given each message's downgrade menu and
 * task value, choose an operation per message so total cost ≤ budget while
 * minimizing quality loss: repeatedly apply the downgrade with the smallest
 * loss-density Δvalue/Δcost until the budget is met. O(M log M) over M total menu
 * entries via a binary min-heap. Locked messages stay verbatim (op index 0).
 *
 * Lossless-first emerges for free: a superseded message's pointer retention ≈ its
 * verbatim retention ⇒ Δvalue ≈ 0 ⇒ density ≈ 0 ⇒ popped first.
 */
import type { Operation } from './op-menu'

interface Downgrade {
  msg: number
  from: number
  to: number
  dCost: number
  density: number
  lossless: boolean
}

class MinHeap {
  private a: Downgrade[] = []
  get size(): number {
    return this.a.length
  }
  peek(): Downgrade | undefined {
    return this.a[0]
  }
  push(x: Downgrade): void {
    const a = this.a
    a.push(x)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].density <= a[i].density) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop(): Downgrade | undefined {
    const a = this.a
    if (a.length === 0) return undefined
    const top = a[0]
    const last = a.pop() as Downgrade
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let s = i
        if (l < a.length && a[l].density < a[s].density) s = l
        if (r < a.length && a[r].density < a[s].density) s = r
        if (s === i) break
        ;[a[s], a[i]] = [a[i], a[s]]
        i = s
      }
    }
    return top
  }
}

const EPS = 1e-9

function nextDowngrade(
  menu: Operation[],
  value: number,
  msg: number,
  from: number,
): Downgrade | undefined {
  const to = from + 1
  if (to >= menu.length) return undefined
  const dCost = menu[from].cost - menu[to].cost
  if (dCost <= 0) return undefined // never a worthwhile downgrade
  const lossless = menu[to].lossless === true
  const dValue = value * (menu[from].retention - menu[to].retention)
  // Lossless downgrades sort first (−∞) and are applied regardless of budget.
  const density = lossless ? Number.NEGATIVE_INFINITY : Math.max(0, dValue) / Math.max(dCost, EPS)
  return { msg, from, to, dCost, density, lossless }
}

/**
 * @param drainLossless apply `lossless` downgrades even when already under budget.
 *   They cost ~no task value, but they are only RECOVERABLE, not free: the model
 *   pays a `tool_output` round-trip (or a full re-read) to get the bytes back.
 *   Draining them with an empty window is a pure loss, so the caller gates this on
 *   real context pressure. `false` ⇒ nothing is downgraded while cost ≤ budget.
 * @returns the chosen op index per message (0 = verbatim). Total cost is ≤ budget
 *   when feasible; otherwise every unlocked message is driven to its cheapest op.
 */
export function allocate(
  menus: Operation[][],
  values: number[],
  budget: number,
  locked: ReadonlySet<number>,
  drainLossless = true,
): number[] {
  const N = menus.length
  const op = Array.from({ length: N }, () => 0)
  let cost = 0
  for (let i = 0; i < N; i++) cost += menus[i][0].cost

  const heap = new MinHeap()
  for (let i = 0; i < N; i++) {
    if (locked.has(i)) continue
    const d = nextDowngrade(menus[i], values[i], i, 0)
    if (d) heap.push(d)
  }

  // Apply downgrades while over budget, plus — when the caller says context pressure
  // warrants it — the near-lossless ones (they sort first via −∞ density).
  while (
    heap.size > 0 &&
    (cost > budget || (drainLossless && (heap.peek() as Downgrade).lossless))
  ) {
    const d = heap.pop() as Downgrade
    if (d.from !== op[d.msg]) continue // stale entry — message already moved past
    op[d.msg] = d.to
    cost -= d.dCost
    const next = nextDowngrade(menus[d.msg], values[d.msg], d.msg, d.to)
    if (next) heap.push(next)
  }

  return op
}
