import { createTwoFilesPatch } from 'diff'
import { diffDocumentFromPatch, type DiffDocument } from '@/shared/ui/diff'

/**
 * What changed between two plan versions, as the diff document the shared `VirtualDiff` renders —
 * so a revised plan can be checked against the last one instead of re-read whole.
 *
 * Null when there is no earlier version or nothing changed: the caller then offers no "Changes"
 * view at all rather than an empty one. The pseudo file names give the header "v1 → v2" without
 * pretending the plan is a file.
 */
export function buildPlanDiff(
  previous: { version: number; body: string } | undefined,
  current: { version: number; body: string },
): DiffDocument | null {
  if (!previous || previous.body.trim() === current.body.trim()) return null
  // A trailing newline on both sides, so the patch never marks "No newline at end of file" on
  // one side only.
  const a = previous.body.endsWith('\n') ? previous.body : `${previous.body}\n`
  const b = current.body.endsWith('\n') ? current.body : `${current.body}\n`
  const patch = createTwoFilesPatch(
    `Plan v${previous.version}`,
    `Plan v${current.version}`,
    a,
    b,
    '',
    '',
    { context: 3 },
  )
  return diffDocumentFromPatch(patch)
}
