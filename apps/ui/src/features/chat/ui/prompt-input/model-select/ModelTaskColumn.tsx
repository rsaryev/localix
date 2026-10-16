import { cn, CONTROL_FOCUS_WITHIN } from '@localixai/plugin-sdk/ui/classes'
import { MODEL_ROUTING_TASKS } from '@localixai/api/model-task-catalog'
import type { ModelRoutingTask, ModelRoutingTaskKey } from '@localixai/api/client'
import { agentTarget, type PickerTarget } from './pickerTarget'
import type { ReasoningEffort } from '../../../model/reasoning'

/**
 * A rendered row: either a participant of the conversation or a global workload.
 *
 * `section` is what the row is filed under. Every row carries one, so the heading logic is a
 * single "did it change?" check rather than arithmetic over where the party happens to end —
 * which is also why adding a group later needs no new branch here.
 */
type TaskRow = Omit<ModelRoutingTask, 'key' | 'group'> & {
  key: PickerTarget
  section: string
  origin?: ParticipantRow['modelOrigin']
}

/**
 * How a row names the level its model came from.
 *
 * `session` says nothing: a model chosen here is the ordinary case, and labelling it would put
 * a word on every row and so distinguish nothing. The others are worth a word precisely because
 * they will change under the reader when that level changes.
 */
const ORIGIN_NOTE: Partial<Record<NonNullable<ParticipantRow['modelOrigin']>, string>> = {
  project: 'from the project',
  agent: "the agent's own",
  recent: 'last used',
  primary: 'main model',
}

/**
 * The party first: it is the conversation, and the rest is what runs behind it.
 *
 * Named by SCOPE, because that is what actually differs: these rows write to this one
 * conversation, the others to global settings. There used to be a third group here for
 * delegated workers — one route per shipped agent — but an agent's model belongs to its RECORD,
 * so a dispatched run carries its own and needs no route of its own.
 */
const PARTY_SECTION = 'Agents'
const WORKLOAD_SECTION = 'Background workloads'
import { PanelHeader } from '@localixai/kit/panel-header'
import { SectionLabel } from '@localixai/kit/section-label'
import { SELECTED_ROW } from '@localixai/kit/selected-row'
import { Switch } from '@localixai/kit/switch'
import { PartyRouteRow } from './PartyRouteRow'
import { PARTY_TARGET } from './partyRoute'
import {
  pickerColumnFrame,
  PICKER_LIST,
  PICKER_SECTION_LABEL_INSET,
  type PickerColumnLayout,
} from './pickerRow'

interface ModelTaskColumnProps {
  activeTask: PickerTarget
  onSelectTask: (key: PickerTarget) => void
  /** Current model label for a target, or null when it falls back. */
  modelLabelFor: (key: PickerTarget) => string | null
  enabledFor: (key: PickerTarget) => boolean
  onEnabledChange: (key: ModelRoutingTaskKey, enabled: boolean) => void
  /**
   * WHO the open conversation is with, in join order. Each participant gets a row, in place of
   * the single "Chat sessions" row a conversation with one counterpart used to need.
   *
   * REQUIRED, though empty is a perfectly ordinary value — the onboarding step and the agent
   * editor have no conversation. Optional, it was silently forgotten at the one call site that
   * has a party, and nothing failed: the column rendered the old catalog while the breadcrumb
   * above it named a participant. A required prop makes that a compile error instead.
   */
  participants: readonly ParticipantRow[]
  /** `column` in the wide drawer; `sheet` inside the narrow layout's workload popover. */
  layout?: PickerColumnLayout
  /** The "All agents" row, when the room disagrees (`partyRoute.ts`); absent hides it. */
  party?: { status: string; mixed: boolean }
}

/** One row of the party: who, and what they run on here. */
export interface ParticipantRow {
  maxTurnsLimit?: number
  agentId: string
  handle: string
  /** Display name from the registry; falls back to the handle when the agent is unknown. */
  label?: string
  /** The agent's own model, shown as the fallback when this conversation sets none. */
  inheritedLabel?: string
  /**
   * THIS participant's resolved route. Required, because the column used to show the whole
   * party the model of whoever the picker had selected — every row read the same single pair —
   * and a room of three then displayed one model three times whatever each member was on.
   */
  route?: {
    providerConnectionId: string | null
    modelId: string
    /**
     * This participant's own reasoning level.
     *
     * Carried for the same reason the model is: without it the picker fell back to the
     * conversation's level for whoever was selected, so opening another member showed the level
     * that had just been set for the previous one — and picking a model there would have
     * written it in.
     */
    reasoningEffort?: ReasoningEffort
  }
  /** Which level answered, so the row can say "from the project" instead of implying a choice. */
  modelOrigin?: 'session' | 'project' | 'agent' | 'recent' | 'primary' | 'unset'
}

/**
 * Leftmost column of the model picker: pick which task the model is for BEFORE
 * choosing a provider + model. The session model is required; every other slot
 * reuses it until set. Each row shows its current model so the whole mapping
 * reads at a glance. Shared by the chat picker drawer and the onboarding step.
 */
export function ModelTaskColumn({
  activeTask,
  onSelectTask,
  modelLabelFor,
  enabledFor,
  onEnabledChange,
  participants,
  layout = 'column',
  party,
}: ModelTaskColumnProps) {
  // The party replaces the single session row; every other workload keeps its place. Built as
  // one list so the rendering below stays a single loop with no "is this an agent" branch.
  const rows: TaskRow[] = [
    ...participants.map((member) => ({
      key: agentTarget(member.agentId),
      label: member.label || member.handle,
      hint: `Model for @${member.handle} in this conversation`,
      // Where the model came from, said in the row itself: a model with no such word cannot be
      // told apart from one chosen here, and the two differ in what changing it will affect.
      origin: member.modelOrigin,
      fallbackLabel: member.inheritedLabel ?? `Use @${member.handle}'s model`,
      required: false,
      toggleable: false,
      section: PARTY_SECTION,
    })),
    ...MODEL_ROUTING_TASKS.filter(
      (task) => task.key !== 'session' || participants.length === 0,
    ).map((task) => ({
      ...task,
      // `session` is the party's stand-in where there is no conversation, so it files under
      // the same heading the participants would have: both answer "who does this chat run as".
      section: task.key === 'session' ? PARTY_SECTION : WORKLOAD_SECTION,
    })),
  ]
  return (
    <div className={pickerColumnFrame(layout, 'w-52 lg:w-56 xl:w-63')}>
      {layout === 'column' && <PanelHeader tone="content" title="Workload" />}
      <div className={cn(PICKER_LIST, 'scrollbar-thin min-h-0 flex-1 overflow-y-auto')}>
        {rows.map((t, index) => {
          const isActive = t.key === activeTask
          const label = modelLabelFor(t.key)
          const enabled = enabledFor(t.key)
          return (
            <div key={t.key}>
              {/* Every group is labelled, the first one included: the panel header names the
                  COLUMN, not the group at the top of it. */}
              {t.section !== rows[index - 1]?.section && (
                <SectionLabel
                  weight="semibold"
                  // Each label is the first child of its own row wrapper, so `first:` cannot tell
                  // the column's top group from the next one; the index can.
                  className={cn(PICKER_SECTION_LABEL_INSET, index === 0 ? 'pt-1.5' : 'pt-3')}
                >
                  {t.section}
                </SectionLabel>
              )}
              {/* One gesture for the whole room, first in the Agents group it acts on. */}
              {index === 0 && party && participants.length > 0 && (
                <PartyRouteRow
                  active={activeTask === PARTY_TARGET}
                  status={party.status}
                  mixed={party.mixed}
                  onSelect={() => onSelectTask(PARTY_TARGET)}
                />
              )}
              <div
                title={t.hint}
                className={cn(
                  // The row is the focus surface for the controls inside it, so it takes the
                  // shared group recipe rather than a ring of its own. It used to be
                  // `focus-within:ring-foreground/15`, which also fired on a plain mouse click.
                  // `isolate`: the row's own layers (hit button under, content over) stack inside
                  // it, so their order cannot leak against anything else in the column.
                  // The padding is the picker's row padding (`pickerRow.ts`), so the two lines
                  // start on the same 12px vertical as every other column's text. A selected row
                  // is marked by its fill alone — the rail beside it never had a second marker.
                  'relative isolate flex w-full select-none flex-col items-start gap-0.5 rounded-md px-1.5 py-1.5 text-left transition-colors duration-(--dur-fast)',
                  CONTROL_FOCUS_WITHIN,
                  isActive ? cn(SELECTED_ROW, 'shadow-none') : 'hover:bg-surface-hover',
                )}
              >
                <button
                  type="button"
                  aria-label={`Configure ${t.label}`}
                  onClick={() => onSelectTask(t.key)}
                  className="absolute inset-0 z-0 cursor-pointer rounded-md outline-none"
                />
                <span className="pointer-events-none relative z-(--z-raised) flex min-h-(--chrome-control-xs) w-full min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-xs font-medium',
                      !isActive && 'text-foreground',
                      !enabled && 'text-text-faint',
                    )}
                  >
                    {t.label}
                    {t.required && <span className="text-status-error"> *</span>}
                  </span>
                  {t.toggleable && (
                    <Switch
                      size="sm"
                      checked={enabled}
                      aria-label={`${enabled ? 'Disable' : 'Enable'} ${t.label}`}
                      onChange={(event) => {
                        event.stopPropagation()
                        onSelectTask(t.key)
                        // Reachable only from a workload row: `toggleable` is never set on a
                        // participant, because you cannot switch off someone who is in the room.
                        onEnabledChange(t.key as ModelRoutingTaskKey, event.currentTarget.checked)
                      }}
                      className="pointer-events-auto"
                    />
                  )}
                </span>
                <span
                  className={cn(
                    'pointer-events-none relative z-(--z-raised) w-full truncate text-2xs',
                    label && enabled ? 'text-text-soft' : 'text-text-faint',
                  )}
                >
                  {!enabled
                    ? label
                      ? `${label} · saved`
                      : 'No model selected'
                    : label
                      ? t.origin && ORIGIN_NOTE[t.origin]
                        ? `${label} · ${ORIGIN_NOTE[t.origin]}`
                        : label
                      : t.required
                        ? 'Not set'
                        : (t.fallbackLabel ?? 'Use session model')}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
