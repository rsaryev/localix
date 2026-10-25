import { afterEach, describe, expect, test } from 'bun:test'

import {
  createTestJournal,
  TEST_USER as U,
  type TestJournal,
} from '../conditions/testing/test-journal'
import { createSkillArchiveFacts } from './skills-curator'

const journals: TestJournal[] = []
afterEach(async () => Promise.all(journals.splice(0).map((j) => j.close())))

async function setup(day = '2026-06-11') {
  const test = await createTestJournal()
  journals.push(test)
  return { test, report: createSkillArchiveFacts(test.journal, () => new Date(`${day}T12:00:00Z`)) }
}

const rowsOf = async (test: TestJournal) => [...(await test.rows()).values()]

describe('skills the weekly pass archived, as the Event Center reads them', () => {
  test('one skill is one line with a way to its page, where it is restored', async () => {
    const { test, report } = await setup()
    report(U, ['review'])
    const [row] = await rowsOf(test)
    expect(row).toMatchObject({
      title: 'Archived the review skill: it was not used for a while',
      severity: 'info',
      state: 'open',
    })
    expect(row?.actions).toEqual([
      expect.objectContaining({
        label: 'Open to restore',
        kind: 'navigate',
        uri: expect.stringContaining('skill'),
      }),
    ])
    expect(row?.actions?.[0]?.uri).toContain('user%3Areview')
  })

  test('several are one line naming them, opening the skills', async () => {
    const { test, report } = await setup()
    report(U, ['a', 'b', 'c'])
    const rows = await rowsOf(test)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Archived 3 unused skills', body: 'a, b and c' })
    expect(rows[0]?.actions?.[0]?.label).toBe('Open skills')
  })

  test('a long list is cut, and a later pass is a new line', async () => {
    const { test, report } = await setup()
    report(
      U,
      Array.from({ length: 12 }, (_, i) => `skill-${i}`),
    )
    expect((await rowsOf(test))[0]?.body).toContain('and 2 more')
    const next = createSkillArchiveFacts(test.journal, () => new Date('2026-06-18T12:00:00Z'))
    next(U, ['review'])
    expect(await rowsOf(test)).toHaveLength(2)
  })

  test('nothing archived says nothing', async () => {
    const { test, report } = await setup()
    report(U, [])
    expect(await rowsOf(test)).toHaveLength(0)
  })
})
