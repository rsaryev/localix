/** Separates the parts of an exemption key. */
export const KEY_SEP = '::'

export interface Exemption {
  /** WHY this match is not the defect. Mandatory: an unexplained blessing is a bug in wait. */
  reason: string
  /**
   * A recorded VIOLATION, not a blessing: it should be fixed, but the file lives in a tree
   * this lint's owner may not edit. It is EXPECTED to disappear, so the stale half skips it
   * — failing when someone else lands the fix would turn a GOOD change red, and a guard that
   * punishes the fix is a guard people learn to switch off.
   */
  debt?: true
}

export type Exemptions = Record<string, Exemption>

/**
 * Compose an exemption key. An exemption MUST name more than a bare identifier — it must
 * carry the SHAPE of what is blessed (the parameter list, the matched idiom, the claim, the
 * literal), so that a blessed symbol which CHANGES SHAPE loses its blessing.
 *
 * That is defect #4 in the header, and it is not hypothetical: keyed by the bare name
 * `notify`, the composition-root allowlist blessed a blessed adapter EVEN AFTER IT DROPPED
 * A PARAMETER — the exact bug the lint exists to catch, invisible inside its own exception
 * list. Keyed by `bootstrap.ts::notify(userId, sessionId)`, the same edit breaks the key:
 * the binding goes un-blessed (RED) and the entry goes stale (RED). Re-review, then re-key.
 */
export function exemptionKey(subject: string, ...shape: string[]): string {
  if (shape.every((s) => s.trim() === '')) {
    throw new Error(
      `source-lint: exemptionKey('${subject}') was given no SHAPE. A bare name blesses a NAME, ` +
        'not a thing — and a blessed thing that changes shape must LOSE its blessing.',
    )
  }
  return [subject, ...shape].join(KEY_SEP)
}

export interface ExemptionAudit {
  /** Matches nothing blessed: the lint's real finding. */
  offenders: string[]
  /** Blessings that match nothing any more (excluding `debt`): the other half. */
  stale: string[]
}

/**
 * Both halves of an allowlist, in one place.
 *
 * The OFFENDER half is why the lint exists. The STALE half is what keeps the allowlist
 * honest: a blessing that stopped being true must be DELETED, not left to bless the next
 * thing that happens to reuse its key.
 *
 * Refuses a key with no `::` — see {@link exemptionKey}. A bare-name allowlist is the
 * failure mode this primitive exists to make impossible, so it is rejected loudly rather
 * than quietly tolerated.
 */
export function auditExemptions(exemptions: Exemptions, found: Iterable<string>): ExemptionAudit {
  const bare = Object.keys(exemptions).filter((k) => !k.includes(KEY_SEP))
  if (bare.length > 0) {
    throw new Error(
      [
        `source-lint: ${bare.length} exemption key(s) carry no SHAPE (no '${KEY_SEP}'):`,
        ...bare.map((k) => `  ${k}`),
        '',
        'An exemption keyed by a bare name blesses that NAME wherever it appears — including a',
        'blessed symbol that has since CHANGED SHAPE. Build keys with exemptionKey(subject, …shape).',
      ].join('\n'),
    )
  }

  const hits = new Set(found)
  const offenders = [...hits].filter((k) => !(k in exemptions)).sort()
  const stale = Object.entries(exemptions)
    .flatMap(([key, e]) => (!e.debt && !hits.has(key) ? [key] : []))
    .sort()
  return { offenders, stale }
}

/** The standard failure message for a stale blessing. */
export function staleReport(stale: string[]): string {
  return [
    '',
    `${stale.length} exemption(s) no longer match anything the scan can see:`,
    ...stale.map((k) => `  ${k}`),
    '',
    'A blessing names ONE thing, by its shape. If the shape changed, that is exactly the event',
    'this guard exists to surface: re-read it, confirm it did not silently become the defect,',
    'then update the key. A blessing that stopped being true must be deleted.',
    '',
  ].join('\n')
}
