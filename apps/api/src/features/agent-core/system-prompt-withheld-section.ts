import { TOOL } from './tool-names'
import { describeWithholdReason, remediableWithholds, type ToolLedger } from './tool-ledger'

/**
 * `# Unavailable tools` — the tools this run does NOT have that a click could restore.
 *
 * Rendered only when the run holds `configure`: naming a remedy to a run that cannot
 * propose it would be a pointer to nothing (the same rule the sub-agents section applies
 * to `history_search`). And only REMEDIABLE withholds are listed: a tool a sub-agent can
 * structurally never carry, or one whose host authority is absent, is not the model's
 * business — telling it would only tempt a turn spent discovering that.
 *
 * Bounded by the catalog size (one line per built-in at most), and session-stable: the
 * set changes when the user changes a rule, never while a turn runs — which puts it in the
 * cacheable prefix beside the other capability catalogs.
 */
export const WITHHELD_TOOLS_HEADER = '# Unavailable tools'

export function buildWithheldToolsSection(
  ledger: ToolLedger | undefined,
  liveToolNames: readonly string[],
  /**
   * Plugins installed here that nobody has said yes to yet.
   *
   * They are NOT in the ledger and cannot be: their code was never imported, so the names of
   * the tools they would contribute are not known — a manifest declares entry FILES, not tool
   * names. What can honestly be said is that the plugin is present and waiting, which is
   * enough for the model to offer the one click that settles it.
   */
  awaitingConsentPlugins: readonly string[] = [],
): string | null {
  if (!ledger || !liveToolNames.includes(TOOL.configure)) return null
  const rows = remediableWithholds(ledger)
  if (rows.length === 0 && awaitingConsentPlugins.length === 0) return null
  // One line per (reason, remedy) GROUP, not per tool: the per-tool form repeated the same
  // reason and the same remedy template on every line — seven identical clauses for a
  // narrowed roster, in the cached prefix of every request.
  const groups = new Map<string, { reason: string; remedyId: string; targets: string[] }>()
  for (const row of rows) {
    const reason = describeWithholdReason(row.reason)
    const key = `${reason}\u0000${row.remedy.remedyId}`
    const group = groups.get(key) ?? { reason, remedyId: row.remedy.remedyId, targets: [] }
    group.targets.push(row.remedy.target)
    groups.set(key, group)
  }
  const propose = (kind: string, name: string) =>
    `configure {action:"propose", change:{kind:"${kind}", name:"${name}"}}`
  return [
    WITHHELD_TOOLS_HEADER,
    'These exist but are switched off for this run. If the task needs one, propose it with `configure` — the user approves with one click; never claim the tool does not exist:',
    ...[...groups.values()].map(
      (group) =>
        `- ${group.targets.join(', ')} — ${group.reason} → ${propose(group.remedyId, group.targets.length === 1 ? group.targets[0]! : '<tool>')}`,
    ),
    ...(awaitingConsentPlugins.length > 0
      ? [
          `- ${awaitingConsentPlugins.map((name) => `plugin "${name}"`).join(', ')} — installed here and not allowed yet, so the code is not loaded and its tools are unknown until it is → ${propose('plugin.enable', awaitingConsentPlugins.length === 1 ? awaitingConsentPlugins[0]! : '<plugin>')}`,
        ]
      : []),
  ].join('\n')
}
