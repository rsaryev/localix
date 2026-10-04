import type { ReactNode } from 'react'
import type { CatalogModel } from '@localixai/agent/catalog'
import type { ReasoningEffort } from '../../../model/reasoning'
import { ModelReasoningMenu } from './ModelReasoningMenu'

interface ModelDetailSettingsProps {
  model: CatalogModel
  /** The model this target runs on: its level writes the live route, not just a preference. */
  current: boolean
  /** Inline completion always runs at the lowest level, so it offers no choice. */
  minimumReasoning: boolean
  resolveRowReasoning: (
    providerId: string,
    modelId: string,
    selected: boolean,
  ) => ReasoningEffort | undefined
  inheritedRowReasoning: (
    providerId: string,
    modelId: string,
    selected: boolean,
  ) => ReasoningEffort | undefined
  changeModelReasoning: (
    providerId: string,
    modelId: string,
    effort: ReasoningEffort | undefined,
    selected: boolean,
  ) => void
}

/**
 * One setting: its name on the left, its control on the right, on one 32px line — the shape of
 * a settings row everywhere, so a growing list of them reads as a column of names and a column
 * of values.
 */
function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-(--chrome-control-lg) items-center justify-between gap-3">
      <span className="shrink-0 text-xs text-text-soft">{label}</span>
      <span className="flex min-w-0 justify-end">{children}</span>
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
  current,
  minimumReasoning,
  resolveRowReasoning,
  inheritedRowReasoning,
  changeModelReasoning,
}: ModelDetailSettingsProps) {
  if (!model.supportsReasoning) return null
  return (
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
          value={resolveRowReasoning(model.providerId, model.id, current)}
          inheritedEffort={inheritedRowReasoning(model.providerId, model.id, current)}
          onChange={(effort) => changeModelReasoning(model.providerId, model.id, effort, current)}
        />
      )}
    </SettingRow>
  )
}
