import { ConflictError } from '../../../lib/domain-errors'
import { contentHash } from './file-ops-context'

/** Outcome of a project-wide Replace all run. */
export interface ReplaceContentResult {
  /** Number of files whose contents changed. */
  filesChanged: number
  /** Total number of replacements written. */
  replacements: number
}

export interface ReplacePlan {
  path: string
  before: string
  after: string
  replacements: number
}

type ReplaceWriter = (path: string, content: string, baseHash: string) => Promise<unknown>

/**
 * Commit a prepared multi-file replacement. On a later conflict/write failure,
 * restore every file already committed (only when it still contains our exact
 * replacement bytes). This gives Replace all all-or-nothing behaviour for ordinary
 * failures without ever overwriting an external edit that raced the rollback.
 */
export async function commitReplacePlans(
  plans: readonly ReplacePlan[],
  write: ReplaceWriter,
): Promise<ReplaceContentResult> {
  const committed: ReplacePlan[] = []
  try {
    for (const plan of plans) {
      await write(plan.path, plan.after, contentHash(plan.before))
      committed.push(plan)
    }
  } catch (err) {
    const rollbackFailures: string[] = []
    for (const plan of committed.reverse()) {
      try {
        await write(plan.path, plan.before, contentHash(plan.after))
      } catch {
        rollbackFailures.push(plan.path)
      }
    }
    if (rollbackFailures.length > 0) {
      throw new ConflictError(
        'replace_partial',
        `Replace failed and ${rollbackFailures.length} file${rollbackFailures.length === 1 ? '' : 's'} could not be safely restored: ${rollbackFailures.join(', ')}`,
      )
    }
    throw err
  }
  return {
    filesChanged: committed.length,
    replacements: committed.reduce((sum, plan) => sum + plan.replacements, 0),
  }
}
