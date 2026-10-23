import { ProblemState, type MiniAppProblemLineProps } from '@localixai/mini-app-sdk/ui/components'
import { useDbProblem, type DbProblemOptions } from '../problems'

/**
 * A per-object introspection failure — the state that used to render as a spinner
 * forever, because `schemaStore` swallowed the rejection and left the table simply
 * "not there yet". The engine's reason is the headline, and the retry rides with it,
 * because nothing re-reads an object by itself.
 *
 * Ownership is a HOOK, not this component, and that split is the whole point: the pane
 * renders this only in its failing branch, so a component that both owned and rendered the
 * report could never say the failure ended — it was unmounted the moment it did. The host
 * calls {@link useObjectProblem} unconditionally and renders the line where it belongs.
 */
export function useObjectProblem(
  /** Event Center subject — the thing that could not be read, not the sentence about it. */
  subject: string,
  error: string | null | undefined,
  onRetry: () => void,
  options: DbProblemOptions = {},
): MiniAppProblemLineProps | null {
  return useDbProblem(subject, error, {
    ...options,
    actions: [{ id: 'retry', label: 'Retry', run: onRetry }, ...(options.actions ?? [])],
  })
}

export function ObjectErrorState({ problem }: { problem: MiniAppProblemLineProps }) {
  return <ProblemState {...problem} />
}
