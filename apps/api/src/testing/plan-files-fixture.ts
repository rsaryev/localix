/**
 * The plan's files in memory, for tests of the plans service: the same `createPlanFiles` the
 * server wires, over an execution environment that is a Map — so the paths, the draft reads and
 * the snapshot writes are production's, and only the disk is not.
 */
import { createPlanFiles } from '../features/plans/plan-files'
import type { PlanService } from '../features/plans/service'

/**
 * The service with `present` answering the stored version — for the lifecycle cases that each
 * present a NEW body and assert on the version, not on what `present` decided.
 */
export function withStoredVersions(service: PlanService) {
  return {
    ...service,
    present: async (...args: Parameters<PlanService['present']>) =>
      (await service.present(...args)).plan,
  }
}
export type VersionedPlans = ReturnType<typeof withStoredVersions>

export const PLAN_FIXTURE_CWD = '/work/project'

export function createMemoryPlanFiles(rootRef = 'LOCALIX-1') {
  const disk = new Map<string, string>()
  const files = createPlanFiles({
    open: async () => ({
      cwd: PLAN_FIXTURE_CWD,
      rootRef,
      env: {
        readFile: async (path) => {
          const text = disk.get(path)
          if (text === undefined) throw new Error(`ENOENT: ${path}`)
          return text
        },
        writeFile: async (path, content) => {
          disk.set(path, content)
        },
      },
    }),
  })
  const dir = `${PLAN_FIXTURE_CWD}/.localix/plans/${rootRef}`
  return {
    files,
    disk,
    dir,
    draftPath: `${dir}/PLAN.md`,
    /** The agent writes the draft, as its `write` tool would. */
    writeDraft: (text: string) => disk.set(`${dir}/PLAN.md`, text),
  }
}
