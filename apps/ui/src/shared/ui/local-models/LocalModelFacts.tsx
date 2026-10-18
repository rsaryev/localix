import { useState } from 'react'
import { Button } from '@localixai/kit/button'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { SectionLabel } from '@localixai/kit/section-label'
import { localModelsApi } from '@/shared/api/localModelsApi'
import { useLocalModelDetails, useLocalModelsStatus } from '@/shared/hooks/useLocalModels'
import { formatBytes } from '@/shared/lib/formatBytes'

const FIT_LABEL = { good: 'Fits well', tight: 'Tight fit', 'too-large': 'Too large' } as const

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-(--chrome-control-sm) items-center justify-between gap-3 text-xs">
      <span className="text-text-soft">{label}</span>
      <span className="truncate text-right text-foreground tabular-nums">{value}</span>
    </div>
  )
}

/**
 * The model picker details' "On this computer" group for a local model: how it runs HERE
 * (planned for this machine: memory, context, cache, speed, its draft model), and what can be
 * done with it — remove it, or add the draft model an update brings. Downloading happens in
 * Settings → Models; the picker lists what is already here.
 */
export function LocalModelFacts({ modelId, label }: { modelId: string; label: string }) {
  const { status, refresh } = useLocalModelsStatus()
  const { entry } = useLocalModelDetails(modelId)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const installed = !!status?.installed.some((s) => s.id === modelId)
  const plan = entry?.plan
  const spec = entry?.spec
  const run = (action: Promise<unknown>) => void action.finally(() => refresh())

  return (
    <section data-slot="local-model-facts" className="flex flex-col gap-0.5">
      <SectionLabel weight="semibold">On this computer</SectionLabel>
      {plan && <Fact label="Fit" value={FIT_LABEL[plan.fit]} />}
      {plan && plan.fit !== 'too-large' && (
        <>
          <Fact label="Memory" value={formatBytes(plan.memoryBytes)} />
          <Fact
            label="Context"
            value={`${Math.round(plan.context / 1024)}K tokens${plan.kv === 'q8_0' ? ' · compact cache' : ''}`}
          />
          {plan.tokensPerSecond && (
            <Fact label="Speed" value={`≈${plan.tokensPerSecond} tokens/s`} />
          )}
        </>
      )}
      {spec && <Fact label="Variant" value={`${spec.variant} · ${formatBytes(spec.bytes)}`} />}
      {spec?.releasedAt && <Fact label="Released" value={spec.releasedAt.slice(0, 10)} />}
      {spec?.draft && <Fact label="Faster replies" value="Draft model included" />}
      <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
        {installed && entry?.upgradeBytes ? (
          <Button size="xs" variant="outline" onClick={() => run(localModelsApi.install(modelId))}>
            Add draft model · {formatBytes(entry.upgradeBytes)}
          </Button>
        ) : null}
        {installed && (
          <Button size="xs" variant="ghost" onClick={() => setConfirmRemove(true)}>
            Remove from this computer
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${label}?`}
        description="Deletes its files from this computer. It can be downloaded again in Settings → Models."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => {
          setConfirmRemove(false)
          run(localModelsApi.remove(modelId))
        }}
        onClose={() => setConfirmRemove(false)}
      />
    </section>
  )
}
