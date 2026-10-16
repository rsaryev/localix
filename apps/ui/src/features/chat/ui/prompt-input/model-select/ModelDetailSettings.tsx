import type { ReactNode } from 'react'
import type { CatalogModel } from '@localixai/agent/catalog'
import type { ReasoningEffort } from '../../../model/reasoning'
import { MaxTurnsControl } from '../MaxTurnsControl'
import { ModelReasoningMenu } from './ModelReasoningMenu'

interface ModelDetailSettingsProps {
  model: CatalogModel
  turns?: {
    value: number | undefined
    inherited: number
    limit?: number
    onChange: (next: number | undefined) => void
  }
  /** The model this target runs on: its level writes the live route, not just a preference. */
  current: boolean
  /** Inline completion always runs at the lowest level, so it offers no choice. */
  minimumReasoning: boolean
  /** The level this model holds for the target: its live level if current, else its start. */
  reasoningFor: (model: CatalogModel, current: boolean) => ReasoningEffort
  changeModelReasoning: (model: CatalogModel, effort: ReasoningEffort, current: boolean) => void
}

/**
 * One setting: its name on the left, its control on the right, on one 32px line — the shape of
 * a settings row everywhere, so a growing list of them reads as a column of names and a column
 * of values.
 */
function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-(--chrome-control-lg) items-center justify-between gap-3">
      <span className="min-w-0 truncate text-xs text-text-soft">{label}</span>
      <span className="flex shrink-0 justify-end">{children}</span>
    </div>
  )
}

/**
 * The per-model settings shown in the details panel. Reasoning is the first; the section is
 * where every later per-model setting goes, so it is its own component rather than a branch
 * inside the browser. A model with nothing to set renders nothing, and the browser then passes
 * no settings at all so the panel omits the section.
 */
export function ModelDetailSettings({
  model,
  turns,
  current,
  minimumReasoning,
  reasoningFor,
  changeModelReasoning,
}: ModelDetailSettingsProps) {
  return (
    <div className="space-y-1">
      {model.supportsReasoning ? (
        <SettingRow label="Reasoning">
          {minimumReasoning ? (
            <span
              title="Inline completion always runs at the lowest level"
              className="text-xs text-text-faint"
            >
              Minimum
            </span>
          ) : (
            <ModelReasoningMenu
              modelLabel={model.name}
              reasoningEfforts={model.reasoningEfforts}
              value={reasoningFor(model, current)}
              onChange={(effort) => changeModelReasoning(model, effort, current)}
            />
          )}
        </SettingRow>
      ) : null}
      {turns ? (
        <SettingRow label="Turns per message">
          <MaxTurnsControl {...turns} />
        </SettingRow>
      ) : null}
    </div>
  )
}
