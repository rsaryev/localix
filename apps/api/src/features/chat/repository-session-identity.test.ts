import { expect, test } from 'bun:test'
import { createDatabase } from '../../db/connection'
import { sessionFixture } from '../../testing/session-fixture'
import { claimSessionIdentity } from './repository-session-identity'

test('identity claims reject a database handle outside the insert transaction', async () => {
  const db = createDatabase()
  try {
    // @ts-expect-error A database handle cannot satisfy the transaction contract.
    await expect(claimSessionIdentity(db, sessionFixture())).rejects.toThrow('insert transaction')
  } finally {
    await db.destroy()
  }
})
