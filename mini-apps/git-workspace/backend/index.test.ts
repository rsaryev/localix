import { describe, expect, test } from 'bun:test'

import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'

import { register } from './index'

describe('Git Workspace mini app registration', () => {
  test('stays inert during generic inspection without host workspace services', async () => {
    const registration = await register({ host: undefined } as MiniAppContext)

    expect(registration).toEqual({ backend: [], tools: [] })
  })
})
