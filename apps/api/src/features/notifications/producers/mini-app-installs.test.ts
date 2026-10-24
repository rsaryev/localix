import { afterEach, describe, expect, test } from 'bun:test'

import {
  createTestJournal,
  openRows,
  TEST_USER as U,
  type TestJournal,
} from '../conditions/testing/test-journal'
import { createMiniAppInstallFacts } from './mini-app-installs'

const journals: TestJournal[] = []
afterEach(async () => Promise.all(journals.splice(0).map((j) => j.close())))

async function setup() {
  const test = await createTestJournal()
  journals.push(test)
  return { test, report: createMiniAppInstallFacts(test.journal, U) }
}

const rowsOf = async (test: TestJournal) =>
  [...(await test.rows()).values()].map((row) => ({
    title: row.title,
    body: row.body,
    severity: row.severity,
    state: row.state,
  }))

describe('finished mini app installs, as the Event Center reads them', () => {
  test('one install is one short line', async () => {
    const { test, report } = await setup()
    report([{ name: 'habits', label: 'Habits', kind: 'install', version: '1.0.0' }])
    expect(await rowsOf(test)).toEqual([
      { title: 'Installed Habits', body: undefined, severity: 'success', state: 'open' },
    ])
  })

  test('installs and updates that finished together are one line each, naming the apps', async () => {
    const { test, report } = await setup()
    report([
      { name: 'habits', label: 'Habits', kind: 'install', version: '1.0.0' },
      { name: 'documents', label: 'Documents', kind: 'install', version: '1.0.0' },
      { name: 'kanban', label: 'Kanban', kind: 'install', version: '1.0.0' },
      { name: 'chess', label: 'Chess', kind: 'update', version: '1.2.0' },
      { name: 'reader', label: 'Reader', kind: 'update', version: '0.4.0' },
    ])
    expect((await rowsOf(test)).map(({ title, body }) => ({ title, body }))).toEqual([
      { title: 'Installed 3 mini apps', body: 'Habits, Documents and Kanban' },
      { title: 'Updated 2 mini apps', body: 'Chess and Reader' },
    ])
  })

  test('a failure says what did not happen, why, and offers to try again', async () => {
    const { test, report } = await setup()
    report([{ name: 'kanban', label: 'Kanban', kind: 'install', error: 'The download stopped' }])
    const [row] = await openRows(test)
    expect(row).toMatchObject({
      title: 'Could not install Kanban',
      body: 'The download stopped',
      severity: 'error',
    })
    expect(row?.actions).toEqual([
      {
        id: 'retry',
        label: 'Try again',
        kind: 'invoke',
        command: 'mini_app_install',
        requestId: 'kanban',
        available: true,
      },
    ])
  })

  test('the same failure again is still one row, and a later install settles it', async () => {
    const { test, report } = await setup()
    const failed = { name: 'kanban', label: 'Kanban', kind: 'update', version: '1.1.0' } as const
    report([{ ...failed, error: 'offline' }])
    report([{ ...failed, error: 'offline' }])
    expect((await openRows(test)).map((row) => row.title)).toEqual(['Could not update Kanban'])

    report([failed])
    const rows = await rowsOf(test)
    expect(rows).toContainEqual(
      expect.objectContaining({ title: 'Could not update Kanban', state: 'settled' }),
    )
    expect(rows).toContainEqual(expect.objectContaining({ title: 'Updated Kanban to 1.1.0' }))
  })

  test('the row goes to the person who asked, or the installation’s user for an update', async () => {
    const { test, report } = await setup()
    report([{ name: 'kanban', label: 'Kanban', kind: 'install', userId: 'ada' }])
    report([{ name: 'chess', label: 'Chess', kind: 'update', version: '1.2.0' }])
    expect((await openRows(test, 'ada')).map((row) => row.title)).toEqual(['Installed Kanban'])
    expect((await openRows(test)).map((row) => row.title)).toEqual(['Updated Chess to 1.2.0'])
  })
})
