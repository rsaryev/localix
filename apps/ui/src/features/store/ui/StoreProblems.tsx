import { CircleAlert } from 'lucide-react'
import type { StoreProblem } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { useStoreScope } from '../model/storeContext'

/**
 * Sources of what this list shows that could not be read this time, as one quiet line: the list
 * still shows what the others offer. Which source and why is Sources' to say, so the line leads
 * there and keeps the reasons for its tooltip; the server sends only the kinds this list lists.
 */
export function StoreProblems({ problems }: { problems: readonly StoreProblem[] }) {
  const store = useStoreScope()
  const messages = [...new Set(problems.map((problem) => problem.message))]
  if (messages.length === 0) return null
  const count = messages.length === 1 ? '1 source' : `${messages.length} sources`
  return (
    <div
      role="status"
      aria-label="Sources not read"
      title={messages.join('\n')}
      className="flex min-w-0 items-center gap-1.5 text-xs text-text-soft"
    >
      <CircleAlert className="size-3.5 shrink-0 text-status-warning" aria-hidden />
      <span className="min-w-0 truncate">
        {count} could not be read, so this list may be missing some.
      </span>
      <Button size="sm" variant="ghost" onClick={() => store.goTo('sources')}>
        See Sources
      </Button>
    </div>
  )
}
