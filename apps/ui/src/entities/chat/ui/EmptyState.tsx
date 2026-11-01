import { useReducedMotion } from '@localixai/kit/environment'
import { LocalixBird } from '@localixai/kit/empty-hint'

/** The empty chat: the flying Localix bird and nothing else, model connected or not. */
export function EmptyState() {
  const still = useReducedMotion()

  return (
    <div className="flex flex-1 select-none flex-col items-center justify-center px-4 py-8">
      <LocalixBird src="/logo-dark.svg" still={still} cycles={Infinity} lineCount={10} />
    </div>
  )
}
