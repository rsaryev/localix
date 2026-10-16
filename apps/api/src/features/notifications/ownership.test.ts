import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import { assertNotVoid, assertPositiveControl, scanSources } from '../../lib/source-lint'

/**
 * ONE WRITE PATH, enforced.
 *
 * The journal is the single source of truth only while every change goes through
 * `NotificationJournal` — the transition rules (`projection.ts`), the redaction, the one writer and
 * the live publish all live there. A second module writing `notification_inbox` directly would
 * produce a row no event explains, skip the scrub, and never reach an open window. So the tables
 * are named in source only inside `features/notifications/` (and the migration and row types that
 * define them).
 */

const API_ROOT = path.resolve(import.meta.dir, '..', '..', '..')
const TABLE = /['"`]notification_(?:events|inbox|op_receipts)['"`]/u
const OWNED = (file: string) =>
  file.startsWith('src/features/notifications/') ||
  file === 'src/db/notification-types.ts' ||
  file === 'src/db/types.ts' ||
  file.startsWith('migrations/')

async function offenders(root: string): Promise<string[]> {
  const files = await scanSources({
    root,
    include: ['src/**/*.ts', 'migrations/**/*.ts'],
    skip: (file) => file.includes('.test.') || OWNED(file),
  })
  return files.filter((file) => TABLE.test(file.code)).map((file) => file.file)
}

describe('notification journal ownership', () => {
  test('only features/notifications names the journal tables', async () => {
    const files = await scanSources({
      root: API_ROOT,
      include: ['src/**/*.ts'],
      skip: (file) => file.includes('.test.'),
      minFiles: 300,
    })
    assertNotVoid('api production source', files.length)
    expect(await offenders(API_ROOT)).toEqual([])
  })

  test('the detector fires on a direct write from outside the feature (positive control)', async () => {
    await assertPositiveControl({
      subject: 'a feature inserting straight into the inbox',
      file: 'src/features/chat/runtime/run/sneaky.ts',
      offender: `await db.insertInto('notification_inbox').values(row).execute()`,
      detect: offenders,
    })
  })
})
