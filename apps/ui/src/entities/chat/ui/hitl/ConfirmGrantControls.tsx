import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { SegmentedRadioGroup } from '@localixai/mini-app-sdk/ui/segmented-control'
import type { PendingConfirmInteraction } from '@/shared/api/contracts'

/** One breadth the host offered — read off the wire shape rather than restated here. */
export type ConfirmGrantOption = NonNullable<
  PendingConfirmInteraction['request']['payload']['grants']
>[number]

/**
 * HOW FAR an approval reaches: for how long, and — on a path card — from which folder down.
 *
 * The level used to be a labelled `Scope` row holding a select of folder names, under an
 * `Allow` row, beside the path the card already showed. That said the same path twice — once
 * as the subject, once as a list of its own folders — and spent two labelled rows doing it, so
 * the card read as a form. The level is now picked ON the path: each folder the host offers is
 * a segment of the breadcrumb trail, and the one picked is where "don't ask again" starts. The
 * duration is one quiet control under it, and Approve still enacts both.
 *
 * Only a path card has more than one level to offer (`permission-confirm-subject.ts`: a
 * command grants its one program, a resource itself), and every path level names its folder in
 * `target` — so the trail is the whole picker, and the client never parses an opaque grant id.
 */

export type GrantDuration = 'once' | 'session' | 'always'

export interface GrantChoice {
  duration: GrantDuration
  grantId: string | undefined
}

/**
 * The level a widening answer starts at: the file's own FOLDER when the card offers one.
 * The file alone is the narrowest level, but it is the wrong default for the request that
 * prompted this — an agent reading its way through a folder asks once per file.
 */
export function initialGrantChoice(grants: readonly ConfirmGrantOption[]): GrantChoice {
  const folder = grants.find((grant) => grant.kind === 'folder')
  return { duration: 'once', grantId: (folder ?? grants[0])?.id }
}

/** The choice as an answer: `always` only where the chosen level has a rule to write. */
export function effectiveDuration(
  choice: GrantChoice,
  grant: ConfirmGrantOption | undefined,
): GrantDuration {
  if (!grant) return 'once'
  return choice.duration === 'always' && !grant.rule ? 'session' : choice.duration
}

export interface ScopeCrumb {
  name: string
  /** The level this segment grants, when the host offered one here. */
  grant?: ConfirmGrantOption
}

/**
 * `trail` cut into segments, each matched to the level that names it.
 *
 * Everything above the shallowest offered level collapses into one `prefix`: the host never
 * offers the home folder or anything above it, so `/Users/me` is the address of the trail, not
 * a step of it, and splitting it would make three segments look clickable that are not.
 */
export function scopeTrail(
  trail: string,
  grants: readonly ConfirmGrantOption[],
): { prefix: string; crumbs: ScopeCrumb[] } {
  const sep = trail.includes('/') || !trail.includes('\\') ? '/' : '\\'
  const parts = trail.split(sep)
  const levels = parts.map((_, index) => {
    const target = parts.slice(0, index + 1).join(sep)
    return grants.find((grant) => grant.target === target)
  })
  const first = levels.findIndex(Boolean)
  // Nothing on the trail is grantable: it is shown whole, as an address with no steps.
  const cut = first === -1 ? parts.length - 1 : first
  return {
    prefix: parts.slice(0, cut).join(sep),
    crumbs: parts.slice(cut).map((name, offset) => {
      const grant = levels[cut + offset]
      return grant ? { name, grant } : { name }
    }),
  }
}

/** The deepest path the offered levels name — the trail a card draws them on. */
export function deepestTarget(grants: readonly ConfirmGrantOption[]): string | undefined {
  return grants
    .map((grant) => grant.target)
    .filter((target): target is string => !!target)
    .sort((a, b) => b.length - a.length)[0]
}

/**
 * The path as breadcrumbs whose folders are the levels.
 *
 * Picking a segment while the duration is still `Once` moves it to `This session`: clicking a
 * folder on an approval card means "allow this folder", and making the person find a second
 * control before the click did anything is the clumsiness this replaced.
 */
export function ScopeTrail({
  trail,
  grants,
  choice,
  onChange,
  disabled,
}: {
  trail: string
  grants: readonly ConfirmGrantOption[]
  choice: GrantChoice
  onChange: (choice: GrantChoice) => void
  disabled?: boolean
}) {
  const { prefix, crumbs } = scopeTrail(trail, grants)
  const widening = choice.duration !== 'once'
  const pick = (grantId: string) =>
    onChange({ grantId, duration: widening ? choice.duration : 'session' })
  // A lone level is not a choice; the trail is then just the subject, drawn the same way.
  const choosable = grants.filter((grant) => grant.target).length > 1
  // What the answer COVERS is the picked segment and everything below it, so the steps above
  // it fade while widening: the trail then reads as "from here down" without a sentence.
  const pickedAt = widening ? crumbs.findIndex((crumb) => crumb.grant?.id === choice.grantId) : -1

  return (
    <div
      role="group"
      aria-label="Allow without asking from this level down"
      data-slot="confirm-scope-trail"
      className="flex min-w-0 flex-wrap items-center font-mono text-xs leading-relaxed"
    >
      {prefix && (
        <span className={cn('text-text-faint wrap-anywhere', pickedAt !== -1 && 'opacity-70')}>
          {prefix}
        </span>
      )}
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1
        const name = (
          <span
            className={cn(
              'transition-colors',
              last && 'font-medium',
              pickedAt === -1
                ? last
                  ? 'text-text-strong'
                  : 'text-text-soft'
                : index < pickedAt
                  ? 'text-text-faint opacity-70'
                  : 'text-foreground',
            )}
          >
            {crumb.name}
          </span>
        )
        const picked = index === pickedAt
        return (
          <span key={index} className="flex min-w-0 items-center">
            {(prefix || index > 0) && <span className="px-0.5 text-text-faint">/</span>}
            {choosable && crumb.grant ? (
              <button
                type="button"
                disabled={disabled}
                aria-pressed={picked}
                title={`Don’t ask again for ${crumb.grant.covers}`}
                onClick={() => pick(crumb.grant!.id)}
                className={cn(
                  '-mx-0.5 rounded-sm px-0.5 wrap-anywhere transition-colors',
                  'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-control-border-focus',
                  picked &&
                    'bg-surface-active ring-1 ring-inset ring-border/60 [&>span]:text-foreground',
                )}
              >
                {name}
              </button>
            ) : (
              <span className="wrap-anywhere">{name}</span>
            )}
          </span>
        )
      })}
    </div>
  )
}

export function ConfirmGrantControls({
  grant,
  choice,
  onChange,
  disabled,
}: {
  /** The level the answer would widen to. */
  grant: ConfirmGrantOption
  choice: GrantChoice
  onChange: (choice: GrantChoice) => void
  disabled?: boolean
}) {
  const duration = effectiveDuration(choice, grant)
  const canPersist = !!grant.rule
  const durations = [
    { value: 'once' as const, label: 'Once' },
    { value: 'session' as const, label: 'This session' },
    {
      value: 'always' as const,
      label: 'Always',
      disabled: !canPersist,
      title: canPersist
        ? 'Also save it to this agent’s rules — editable and revocable in Settings'
        : 'This level can be remembered for the session only',
    },
  ]

  return (
    <div className="space-y-1.5" data-slot="confirm-grant-controls">
      <SegmentedRadioGroup
        size="sm"
        variant="ghost"
        aria-label="How long to allow it"
        value={duration}
        disabled={disabled}
        onValueChange={(next) => onChange({ ...choice, duration: next })}
        options={durations}
      />
      {/* Said only when the answer reaches past this call; `Once` needs no sentence. */}
      {duration !== 'once' && (
        <p className="text-2xs leading-snug wrap-anywhere text-text-faint">
          Won’t ask again for <span className="text-text-soft">{grant.covers}</span>
          {duration === 'session' ? (
            ' until this session ends.'
          ) : (
            <>
              {' '}
              — saved as <span className="font-mono break-all text-text-soft">{grant.rule}</span>,
              revocable in Settings.
            </>
          )}
        </p>
      )}
    </div>
  )
}
