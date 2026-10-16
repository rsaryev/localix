/**
 * Which file-tree change an "Undo" button belongs to.
 *
 * The server keeps one newest-last journal per session and `undoFileOp` always reverses its TOP —
 * it takes no argument. Every row published by `toastUndo` offered that same call, so after "Renamed
 * to “b”" and then "Moved “c”", clicking Undo on the rename row moved “c” back instead: a different
 * change from the one the row names, and one the person may not have noticed until later. A durable
 * Event Center row makes that easy to hit, because the older row is still sitting right there.
 *
 * So each reversible change gets a token, stacked in the same order the server journals the change,
 * and a row's Undo may run only while its token is the top one. Every change the server journals has
 * to be recorded here — including the ones that publish no row (a batch move to Trash) — or the two
 * stacks drift and the check stops meaning anything. A successful undo pops; an empty or cleared
 * server journal empties this one too. The cap matches the server's (`MAX_OPS`), which evicts the
 * oldest the same way.
 */

const CAP = 20

export interface UndoTokens {
  /** A change the server just journaled. Returns the token its row checks at click time. */
  record: () => number
  /** Whether `token` is still the change `undoFileOp` would reverse. */
  isLatest: (token: number) => boolean
  /** The server reversed its top change. */
  popped: () => void
  /** The server had nothing (left) to reverse — its journal is empty or was cleared. */
  cleared: () => void
}

export function createUndoTokens(): UndoTokens {
  let next = 0
  const stack: number[] = []
  return {
    record() {
      next += 1
      stack.push(next)
      while (stack.length > CAP) stack.shift()
      return next
    },
    isLatest: (token) => stack.length > 0 && stack[stack.length - 1] === token,
    popped() {
      stack.pop()
    },
    cleared() {
      stack.length = 0
    },
  }
}
