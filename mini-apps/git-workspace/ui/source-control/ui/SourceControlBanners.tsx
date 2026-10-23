import { Bug, CheckCircle2, GitBranchPlus } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Spinner } from '@localixai/kit/spinner'
import type { BisectState, RebaseState } from '../../../backend/source-control/contracts'

/** A band action that names its outcome's tone — Abort / Bad in red, Good in green. */
const BAND_DANGER = 'text-status-error hover:bg-status-error/10 hover:text-status-error'
const BAND_SUCCESS = 'text-status-success hover:bg-status-success/10 hover:text-status-success'

/*
 * Every action button in these status bands is the kit's `field` variant: a foreground VEIL at
 * rest, not an opaque fill, because the band under it is tinted (`bg-status-error/10`,
 * `bg-status-warning/10`) and an opaque grey reads as a black chip punched into it. A veil only
 * adds density to the band's own colour.
 */

/** The in-progress rebase band: where it is, and Continue / Skip / Abort. */
export function RebaseBanner({
  rebase,
  busy,
  onContinue,
  onSkip,
  onAbort,
}: {
  rebase: RebaseState
  busy: boolean
  onContinue: () => void
  onSkip: () => void
  onAbort: () => void
}) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-status-warning/30 bg-status-warning/10 px-3 py-2">
      <div className="flex items-center gap-1.5 text-2xs font-medium text-text-soft">
        <GitBranchPlus className="size-3.5 text-status-warning" />
        Rebase in progress
        {rebase.step && rebase.total ? (
          <span className="text-text-faint">
            · step {rebase.step} of {rebase.total}
          </span>
        ) : null}
        {rebase.onto ? (
          <span className="font-mono text-text-faint">· onto {rebase.onto}</span>
        ) : null}
      </div>
      <p className="text-2xs leading-relaxed text-text-faint">
        Resolve any conflicts in the Changes tree and stage them, then Continue — or Skip this
        patch, or Abort to back out.
      </p>
      <div className="flex items-center gap-1.5">
        <Button size="xs" variant="field" onClick={onContinue} disabled={busy}>
          {busy && <Spinner className="size-3" />} Continue
        </Button>
        <Button size="xs" variant="field" onClick={onSkip} disabled={busy}>
          Skip
        </Button>
        <Button size="xs" variant="field" onClick={onAbort} disabled={busy} className={BAND_DANGER}>
          Abort
        </Button>
      </div>
    </div>
  )
}

/** The bisect band: the commit under test and Good / Bad / Skip / Reset — or the culprit found. */
export function BisectBanner({
  bisect,
  busy,
  onGood,
  onBad,
  onSkip,
  onReset,
}: {
  bisect: BisectState
  busy: boolean
  onGood: () => void
  onBad: () => void
  onSkip: () => void
  onReset: () => void
}) {
  if (bisect.firstBadCommit) {
    return (
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-status-error/30 bg-status-error/10 px-3 py-2">
        <div className="flex items-center gap-1.5 text-2xs font-medium text-text-soft">
          <Bug className="size-3.5 text-status-error" />
          First bad commit found
          <span className="font-mono text-text-faint">· {bisect.firstBadCommit.shortHash}</span>
        </div>
        <p
          className="truncate text-2xs leading-relaxed text-text-faint"
          title={bisect.firstBadCommit.subject}
        >
          {bisect.firstBadCommit.subject}
        </p>
        <div className="flex items-center gap-1.5">
          <Button size="xs" variant="field" onClick={onReset} disabled={busy}>
            {busy && <Spinner className="size-3" />} Reset — finish bisect
          </Button>
        </div>
      </div>
    )
  }
  const nothingUnderTest = !bisect.current
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-status-warning/30 bg-status-warning/10 px-3 py-2">
      <div className="flex items-center gap-1.5 text-2xs font-medium text-text-soft">
        <Bug className="size-3.5 text-status-warning" />
        Bisecting
        {bisect.current ? (
          <span className="font-mono text-text-faint">· testing {bisect.current.shortHash}</span>
        ) : null}
        {bisect.revisionsLeft !== undefined && bisect.stepsLeft !== undefined ? (
          <span className="text-text-faint">
            · ~{bisect.stepsLeft} step{bisect.stepsLeft === 1 ? '' : 's'} left
          </span>
        ) : null}
      </div>
      {bisect.current ? (
        <p
          className="truncate text-2xs leading-relaxed text-text-faint"
          title={bisect.current.subject}
        >
          {bisect.current.subject}
        </p>
      ) : (
        <p className="text-2xs leading-relaxed text-text-faint">
          Mark an older GOOD commit in the log to begin the search.
        </p>
      )}
      <p className="text-2xs leading-relaxed text-text-faint">
        HEAD is detached at the commit under test. Test it, then mark Good (works) or Bad (broken) —
        or Skip if it can't be tested.
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          size="xs"
          variant="field"
          onClick={onGood}
          disabled={busy || nothingUnderTest}
          className={BAND_SUCCESS}
        >
          {busy ? <Spinner className="size-3" /> : <CheckCircle2 className="size-3" />} Good
        </Button>
        <Button
          size="xs"
          variant="field"
          onClick={onBad}
          disabled={busy || nothingUnderTest}
          className={BAND_DANGER}
        >
          <Bug className="size-3" /> Bad
        </Button>
        <Button size="xs" variant="field" onClick={onSkip} disabled={busy || nothingUnderTest}>
          Skip
        </Button>
        <Button size="xs" variant="field" onClick={onReset} disabled={busy} className="ml-auto">
          Reset
        </Button>
      </div>
    </div>
  )
}
