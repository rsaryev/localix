import { describe, expect, test } from 'bun:test'

import { BUNDLED_MANIFESTS } from '../registry'
import { UPSTREAM_MANIFESTS } from './upstream-inventory'

/**
 * A rule may be dropped, but never SILENTLY.
 *
 * `btw_overlay_working` was in neither `rules` nor `unsupportedRules` for as long as this plugin
 * existed. Nothing failed and nothing was logged: the state it detects simply never appeared, and it
 * was the only `working` rule Claude Code has that does not need an OSC title. The same hole fits
 * every future change to a manifest.
 *
 * So each of our manifests is held against the recorded rule inventory. Dropping a rule is fine
 * — say so in `unsupportedRules` and the reason goes in the file header. Saying nothing is what
 * fails here.
 */
function ours(manifestId: string) {
  const manifest = BUNDLED_MANIFESTS.find((m) => m.id === manifestId)
  if (!manifest) throw new Error(`no manifest with id ${manifestId}`)
  return manifest
}

describe('every upstream rule is accounted for', () => {
  test('positive control: both sides are actually being read', () => {
    // A guard against silence can fail silently the same way — an empty inventory or an unresolved
    // manifest would make every assertion below vacuous.
    expect(UPSTREAM_MANIFESTS.length).toBeGreaterThan(0)
    for (const upstream of UPSTREAM_MANIFESTS) {
      expect([upstream.manifestId, upstream.rules.length > 0]).toEqual([upstream.manifestId, true])
      expect([upstream.manifestId, ours(upstream.manifestId).rules.length > 0]).toEqual([
        upstream.manifestId,
        true,
      ])
    }
    // The id that started this: it must be present as a real, ported rule.
    expect(ours('claude-code').rules.map((r) => r.id)).toContain('btw_overlay_working')
  })

  test('every manifest that ships has a recorded upstream', () => {
    // The reverse hole: a new provider's manifest with nothing to compare it against would be
    // guarded by none of the checks below, and would look guarded.
    const recorded = new Set(UPSTREAM_MANIFESTS.map((upstream) => upstream.manifestId))
    const unrecorded = BUNDLED_MANIFESTS.map((m) => m.id).filter((id) => !recorded.has(id))

    expect(unrecorded).toEqual([])
  })

  for (const upstream of UPSTREAM_MANIFESTS) {
    describe(`${upstream.manifestId} (${upstream.source} @ ${upstream.version})`, () => {
      const manifest = ours(upstream.manifestId)
      const ported = new Set(manifest.rules.map((rule) => rule.id))
      const declared = new Set(manifest.unsupportedRules ?? [])

      test('no upstream rule is absent from both lists', () => {
        const missing = upstream.rules
          .map((rule) => rule.id)
          .filter((id) => !ported.has(id) && !declared.has(id))

        // If this fails: port the rule, or add it to `unsupportedRules` with the reason in the
        // header. Both are answers; absence is not.
        expect(missing).toEqual([])
      })

      test('no rule is both ported and declared unsupported', () => {
        expect([...ported].filter((id) => declared.has(id))).toEqual([])
      })

      test('a ported rule keeps upstream state and priority', () => {
        const drift = manifest.rules.flatMap((rule) => {
          const up = upstream.rules.find((candidate) => candidate.id === rule.id)
          if (!up) return []
          return up.state === rule.state && up.priority === rule.priority
            ? []
            : [
                `${rule.id}: ours ${rule.state}/${rule.priority} vs upstream ${up.state}/${up.priority}`,
              ]
        })

        // Priority is in here because a drift reorders evaluation while every rule still looks right
        // on its own.
        expect(drift).toEqual([])
      })

      test('a rule we invented is declared as local, not left to look upstream', () => {
        const local = new Set(upstream.localRules ?? [])
        const upstreamIds = new Set(upstream.rules.map((rule) => rule.id))
        const unexplained = [...ported].filter((id) => !upstreamIds.has(id) && !local.has(id))

        expect(unexplained).toEqual([])
      })
    })
  }
})
