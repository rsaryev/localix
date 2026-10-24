import { describe, expect, test } from 'bun:test'
import type { MessageMutationResponse } from '../contracts'
import type { SessionRecord } from '../repository'
import { handlePluginsControlCommand } from './command-handlers-plugins'

/**
 * `--accept-command <sha256>` (plugins/cli-reference, `plugin install`, `plugin update`): the
 * person accepts the `headersHelper` command an install showed them, and the install or update
 * runs with that acceptance.
 */

const session = { id: 'session', projectId: null } as unknown as SessionRecord
const reply = async () => ({}) as MessageMutationResponse

describe('/plugin --accept-command', () => {
  test('install passes the acceptance and keeps it out of the source', async () => {
    const seen: unknown[] = []
    await handlePluginsControlCommand(
      {
        pluginService: {
          install: async (_user: string, input: unknown) => {
            seen.push(input)
            return { name: 'tool', version: '1.0.0', provides: {} }
          },
        },
      } as never,
      'user',
      session,
      '/plugin install tool@hosted --accept-command abc123',
      reply,
    )
    expect(seen).toEqual([
      expect.objectContaining({ source: 'tool@hosted', acceptCommand: 'abc123' }),
    ])
  })

  test('update passes the acceptance', async () => {
    const seen: unknown[] = []
    await handlePluginsControlCommand(
      {
        pluginService: {
          update: async (_user: string, input: unknown) => {
            seen.push(input)
            return { name: 'tool', version: '1.0.0', provides: {} }
          },
        },
      } as never,
      'user',
      session,
      '/plugin update tool --accept-command abc123',
      reply,
    )
    expect(seen).toEqual([expect.objectContaining({ name: 'tool', acceptCommand: 'abc123' })])
  })
})
