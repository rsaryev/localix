import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * THE RUNNER READS SESSIONS THROUGH THE REPOSITORY IT IS HANDED, NEVER ONE OF ITS OWN.
 *
 * A route stores a model only when someone chose one for that agent in that conversation;
 * every other route is blank and the service graph's repository answers for it on read through
 * the model chain (`withResolvedRoutes`). The runner used to build a raw repository from `db`
 * beside that one, and every turn it started from its own read — a reaction, a loop tick, a
 * board wake — saw the blank and failed with `NO_MODEL`, while the typed turns next to them,
 * which arrive carrying the service's resolved record, ran fine. A "No model selected" row
 * in a live chat, under an agent whose model was in plain view.
 *
 * A type on `RunnerDeps` makes the repository REQUIRED; this reads the source so the runner
 * cannot quietly grow a second one back, which a required parameter alone does not prevent.
 *
 * The runner is the composition root PLUS the `agent-runner-*.ts` modules it is assembled from,
 * so every one of them is read: a guard pointed at the root alone would let a second repository
 * be built one file over, which is exactly where a split puts new construction.
 */
const RUNNER = join(import.meta.dir, 'agent-runner.ts')
const RUNNER_MODULES = readdirSync(import.meta.dir)
  .filter((f) => /^agent-runner(-[a-z-]+)?\.ts$/.test(f) && !f.endsWith('.test.ts'))
  .map((f) => join(import.meta.dir, f))
const OWN_REPOSITORY = /createChatRepository\s*\(/

describe('the agent runner and its repository', () => {
  test('the runner does not construct a chat repository of its own', () => {
    // Anti-void: the root and the modules split out of it (queue, status, lifecycle, …).
    expect(RUNNER_MODULES.length).toBeGreaterThanOrEqual(7)
    for (const file of RUNNER_MODULES) {
      expect({ file, constructs: OWN_REPOSITORY.test(readFileSync(file, 'utf8')) }).toEqual({
        file,
        constructs: false,
      })
    }
    expect(readFileSync(RUNNER, 'utf8')).toContain('deps.repo')
  })

  test('the pattern would catch the construction it forbids', () => {
    // The positive control: a guard whose regex matches nothing passes for the wrong reason.
    expect('const repo = createChatRepository(deps.db)').toMatch(OWN_REPOSITORY)
  })
})
