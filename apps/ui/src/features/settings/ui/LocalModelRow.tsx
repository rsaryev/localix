import { Button } from '@localixai/kit/button'
import { Chip } from '@localixai/kit/chip'
import { localModelsApi, type LocalModelEntry } from '@/shared/api/localModelsApi'
import { formatBytes } from '@/shared/lib/formatBytes'
import type { LocalModelState } from '@/shared/lib/localModelsFormat'
import { LocalModelStatus } from '@/shared/ui/local-models/LocalModelStatus'
import { SettingsRow } from './SettingsScaffold'

/** The llama.cpp project's own conversions need no byline; anyone else's says who made it. */
const OWN_PUBLISHER = 'ggml-org'

/** One line of what matters before downloading: who built it, its size, how it runs here. */
function facts(entry: LocalModelEntry): string {
  const { spec, plan } = entry
  const publisher = spec.repo.split('/')[0]
  const fit = !plan
    ? null
    : plan.fit === 'too-large'
      ? `needs ${formatBytes(plan.shortBytes)} more memory`
      : [
          plan.fit === 'tight' ? 'tight fit' : null,
          plan.tokensPerSecond ? `≈${plan.tokensPerSecond} tok/s` : null,
        ]
          .filter(Boolean)
          .join(' · ')
  // Gemma's quantization-aware builds keep near-original quality at 4 bits: worth saying.
  const variant = `${/-qat(-|$)/i.test(spec.repo) ? 'QAT ' : ''}${spec.variant.toUpperCase()}`
  return [
    publisher !== OWN_PUBLISHER ? publisher : null,
    spec.bytes > 0 ? `${variant} · ${formatBytes(spec.bytes)}` : variant,
    fit || null,
    plan && plan.fit !== 'too-large' ? `${Math.round(plan.context / 1024)}K context` : null,
    spec.releasedAt ? spec.releasedAt.slice(0, 7) : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * One local model in Settings: its name, the facts that decide whether to get it, and the one
 * set of actions its state allows — Download here (the click is the decision), progress with
 * pause and cancel, resume, retry, or remove (confirmed).
 */
export function LocalModelRow({
  entry,
  state,
  onChanged,
  badge,
}: {
  entry: LocalModelEntry
  state: LocalModelState
  onChanged: () => void
  /** A word on why it is listed (`Best match`), beside its name. */
  badge?: string
}) {
  const id = entry.spec.id
  const run = (action: Promise<unknown>) => void action.finally(onChanged)
  return (
    <SettingsRow layout="responsive">
      <div className="min-w-0 space-y-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm text-foreground">{entry.spec.label}</p>
          {badge && <Chip tone="info">{badge}</Chip>}
          {entry.spec.vision && <Chip tone="accent">Images</Chip>}
        </div>
        <p className="truncate text-xs leading-5 text-text-soft">{facts(entry)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs text-text-soft">
        {state.kind === 'available' ? (
          <Button size="sm" variant="outline" onClick={() => run(localModelsApi.install(id))}>
            Download{entry.spec.bytes > 0 ? ` ${formatBytes(entry.spec.bytes)}` : ''}
          </Button>
        ) : (
          <LocalModelStatus
            label={entry.spec.label}
            state={state}
            actions={{
              onPause: () => run(localModelsApi.pause(id)),
              onResume: () => run(localModelsApi.install(id)),
              onCancel: () => run(localModelsApi.cancel(id)),
              onRemove: () => run(localModelsApi.remove(id)),
            }}
          />
        )}
      </div>
    </SettingsRow>
  )
}
