import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Kysely } from 'kysely'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { AppDatabase } from '../../db/types'
import { createCommentRepository } from '../comments/repository'
import { createMemoryPlanFiles } from '../../testing/plan-files-fixture'
import { headingTitle } from './presentation'
import { createPlanRepository } from './repository'
import { createPlanService } from './service'

/**
 * PRESENTING THE DRAFT FILE — what `present` decides against the latest version, and what it
 * writes. The failure: identical text became a new number, and a version the
 * person had been reviewing could only come back re-typed. Each case reads the versions and the
 * files back, and the notices and attention moves, so "no new version" is proved, not assumed.
 */
let db: Kysely<AppDatabase>
let notices: string[]
let signals: string[]
let files: ReturnType<typeof createMemoryPlanFiles>
let plans: ReturnType<typeof createPlanService>
const owner = { userId: 'u1', sessionId: 'root' }

beforeEach(async () => {
  db = createDatabase()
  await migrateToLatest(db)
  await db
    .insertInto('agent_sessions')
    .values({ project_id: 'PRJ-test', id: 'root', user_id: 'u1', title: 'root' })
    .execute()
  notices = []
  signals = []
  files = createMemoryPlanFiles()
  plans = createPlanService({
    repo: createPlanRepository(db),
    comments: createCommentRepository(db),
    files: files.files,
    publish: () => undefined,
    setMode: async () => undefined,
    wake: async () => ({ status: 'delivered' }),
    participants: async () => ['lead'],
    lifecycle: {
      notice: async (_owner, notice) => {
        notices.push(notice.text)
      },
      authorHandle: async () => null,
      awaiting: (_owner, plan) => signals.push(`awaiting v${plan.version}`),
      settled: (_owner, _id, reason) => signals.push(`settled ${reason}`),
      completed: () => undefined,
    },
  })
})
afterEach(() => destroyDatabase(db))

const versions = async () =>
  (await plans.list(owner)).map((plan) => [plan.version, plan.status] as const)
const present = (input = {}) => plans.present(owner, 'lead', input)

describe('presenting from the file', () => {
  test('snapshots the draft as v1, titled by its heading', async () => {
    files.writeDraft('# Cache layer\n\n## Goal\nFast')
    const { outcome, plan } = await present()
    expect(outcome).toBe('presented')
    expect(plan).toMatchObject({ version: 1, title: 'Cache layer', filePath: `${files.dir}/v1.md` })
    expect(files.disk.get(`${files.dir}/v1.md`)).toBe('# Cache layer\n\n## Goal\nFast\n')
  })

  test('a body is written to the draft first; the title falls back to the previous version', async () => {
    await present({ title: 'Cache', body: '## Goal\nFast' })
    expect(files.disk.get(files.draftPath)).toBe('## Goal\nFast\n')
    const { plan } = await present({ body: '## Goal\nFaster' })
    expect(plan).toMatchObject({ version: 2, title: 'Cache' })
  })

  test('no draft is an error that names the file to write', async () => {
    await expect(present()).rejects.toMatchObject({ status: 400 })
    await expect(present()).rejects.toThrow(files.draftPath)
    expect(await versions()).toEqual([])
  })
})

describe('the same text again', () => {
  test('latest presented → no new version, nothing said', async () => {
    files.writeDraft('## Goal\nFast')
    await present()
    notices = []
    // Whitespace layout is not a revision.
    files.writeDraft('## Goal\n  Fast\n\n')
    expect(await present()).toMatchObject({ outcome: 'unchanged', plan: { version: 1 } })
    expect(await versions()).toEqual([[1, 'presented']])
    expect(notices).toEqual([])
  })

  test('latest dismissed → that version is restored under its own number', async () => {
    files.writeDraft('## Goal\nFast')
    const { plan } = await present()
    await plans.dismiss(owner, plan.id)
    signals = []
    expect(await present()).toMatchObject({ outcome: 'restored', plan: { version: 1 } })
    expect(await versions()).toEqual([[1, 'presented']])
    expect(notices.at(-1)).toBe('Plan v1 is back for review.')
    expect(signals).toEqual(['awaiting v1'])
  })

  test('latest superseded → restored, and the version that was waiting is superseded', async () => {
    files.writeDraft('## Goal\nOne')
    const v1 = (await present()).plan
    await plans.approve(owner, v1.id, 'default')
    files.writeDraft('## Goal\nTwo')
    await present()
    files.writeDraft('## Goal\nThree')
    const v3 = (await present()).plan
    // Approving v2 supersedes v3 (the newest); presenting v3's text again brings it back.
    await plans.approve(owner, (await plans.list(owner))[1]!.id, 'default')
    expect(await present()).toMatchObject({ outcome: 'restored', plan: { id: v3.id } })
    expect(await versions()).toEqual([
      [3, 'presented'],
      [2, 'approved'],
      [1, 'superseded'],
    ])
  })

  test('latest approved → refused: edit the plan to propose a change', async () => {
    files.writeDraft('## Goal\nFast')
    const { plan } = await present()
    await plans.approve(owner, plan.id, 'default')
    await expect(present()).rejects.toMatchObject({ status: 409 })
    await expect(present()).rejects.toThrow('edit PLAN.md')
    expect(await versions()).toEqual([[1, 'approved']])
  })

  test('the snapshot is re-written from the stored body when the version is touched', async () => {
    files.writeDraft('## Goal\nFast')
    const { plan } = await present()
    files.disk.set(`${files.dir}/v1.md`, 'hand edited')
    await plans.dismiss(owner, plan.id)
    await present()
    expect(files.disk.get(`${files.dir}/v1.md`)).toBe('## Goal\nFast\n')
  })
})

describe('the overview', () => {
  test('the draft state: absent, same as the latest, changed after it', async () => {
    expect((await plans.overview(owner)).draft).toEqual({
      path: files.draftPath,
      exists: false,
      changed: false,
    })
    files.writeDraft('## Goal\nFast')
    expect((await plans.overview(owner)).draft.changed).toBe(true)
    await present()
    expect((await plans.overview(owner)).draft.changed).toBe(false)
    files.writeDraft('## Goal\nFaster')
    expect((await plans.overview(owner)).draft.changed).toBe(true)
  })
})

test('the heading title reads the first # heading only', () => {
  expect(headingTitle('intro\n## Sub\n# Cache layer #\n# Other')).toBe('Cache layer')
  expect(headingTitle('## Only sub')).toBeUndefined()
})
