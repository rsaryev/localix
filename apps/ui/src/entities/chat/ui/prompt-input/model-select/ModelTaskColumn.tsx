import { cn, CONTROL_FOCUS_WITHIN } from '@localixai/mini-app-sdk/ui/classes'
import { MODEL_ROUTING_TASKS } from '@localixai/api/model-task-catalog'
import type { ModelRoutingTask, ModelRoutingTaskKey } from '@localixai/api/client'
import { agentTarget, type PickerTarget } from './pickerTarget'
import type { ReasoningEffort } from '../../../model/reasoning'
import { PanelHeader } from '@localixai/kit/panel-header'
import { SectionLabel } from '@localixai/kit/section-label'
import { SELECTED_ROW } from '@localixai/kit/selected-row'
import { Switch } from '@localixai/kit/switch'
import {
  pickerColumnFrame,
  PICKER_LIST,
  PICKER_SECTION_LABEL_INSET,
  type PickerColumnLayout,
} from './pickerRow'

/**
 * A rendered row: either the conversation's agent or a global workload.
 *
 * `section` is what the row is filed under. Every row carries one, so the heading logic is a
 * single "did it change?" check.
 */
type TaskRow = Omit<ModelRoutingTask, 'key' | 'group'> & {
  key: PickerTarget
  section: string
  origin?: ConversationAgentRow['modelOrigin']
}

/**
 * How a row names the level its model came from.
 *
 * `session` says nothing: a model chosen here is the ordinary case, and labelling it would put
 * a word on every row and so distinguish nothing. The others are worth a word precisely because
 * they will change under the reader when that level changes.
 */
const ORIGIN_NOTE: Partial<Record<NonNullable<ConversationAgentRow['modelOrigin']>, string>> = {
  project: 'from the project',
  agent: "the agent's own",
  recent: 'last used',
  primary: 'main model',
}

/**
 * The conversation's agent first, and the rest is what runs behind it.
 *
 * Named by SCOPE, because that is what actually differs: this row writes to this one
 * conversation, the others to global settings.
 */
const AGENT_SECTION = 'This chat'
const WORKLOAD_SECTION = 'Background workloads'
interface ModelTaskColumnProps {
  activeTask: PickerTarget
  onSelectTask: (key: PickerTarget) => void
  /** Current model label for a target, or null when it falls back. */
  modelLabelFor: (key: PickerTarget) => string | null
  enabledFor: (key: PickerTarget) => boolean
  onEnabledChange: (key: ModelRoutingTaskKey, enabled: boolean) => void
  /**
   * The open conversation's agent, which gets a row in place of the single "Chat sessions" row.
   *
   * Absent where there is no conversation (the onboarding step, the agent editor): the column
   * then shows the workload catalog alone.
   */
  agent?: ConversationAgentRow
  /** `column` in the wide drawer; `sheet` inside the narrow layout's workload popover. */
  layout?: PickerColumnLayout
}

/** The conversation's agent, and what it runs on here. */
export interface ConversationAgentRow {
  maxTurnsLimit?: number
  agentId: string
  /** The agent's Claude Code name. */
  name: string
  /** The agent's own model, shown as the fallback when this conversation sets none. */
  inheritedLabel?: string
  /** The agent's resolved route, already settled through the model chain by the server. */
  route?: {
    providerConnectionId: string | null
    modelId: string
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
  agent,
  layout = 'column',
}: ModelTaskColumnProps) {
  // The agent replaces the single session row; every other workload keeps its place. Built as
  // one list so the rendering below stays a single loop with no "is this an agent" branch.
  const rows: TaskRow[] = [
    ...(agent
      ? [
          {
            key: agentTarget(agent.agentId),
            label: agent.name,
            hint: `Model for ${agent.name} in this conversation`,
            // Where the model came from, said in the row itself: a model with no such word
            // cannot be told apart from one chosen here.
            origin: agent.modelOrigin,
            fallbackLabel: agent.inheritedLabel ?? `Use ${agent.name}'s model`,
            required: false,
            toggleable: false,
            section: AGENT_SECTION,
          },
        ]
      : []),
    ...MODEL_ROUTING_TASKS.filter((task) => task.key !== 'session' || !agent).map((task) => ({
      ...task,
      // `session` is the agent's stand-in where there is no conversation, so it files under
      // the same heading the agent would have.
      section: task.key === 'session' ? AGENT_SECTION : WORKLOAD_SECTION,
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
                        // Reachable only from a workload row: `toggleable` is never set on the agent.
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
