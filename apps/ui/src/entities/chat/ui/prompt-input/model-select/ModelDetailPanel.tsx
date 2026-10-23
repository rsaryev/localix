import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import type { CatalogModel } from '@localixai/agent/catalog'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Chip } from '@localixai/kit/chip'
import { SectionLabel } from '@localixai/kit/section-label'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { formatTokenPrice, hasKnownTokenPricing } from './modelPricing'
import { ExternalAnchor } from '@/shared/ui/external-anchor'
import { LocalModelFacts } from '@/shared/ui/local-models/LocalModelFacts'
import { LOCAL_PROVIDER_ID } from './LocalConnectPanel'

/**
 * The details column of the model picker, organised by what a reader comes for.
 *
 * WHY THREE GROUPS. It had six — settings, capabilities, modalities, pricing, a threshold block,
 * details — each under its own ruled, upper-cased heading, so a 260px column was mostly headings
 * and rules around one or two facts apiece. Capabilities spent four lines on four dots, one of
 * them (streaming) true of every model and so saying nothing. Now:
 *
 *   Settings   what you can change (the browser passes it; the reasoning level today)
 *   Overview   what the model is: limits, input → output, and the features it HAS, as tags
 *   Pricing    what it costs, the long-context rate named in words
 *
 * and the identifiers last and quiet, stacked so a long id wraps under its label instead of
 * running into it. Groups are separated by space, not rules: the only seams left are the bands
 * the drawer's other columns share.
 */

const MODALITY_LABEL: Record<string, string> = {
  text: 'Text',
  image: 'Image',
  pdf: 'PDF',
  audio: 'Audio',
  video: 'Video',
}

const modalities = (list: readonly string[]) =>
  list.length > 0 ? list.map((m) => MODALITY_LABEL[m] ?? m).join(', ') : '—'

const thousands = (tokens: number) => `${Math.round(tokens / 1000)}k`

/** A name on the left, its value on the right — the panel's one row shape. */
function Row({ label, children, tone }: { label: string; children: ReactNode; tone?: 'success' }) {
  return (
    <div className="flex min-h-5 items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-text-soft">{label}</span>
      <span
        className={cn(
          'min-w-0 truncate text-right tabular-nums',
          tone === 'success' ? 'text-status-success' : 'text-foreground',
        )}
      >
        {children}
      </span>
    </div>
  )
}

/** A titled group. Space above it separates it from the last; no rule. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <SectionLabel weight="semibold">{title}</SectionLabel>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  )
}

/** What the model HAS. An absent feature is simply not listed; there is nothing to read in it. */
function featureTags(model: CatalogModel): string[] {
  const cost = model.cost
  return [
    model.supportsReasoning && 'Reasoning',
    model.supportsTools && 'Tools',
    model.inputModalities?.includes('image') && 'Vision',
    // Priced caching, not merely a field that exists: a zero rate is no caching.
    ((cost?.cacheRead ?? 0) > 0 || (cost?.cacheWrite ?? 0) > 0) && 'Caching',
  ].filter((tag): tag is string => Boolean(tag))
}

interface ModelDetailPanelProps {
  model: CatalogModel
  providerDoc?: string
  /**
   * The per-model settings (the reasoning level today), drawn as the panel's first group:
   * they are what a visit here most often comes to change, and they grow with the model.
   */
  settings?: ReactNode
}

export function ModelDetailPanel({ model, providerDoc, settings }: ModelDetailPanelProps) {
  const cost = model.cost
  const knownPricing = hasKnownTokenPricing(cost)
  const tags = featureTags(model)

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* ── Name band ── one 36px row, the measure of the search bands in the provider and model
          columns, so the drawer's second divider runs straight across all three. */}
      <WorkbenchToolbar as="header" aria-label="Model" className="shrink-0 gap-2">
        <span
          title={model.name}
          className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground"
        >
          {model.name}
        </span>
        {providerDoc && (
          <ExternalAnchor
            href={providerDoc}
            title="Provider docs"
            className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-text-soft outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
          >
            <ExternalLink className="size-3.5" />
          </ExternalAnchor>
        )}
      </WorkbenchToolbar>

      <div className="flex flex-col gap-5 px-(--workbench-gutter) py-3">
        {settings != null && (
          <section data-slot="model-settings" className="flex flex-col gap-0.5">
            <SectionLabel weight="semibold">Settings</SectionLabel>
            {/* Rows carry their own 32px measure, so they stack without a gap. */}
            <div className="flex flex-col">{settings}</div>
          </section>
        )}

        {model.providerId === LOCAL_PROVIDER_ID && (
          <LocalModelFacts
            modelId={model.id.slice(`${LOCAL_PROVIDER_ID}/`.length)}
            label={model.name}
          />
        )}

        <Group title="Overview">
          {model.contextLength ? (
            <Row label="Context">{thousands(model.contextLength)} tokens</Row>
          ) : null}
          {model.outputLimit ? (
            <Row label="Max output">{thousands(model.outputLimit)} tokens</Row>
          ) : null}
          <Row label="Input">{modalities(model.inputModalities ?? [])}</Row>
          <Row label="Output">{modalities(model.outputModalities ?? [])}</Row>
          {tags.length > 0 && (
            <div data-slot="model-features" className="flex flex-wrap gap-1 pt-1.5">
              {tags.map((tag) => (
                <Chip key={tag} tone="active">
                  {tag}
                </Chip>
              ))}
            </div>
          )}
        </Group>

        {knownPricing ? (
          <Group title="Pricing · per 1M tokens">
            <Row label="Input">{formatTokenPrice(cost.input)}</Row>
            <Row label="Output">{formatTokenPrice(cost.output)}</Row>
            {cost.cacheRead !== undefined && (
              // The rate that makes a long agent run affordable, so it is the one tinted.
              <Row label="Cache read" tone="success">
                {formatTokenPrice(cost.cacheRead)}
              </Row>
            )}
            {cost.cacheWrite !== undefined && (
              <Row label="Cache write">{formatTokenPrice(cost.cacheWrite)}</Row>
            )}
            {/* Long-request pricing: a model can charge more past a context threshold, and a
                panel that shows only the base rate understates it exactly where an agent run
                lands — deep in a long context. */}
            {cost.tiers?.map((tier) => (
              <Row key={tier.inputTokensAbove} label={`Above ${thousands(tier.inputTokensAbove)}`}>
                {formatTokenPrice(tier.input)} in · {formatTokenPrice(tier.output)} out
              </Row>
            ))}
          </Group>
        ) : cost || model.pricingLabel ? (
          // Non-token pricing (video per second, a router's pass-through).
          <Group title="Pricing">
            <span className="text-xs text-foreground">
              {model.pricingLabel ?? 'Variable — depends on the routed model'}
            </span>
          </Group>
        ) : null}

        {/* Identifiers: for copying, not for reading, so last and quiet. Label above value,
            so a long id wraps in its own line instead of colliding with its label. */}
        <dl className="flex flex-col gap-2 text-2xs">
          {[
            ['Model ID', model.id],
            ['Family', model.family],
            ['Protocol', model.api],
            ['Released', model.releaseDate],
          ].map(([label, value]) =>
            value ? (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-text-faint">{label}</dt>
                <dd className="select-all break-all font-mono text-text-soft">{value}</dd>
              </div>
            ) : null,
          )}
        </dl>
      </div>
    </div>
  )
}
