/**
 * The weakest operation a message may receive, as an identity that survives a rebuilt menu.
 *
 * Separate from the menu itself (`op-menu.ts`) because it answers a different question: the
 * menu says what a message CAN be shrunk to today, a floor says what it already WAS shrunk to
 * and must never re-inflate past — a checkpoint's allocator reads floors from the view in
 * force, and a floor that drifted with the menu's shape would undo that view.
 */
import type { Operation } from './op-menu'

/**
 * Stable cross-run identity for the weakest operation a message may receive.
 *
 * A menu index is not stable: adding/removing a live-read exemption can insert
 * `elide` between `verbatim` and the lossy chain. Persisting the index would then
 * reinterpret a previous `truncate` floor as `elide` and re-inflate the lossy
 * payload. The semantic identity below is independent of the current menu shape.
 */
export type OperationFloor =
  | { kind: 'elide' }
  | { kind: 'truncate'; maxChars: number }
  | { kind: 'oneline' }
  | { kind: 'pointer' }
  | { kind: 'fold' }

/** Convert a selected operation into its stable cross-run floor identity. */
export function operationFloorOf(operation: Operation): OperationFloor | undefined {
  switch (operation.kind) {
    case 'verbatim':
      return undefined
    case 'truncate':
      return {
        kind: 'truncate',
        maxChars: Math.max(0, Math.floor(operation.truncateChars ?? 0)),
      }
    case 'elide':
    case 'oneline':
    case 'pointer':
    case 'fold':
      return { kind: operation.kind }
  }
}

function compareOperationFloors(left: OperationFloor, right: OperationFloor): number {
  const rank = (floor: OperationFloor): number => {
    switch (floor.kind) {
      case 'elide':
        return 1
      case 'truncate':
        return 2
      case 'oneline':
        return 3
      case 'pointer':
        return 4
      case 'fold':
        return 5
    }
  }
  const rankDelta = rank(left) - rank(right)
  if (rankDelta !== 0) return rankDelta
  if (left.kind !== 'truncate' || right.kind !== 'truncate') return 0
  // Keeping fewer characters is the stronger truncate floor.
  return right.maxChars - left.maxChars
}

/** Keep the stronger of two stable floors. */
export function strongestOperationFloor(
  left: OperationFloor | undefined,
  right: OperationFloor | undefined,
): OperationFloor | undefined {
  if (!left) return right
  if (!right) return left
  return compareOperationFloors(left, right) >= 0 ? left : right
}

/**
 * Resolve a stable floor against today's dynamic menu.
 *
 * An `elide` floor is applicable only when today's message still has an elide
 * operation. If a read is currently protected, forcing the next lossy operation
 * would destroy unrelated non-recoverable output merely because the recoverable
 * operation is temporarily unavailable.
 */
export function operationIndexForFloor(
  menu: readonly Operation[],
  floor: OperationFloor,
): number | undefined {
  if (floor.kind === 'elide') {
    const index = menu.findIndex((operation) => operation.kind === 'elide')
    return index >= 0 ? index : undefined
  }
  for (let index = 0; index < menu.length; index++) {
    const candidate = operationFloorOf(menu[index])
    if (candidate && compareOperationFloors(candidate, floor) >= 0) return index
  }
  return undefined
}
