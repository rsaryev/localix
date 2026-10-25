import { CircleAlert } from 'lucide-react'

/**
 * Sources that could not be read this time, each one quiet line: the Store still shows what the
 * others offer, and Sources says more.
 */
export function StoreProblems({ problems }: { problems: readonly string[] }) {
  if (problems.length === 0) return null
  return (
    <ul aria-label="Sources not read" className="flex flex-col gap-0.5">
      {problems.map((problem) => (
        <li key={problem} className="flex min-w-0 items-center gap-1.5 text-xs text-text-soft">
          <CircleAlert className="size-3.5 shrink-0 text-status-warning" aria-hidden />
          <span className="min-w-0 truncate" title={problem}>
            {problem}
          </span>
        </li>
      ))}
    </ul>
  )
}
