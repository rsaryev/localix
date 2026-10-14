/**
 * Load the plugin scopes of one reconcile so a slow project cannot hold every other one back.
 *
 * The defect: scopes were discovered one after another, and the backend host wires nothing until
 * the LAST answered. A project whose directory sits behind a macOS folder-access prompt (a project
 * in Documents after a rebuild) blocked its scan until the user clicked — measured 2.8 s in which
 * no plugin of ANY project was wired, and every plugin request waited on it. And most bundled
 * plugins are enabled per project, so "wire the global scope first" alone fixes nothing.
 *
 * So the global scope loads first (it performs the one shared bundled-plugin sync the others then
 * reuse), every project scope loads concurrently, and a project that has not answered within
 * `budgetMs` is left out of this pass. When it does answer, `onLate` asks for another reconcile,
 * which picks it up. Results keep the input order, so the merged backend list is deterministic.
 */
/**
 * How long a project scope may take before this pass wires without it. A project scope answers in
 * ~20 ms (measured on a packaged launch); this leaves room for a cold disk and none for a prompt
 * waiting on a person.
 */
export const PLUGIN_SCOPE_BUDGET_MS = 1_500

export interface ScopeLoad<T> {
  /** The project id, or `''` for the global scope. */
  key: string
  load: () => Promise<T>
}

export interface ScopeLoadResult<T> {
  /** The answered scopes, first scope first, projects in their input order. */
  results: T[]
  /** Projects that missed the budget; their plugins join on the next reconcile. */
  late: string[]
}

export async function loadScopesWithinBudget<T>(input: {
  first: ScopeLoad<T>
  rest: readonly ScopeLoad<T>[]
  budgetMs: number
  /** A late scope finished (answered or failed) after `ms`; reconcile again to include it. */
  onLate: (key: string, ms: number) => void
}): Promise<ScopeLoadResult<T>> {
  const first = await input.first.load()
  const started = performance.now()
  const LATE = Symbol('late')
  const settled = await Promise.all(
    input.rest.map(async (scope) => {
      const pending = scope.load()
      let timer: ReturnType<typeof setTimeout> | undefined
      const outcome = await Promise.race([
        pending,
        new Promise<typeof LATE>(
          (resolve) => (timer = setTimeout(() => resolve(LATE), input.budgetMs)),
        ),
      ])
      clearTimeout(timer)
      if (outcome !== LATE) return { key: scope.key, value: outcome as T }
      // Whatever it ends in, the next reconcile loads it again and reports its own outcome.
      const late = () => input.onLate(scope.key, Math.round(performance.now() - started))
      pending.then(late, late)
      return { key: scope.key, late: true as const }
    }),
  )
  const results: T[] = [first as T]
  const late: string[] = []
  for (const entry of settled) {
    if ('late' in entry) late.push(entry.key)
    else results.push(entry.value)
  }
  return { results, late }
}
