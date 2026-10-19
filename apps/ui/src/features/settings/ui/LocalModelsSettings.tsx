import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { SearchInput } from '@localixai/kit/search-input'
import { Slider } from '@localixai/kit/slider'
import type { LocalModelEntry } from '@/shared/api/localModelsApi'
import {
  useLocalModelCatalog,
  useLocalModelsStatus,
  useRecommendedLocalModels,
} from '@/shared/hooks/useLocalModels'
import { formatBytes } from '@/shared/lib/formatBytes'
import { localModelState } from '@/shared/lib/localModelsFormat'
import { ExternalAnchor } from '@/shared/ui/external-anchor'
import { BALANCE_STOPS, rankRecommended } from '../model/recommendRanking'
import { useBalance } from '../model/useBalance'
import { LocalModelRow } from './LocalModelRow'
import { SettingsRows, SettingsSection } from './SettingsScaffold'

/** `owner/model`: a Hugging Face model id, pasted to add a model the list does not show. */
const MODEL_ID = /^[\w.-]+\/[\w.-]+$/
const PAGE = 30
const HUGGING_FACE = 'https://huggingface.co/models?library=gguf'

/** A row for a model known only by its id (a download started from an earlier list). */
function entryFor(id: string, label: string, bytes: number): LocalModelEntry {
  const repo = id.slice(0, id.lastIndexOf(':'))
  return {
    spec: {
      id,
      repo,
      revision: '',
      variant: id.slice(id.lastIndexOf(':') + 1),
      kind: 'chat',
      label,
      license: null,
      architecture: null,
      contextLength: null,
      vision: false,
      files: [],
      bytes,
    },
    installed: false,
    featured: false,
    plan: null,
    downloads: null,
    variants: [],
    exact: false,
  }
}

/**
 * Settings → Models → Local: where models that run on this computer are found and managed. Get
 * models lists the recommended first — Gemma 4 ranked for the person's speed-or-quality balance
 * (the slider), and EmbeddingGemma 2 — then the labs' most downloaded models, judged for this
 * computer (does it fit, about how fast); any other is added by its Hugging Face id. Downloads,
 * pauses and removals happen here; the model picker's `Local` provider lists what is installed.
 */
export function LocalModelsSettings() {
  const { status, jobOf, refresh } = useLocalModelsStatus()
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [balance, setBalance] = useBalance()
  const asked = MODEL_ID.test(query.trim()) ? query.trim() : ''
  const recommended = useRecommendedLocalModels()
  const curated = useLocalModelCatalog('')
  const added = useLocalModelCatalog(asked, undefined, !!asked)
  const refreshAll = () =>
    void Promise.all([refresh(), recommended.refresh(), curated.refresh(), added.refresh()])

  const stateOf = (entry: LocalModelEntry) =>
    localModelState({
      installed: !!status?.installed.some((s) => s.id === entry.spec.id),
      running: !!status?.running.some((r) => r.modelId === entry.spec.id),
      job: jobOf(entry.spec.id),
      paused: status?.paused.find((p) => p.modelId === entry.spec.id),
    })
  const row = (entry: LocalModelEntry, badge?: string) => (
    <LocalModelRow
      key={entry.spec.id}
      entry={entry}
      state={stateOf(entry)}
      onChanged={refreshAll}
      badge={badge}
    />
  )

  // On this computer: installed models, then downloads in flight or paused.
  const listed = new Map(
    [...recommended.entries, ...curated.entries, ...added.entries].map((e) => [e.spec.id, e]),
  )
  const here = new Map<string, LocalModelEntry>()
  for (const spec of status?.installed ?? []) {
    here.set(spec.id, { ...entryFor(spec.id, spec.label, spec.bytes), spec, installed: true })
  }
  for (const job of status?.jobs ?? []) {
    here.set(job.modelId, listed.get(job.modelId) ?? entryFor(job.modelId, job.label, job.total))
  }
  for (const paused of status?.paused ?? []) {
    if (!here.has(paused.modelId)) {
      here.set(
        paused.modelId,
        listed.get(paused.modelId) ?? entryFor(paused.modelId, paused.label, paused.total),
      )
    }
  }

  const filter = query.trim().toLowerCase()
  const matches = (e: LocalModelEntry) =>
    !filter || `${e.spec.label} ${e.spec.repo}`.toLowerCase().includes(filter)
  // First the recommended: Gemma 4 ranked for the chosen balance, and semantic search's model.
  const picks = asked
    ? []
    : [
        ...rankRecommended(
          recommended.entries.filter((e) => !here.has(e.spec.id)),
          BALANCE_STOPS[balance]!.value,
        ),
        ...recommended.entries.filter((e) => !e.scores && !here.has(e.spec.id)),
      ].filter(matches)
  const picked = new Set(picks.map((e) => e.spec.id))
  const offered = (asked ? added.entries : curated.entries).filter(
    (e) => !here.has(e.spec.id) && !picked.has(e.spec.id) && (asked || matches(e)),
  )
  const badgeOf = (entry: LocalModelEntry) =>
    entry.spec.required
      ? 'Built in'
      : entry.spec.id === picks[0]?.spec.id
        ? 'Best match'
        : 'Recommended'
  const machine = status?.machine
  const machineLine = machine
    ? `${machine.chip ?? 'This computer'} · ${formatBytes(machine.modelBytes)} for models. `
    : ''

  if (status && !status.runtime.supported) {
    return (
      <p className="text-sm leading-6 text-text-soft">
        Local models are not available on this computer.
      </p>
    )
  }

  return (
    <div className="space-y-8">
      <SettingsSection
        anchor="local-models-installed"
        title="On this computer"
        scope="device"
        description={
          here.size > 0
            ? `${machineLine}${formatBytes(status?.diskBytes ?? 0)} on disk. Installed models appear in the model picker under Local; nothing sent to them leaves this computer.`
            : `${machineLine}Nothing yet. Download a model below; it then appears in the model picker under Local.`
        }
      >
        {here.size > 0 && (
          <SettingsRows>{[...here.values()].map((entry) => row(entry))}</SettingsRows>
        )}
      </SettingsSection>

      <SettingsSection
        anchor="local-models-catalog"
        title="Get models"
        description={
          <>
            Gemma 4 first, the model Localix is tuned on, sized for this computer; then the labs'
            most used models. Paste a Hugging Face id for any other.{' '}
            <ExternalAnchor
              href={HUGGING_FACE}
              className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
            >
              Browse Hugging Face
              <ExternalLink className="size-3" aria-hidden="true" />
            </ExternalAnchor>
          </>
        }
      >
        <Slider
          aria-label="Speed or quality of the recommended model"
          steps={BALANCE_STOPS.map((stop) => stop.label)}
          value={balance}
          onValueChange={setBalance}
        />
        <SearchInput
          value={query}
          onValueChange={(value) => {
            setQuery(value)
            setShown(PAGE)
          }}
          placeholder="Filter, or paste an id like Qwen/Qwen3.8-Flash-Next"
          aria-label="Filter models or add one by its Hugging Face id"
        />
        <SettingsRows>
          {picks.map((entry) => row(entry, badgeOf(entry)))}
          {offered.slice(0, shown).map((entry) => row(entry))}
        </SettingsRows>
        {offered.length > shown && (
          <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)}>
            Show more
          </Button>
        )}
        {!(asked ? added.isLoading : curated.isLoading) && offered.length + picks.length === 0 && (
          <p className="text-xs leading-5 text-text-faint">
            {asked
              ? `No GGUF build of ${asked} was found.`
              : filter
                ? `Nothing listed matches “${query.trim()}”. Paste a Hugging Face id to add a model.`
                : 'Every listed model is already here.'}
          </p>
        )}
      </SettingsSection>
    </div>
  )
}
