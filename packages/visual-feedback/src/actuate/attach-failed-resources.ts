/**
 * Fold failed-subresource signals onto a command result — the probe-entry glue that
 * decides WHERE a 404'd stylesheet/script/image is surfaced, extracted here so it's
 * pure and unit-testable (no probe mount, no DOM).
 *
 *  - On a SNAPSHOT-bearing result (open / snapshot / snapshotAfter): attach the FULL
 *    current list to `snapshot.failedResources` — the snapshot is a full re-read, so
 *    showing everything is right — and mark all of them reported.
 *  - On a diff-only DRIVE result (click/type/press/scroll/hover/steps): attach only the
 *    failures NEW since a prior command (tracked in `reported`), bounded, on the
 *    result-level `failedResources`. So a mid-session 404 shows up on the action that
 *    hit it, and doesn't repeat on every later action.
 *
 * `reported` is mutated to remember what has been surfaced across commands.
 */

import type { VfCommandAction, VfCommandResult } from '../protocol/index'

const DRIVE_ACTIONS: ReadonlySet<VfCommandAction> = new Set<VfCommandAction>([
  'click',
  'type',
  'press',
  'scroll',
  'hover',
  'steps',
])

export function attachFailedResources(
  result: VfCommandResult | undefined,
  failed: readonly string[],
  reported: Set<string>,
  maxNew = 4,
): VfCommandResult | undefined {
  if (!result || !failed.length) return result
  if (result.snapshot) {
    for (const f of failed) reported.add(f)
    return { ...result, snapshot: { ...result.snapshot, failedResources: [...failed] } }
  }
  if (!DRIVE_ACTIONS.has(result.action)) return result
  const fresh = failed.filter((f) => !reported.has(f))
  if (!fresh.length) return result
  for (const f of fresh) reported.add(f)
  return { ...result, failedResources: fresh.slice(0, maxNew) }
}
