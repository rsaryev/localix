export interface EditHistory<T> {
  value: T
  past: T[]
  future: T[]
  editedAt: number
}
export function startHistory<T>(value: T): EditHistory<T> {
  return { value: structuredClone(value), past: [], future: [], editedAt: 0 }
}
/** Consecutive typing joins one undo step; structural edits can start an immediate step. */
export function editHistory<T>(
  state: EditHistory<T>,
  value: T,
  now: number,
  group = true,
): EditHistory<T> {
  if (JSON.stringify(state.value) === JSON.stringify(value)) return state
  const joined =
    group && state.editedAt > 0 && now - state.editedAt < 700 && state.future.length === 0
  return {
    value: structuredClone(value),
    past: joined ? state.past : [...state.past, state.value].slice(-60),
    future: [],
    editedAt: now,
  }
}
export function undoHistory<T>(state: EditHistory<T>): EditHistory<T> {
  const previous = state.past.at(-1)
  return previous === undefined
    ? state
    : {
        value: previous,
        past: state.past.slice(0, -1),
        future: [state.value, ...state.future],
        editedAt: 0,
      }
}
export function redoHistory<T>(state: EditHistory<T>): EditHistory<T> {
  const next = state.future[0]
  return next === undefined
    ? state
    : {
        value: next,
        past: [...state.past, state.value],
        future: state.future.slice(1),
        editedAt: 0,
      }
}
