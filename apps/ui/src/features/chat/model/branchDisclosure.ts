/**
 * How any branch of the chat list opens: agents, chats, sub-sessions, and whatever nests
 * next.
 *
 * One rule rather than one component, because the tree renders as a FLAT list of rows — a
 * recursive walk pushing `<SessionItem>`s — and wrapping each level in a container component
 * would force a shape on it that its keyboard traversal, its shift-range selection and its
 * virtualization all read against. A shared rule leaves the rows flat and still makes every
 * level behave identically, which is the part that matters.
 */

/**
 * How many children a branch shows before it asks.
 *
 * The list's job is "what am I in the middle of". With several agents, each with several
 * chats, each with forks and workers, the honest answer has to fit on a screen — and the
 * count in the branch's own row says how much is behind it.
 */
export const BRANCH_PREVIEW = 5

export interface BranchState {
  /** Collapsed, not expanded: the absent value means OPEN, which is the default we want. */
  collapsed?: boolean
  /** The user asked for everything past the preview. */
  showAll?: boolean
}

export interface BranchView<T> {
  open: boolean
  /** What to render now — the preview, or all of it. */
  shown: readonly T[]
  /** How many the preview is holding back. Zero when everything is shown. */
  hidden: number
}

/**
 * What a branch shows, given its children and what the user has done to it.
 *
 * `force` is the search case: a match deeper in the tree has to be reachable, so every
 * ancestor opens and nothing is held back. It is not a state change — closing the search
 * leaves the branch exactly as the user left it.
 */
export function branchView<T>(
  items: readonly T[],
  state: BranchState = {},
  force = false,
): BranchView<T> {
  const open = force || !state.collapsed
  const all = force || Boolean(state.showAll)
  const shown = all ? items : items.slice(0, BRANCH_PREVIEW)
  return { open, shown, hidden: items.length - shown.length }
}

/**
 * Flip one branch's entry in a keyed map, treating absent as `false`.
 *
 * It takes the map and nothing else on purpose. The version that also took "the current
 * value" could be handed a DERIVED one — `open` instead of `collapsed`, which is its
 * negation — and then wrote back the value that was already there, so the branch never moved.
 * With one source there is nothing to disagree with.
 */
export function toggleBranch(state: Record<string, boolean>, key: string): Record<string, boolean> {
  return { ...state, [key]: !state[key] }
}
