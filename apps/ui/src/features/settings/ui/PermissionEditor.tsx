import { useRef } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { cn } from '@localixai/plugin-sdk/ui/classes'
import type { CapabilityRule } from '@/shared/api/contracts'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import { Select } from '@localixai/kit/select'

import {
  DragHandle,
  moveItem,
  REORDER_ROW_CLASS,
  useListReorder,
} from '@localixai/kit/list-reorder'

import { ACTION_COLORS, effectOptions } from './permissionActionColors'
import type { RuleGrammar } from '@/shared/api/contracts'
import {
  markUnshipped,
  reconcilePermissionRuleKeys,
  resourceSuggestions,
  type PermissionRuleKeyEntry,
} from './permissionRuleRows'

export { PermissionLegend } from './PermissionLegend'

interface PermissionEditorProps {
  rules: CapabilityRule[]
  /**
   * Every action this scope could name, already prefixed — `tool:bash`, `skill:deploy`,
   * `mcp:github/create_pr`, `plugin:office`, `agent:builtin:qa`.
   *
   * One list rather than a parameter per kind: the editor is the general form of every
   * switch on the four registry tabs, so a kind it cannot suggest is a kind whose rules can
   * only be written from memory. The caller assembles it from the scope's own snapshot.
   */
  actionNames?: readonly string[]
  /** Agent ids in this scope — the RESOURCE an `invocation:<host>` rule is about. */
  agentIds?: readonly string[]
  /** Invocation hosts the installation knows (`chat`, `delegation`, `automation`, …). */
  invocationHosts?: readonly string[]
  /**
   * The rule grammar, straight from the snapshot — the classes are what this column offers.
   *
   * The "applies to" column could only suggest values the list already contained, so every
   * class the engine knows — `dangerous`, `outside-workspace`, `untrusted` — was invisible
   * until somebody typed it from memory. This editor names none of them: it renders what the
   * server sends, so a class added there appears here with no client change.
   */
  grammar?: RuleGrammar
  /** The agent this scope is about, when it is an agent scope. */
  scopeAgentId?: string
  /** Rules as shipped, when the scope has a default — rows that differ are marked. */
  shipped?: readonly CapabilityRule[] | null
  onChange: (rules: CapabilityRule[]) => void
}

const INVOCATION_PREFIX = 'invocation:'

/** Stable empty defaults — a literal in the parameter list is a new array every render. */
const NO_NAMES: readonly string[] = []
const EMPTY_GRAMMAR: RuleGrammar = { kinds: [], effects: [], classes: [], examples: [] }

/**
 * What each column is, said once above the rows instead of guessed from the values.
 *
 * `resource` is the column that needed it: for `tool:bash` it is a command pattern, for
 * `invocation:<host>` it is an agent id — the same box means different things depending on
 * the row above it, and nothing on screen said so.
 */
const COLUMN_LABELS = ['Permission', 'Applies to', 'Effect'] as const

export function PermissionEditor({
  rules,
  actionNames = NO_NAMES,
  agentIds = NO_NAMES,
  invocationHosts = NO_NAMES,
  grammar = EMPTY_GRAMMAR,
  scopeAgentId,
  shipped = null,
  onChange,
}: PermissionEditorProps) {
  const keyedRulesRef = useRef<PermissionRuleKeyEntry[]>([])
  const nextRuleKey = useRef(1)
  const reconciled = reconcilePermissionRuleKeys(keyedRulesRef.current, rules, nextRuleKey.current)
  keyedRulesRef.current = reconciled.entries
  nextRuleKey.current = reconciled.nextKey

  /**
   * Suggestions, never a closed list.
   *
   * This used to be a `<Select>`, which could only offer the tools plus whatever actions the
   * rules already contained — so an `invocation:` rule was editable but not creatable, and a
   * glob nobody had typed before was unreachable. A datalist keeps every known value one
   * keystroke away and still accepts anything the schema does.
   */
  const actionSuggestions = [
    ...new Set([
      'tool:*',
      'skill:*',
      'mcp:*',
      'plugin:*',
      ...actionNames,
      ...invocationHosts.map((host) => `${INVOCATION_PREFIX}${host}`),
      ...rules.map((rule) => rule.action),
    ]),
  ]
  const { usedPatterns, classListsByKind, resourceListFor } = resourceSuggestions(
    rules,
    grammar.classes,
  )
  const changedRows = markUnshipped(rules, shipped)
  const effects = effectOptions(grammar.effects)

  const addRule = () =>
    onChange([...rules, { action: 'tool:*', resource: '*', effect: 'ask' as const }])
  const updateRule = (i: number, patch: Partial<CapabilityRule>) =>
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const removeRule = (i: number) => onChange(rules.filter((_, idx) => idx !== i))
  /**
   * Reordering, by the row's grip or by Alt+arrow on it.
   *
   * Order is the semantics — the LAST match wins, so `tool:* deny` followed by `tool:read
   * allow` means "nothing except read", and the same two rules the other way round mean
   * nothing at all. Before this the only way to change precedence was to delete a rule and
   * re-add it at the end: a policy edit performed by retyping.
   *
   * Keyed on the row KEY, not the rule's action, because two rules may legitimately name the
   * same action — `tool:bash` over `*` and over `git push*` are the general rule and its
   * exception, and the exception's whole meaning is that it comes second.
   */
  const rowIds = reconciled.entries.map((entry) => String(entry.key))
  const reorder = useListReorder({
    ids: rowIds,
    labelOf: (id) => `Rule ${rowIds.indexOf(id) + 1}`,
    onMove: (id, index) => onChange(moveItem(rules, rowIds.indexOf(id), index)),
  })

  return (
    // No border of its own: `SettingsSurface` already draws one around this, and the two
    // stacked read as a double rule with a gap of padding trapped between them.
    <div>
      {/* One datalist per vocabulary, not per row: the browser shares them by id, and a row
          points at the one its action calls for.

          OUTSIDE the divided list, and that matters: a `datalist` is display:none but still a
          sibling, so `divide-y` counted three of them and drew a separator above the first
          visible row — a line with nothing above it. */}
      <datalist id="permission-actions">
        {actionSuggestions.map((action) => (
          <option key={action} value={action} aria-label={action} />
        ))}
      </datalist>
      <datalist id="permission-agents">
        {agentIds.map((id) => (
          <option key={id} value={id} aria-label={id} />
        ))}
      </datalist>
      {classListsByKind.map(({ id, entries }) => (
        <datalist key={id} id={id}>
          {entries.map((entry) => (
            <option
              key={entry.value}
              value={entry.value}
              aria-label={`${entry.value} — ${entry.hint}`}
            />
          ))}
          {usedPatterns.map((pattern) => (
            <option key={pattern} value={pattern} aria-label={pattern} />
          ))}
        </datalist>
      ))}
      <datalist id="permission-resources-any">
        {usedPatterns.map((pattern) => (
          <option key={pattern} value={pattern} aria-label={pattern} />
        ))}
      </datalist>

      {/* The divided list starts HERE — its first child is the first thing anyone can see. */}
      <div className="divide-y divide-border-faint">
        {rules.length > 0 && (
          <div
            aria-hidden="true"
            className="hidden gap-2 pb-1.5 text-2xs font-semibold uppercase tracking-wider text-text-faint @md:flex"
          >
            {/* The grip's own column, so the labels sit over the fields and not one gutter left. */}
            <span className="size-6 shrink-0" />
            <span className="min-w-44 flex-1">{COLUMN_LABELS[0]}</span>
            <span className="min-w-36 flex-1">{COLUMN_LABELS[1]}</span>
            <span className="w-[4.75rem] shrink-0">{COLUMN_LABELS[2]}</span>
            {/* And the remove button's. */}
            <span className="w-[var(--chrome-control-md)] shrink-0" />
          </div>
        )}
        {rules.length === 0 && (
          <p className="py-3 text-sm text-text-soft">
            No rules — defaults apply (agent asks for sensitive operations).
          </p>
        )}
        {reconciled.entries.map(({ rule, key }, i) => {
          const invocation = rule.action.startsWith(INVOCATION_PREFIX)
          /**
           * An invocation rule's resource is the agent it is about — and inside that agent's OWN
           * scope it only restates the heading, on every row. Dimmed rather than hidden: the
           * value is still what is stored, and still editable, because a rule written here about
           * a DIFFERENT agent is dead weight the screen should not conceal.
           */
          const impliedByScope =
            invocation && Boolean(scopeAgentId) && rule.resource === scopeAgentId
          return (
            <div
              key={key}
              role="group"
              aria-label={
                changedRows[i]
                  ? `Permission rule ${i + 1}, not one of the shipped defaults`
                  : `Permission rule ${i + 1}`
              }
              data-changed={changedRows[i] || undefined}
              className={cn(
                REORDER_ROW_CLASS,
                'flex flex-wrap items-center gap-2 py-1.5 @md:flex-nowrap',
                // A quiet edge, not a badge: the marker answers "is this rule mine" while
                // scanning, and a row of badges would compete with the effect column.
                changedRows[i] && '-ml-2 border-l-2 border-status-warning/50 pl-1.5',
              )}
              {...reorder.rowProps(String(key)).row}
            >
              {/* The grip leads the row: order IS the policy here, so picking a rule up is a
                first-class verb rather than something tucked in behind the remove button. */}
              <DragHandle
                handleProps={reorder.rowProps(String(key)).handle}
                label={`rule ${i + 1}, ${rule.action}`}
              />
              <Input
                size="md"
                list="permission-actions"
                className="min-w-44 flex-1 font-mono"
                aria-label={`Rule ${i + 1} permission scope`}
                value={rule.action}
                placeholder="tool:bash"
                onChange={(e) => updateRule(i, { action: e.target.value })}
              />
              <Input
                size="md"
                list={resourceListFor(rule.action)}
                // `text-soft`, not `text-faint`: a value dimmed to the placeholder's own tone
                // reads as an empty field, and this one is neither empty nor optional.
                className={cn('min-w-36 flex-1 font-mono', impliedByScope && 'text-text-soft')}
                aria-label={`Rule ${i + 1} pattern`}
                value={rule.resource}
                // The placeholder is the column's meaning for THIS row: an invocation rule's
                // resource is the agent it is about, everything else matches on arguments.
                placeholder={invocation ? 'agent id' : '*'}
                {...(impliedByScope
                  ? { title: 'This scope is only ever evaluated for this agent.' }
                  : {})}
                onChange={(e) => updateRule(i, { resource: e.target.value })}
              />
              <Select
                size="md"
                className={cn('w-[4.75rem] shrink-0 font-medium', ACTION_COLORS[rule.effect])}
                aria-label={`Rule ${i + 1} action`}
                value={rule.effect}
                onValueChange={(v) => updateRule(i, { effect: v as CapabilityRule['effect'] })}
                options={effects}
              />
              <IconButton
                size="md"
                tone="danger"
                onClick={() => removeRule(i)}
                aria-label={`Remove permission rule ${i + 1}`}
                tooltip="Remove rule"
                className="opacity-40 transition-opacity group-hover/reorder-row:opacity-100 group-focus-within/reorder-row:opacity-100"
              >
                <Trash2 />
              </IconButton>
            </div>
          )
        })}
        <Button
          variant="ghost"
          size="lg"
          onClick={addRule}
          className="h-auto w-full justify-start rounded-none px-0 py-2.5 text-text-soft active:translate-y-0 active:scale-100"
        >
          <Plus aria-hidden="true" data-icon="inline-start" /> Add rule
        </Button>
      </div>
      {/* A reorder is silent otherwise: the DOM changes and nothing says what moved where.
          Outside the divided list for the same reason as the datalists: `sr-only` is clipped,
          not removed, so it would earn a separator under the last row. */}
      <output aria-live="polite" aria-atomic="true" className="sr-only">
        {reorder.announcement}
      </output>
    </div>
  )
}
