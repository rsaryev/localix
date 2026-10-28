import { CircleAlert, PackageX } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { StateNotice } from '@localixai/kit/state-notice'
import { TextAction } from '@localixai/kit/text-action'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { ApiError } from '@/shared/api/internal'

/**
 * A read that failed, said as a failure: what could not be read, why in the server's words, and
 * Try again. Never the empty state — "nothing matches" would be a claim the Store cannot make
 * about a list it could not read. `inline` is one quiet line for a part of a page that has the
 * rest of it to show.
 */
export function StoreReadFailure({
  what,
  error,
  onRetry,
  inline = false,
}: {
  what: string
  error: unknown
  onRetry: () => void
  inline?: boolean
}) {
  const why = errorMessage(error, '')
  if (inline)
    return (
      <p role="alert" className="flex flex-wrap items-center gap-x-2 text-xs text-text-soft">
        <CircleAlert className="size-3.5 shrink-0 text-status-warning" aria-hidden />
        <span>{what} could not be read.</span>
        <TextAction className="font-medium text-foreground hover:underline" onClick={onRetry}>
          Try again
        </TextAction>
      </p>
    )
  return (
    <StateNotice
      role="alert"
      icon={CircleAlert}
      title={`${what} could not be read`}
      body={why || undefined}
      actions={
        <Button size="sm" variant="field" onClick={onRetry}>
          Try again
        </Button>
      }
      actionsLabel="Recover"
      className="flex-none py-10"
    />
  )
}

/** The owner answered that the item does not exist: a read that found nothing, not a failure. */
export const isGone = (error: unknown) => error instanceof ApiError && error.status === 404

/** An item removed while its page was open — here, in Settings or by an agent. */
export function StoreGone({ name }: { name: string }) {
  return (
    <div role="status" aria-label="Not in the Store">
      <StateNotice
        icon={PackageX}
        title={`${name} is no longer installed or offered by any source`}
        className="flex-none py-10"
      />
    </div>
  )
}
