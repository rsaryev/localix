import { describe, expect, it } from 'bun:test'
import { resolveSecretTokens } from './secret-interpolate'

describe('resolveSecretTokens', () => {
  it('resolves independent keys concurrently while preserving substitutions', async () => {
    let started = 0
    let release = () => {}
    const mayFinish = new Promise<void>((resolve) => {
      release = resolve
    })
    const resultPromise = resolveSecretTokens(
      'postgres://${secret:USER}:${secret:PASS}@db/${secret:USER}',
      async (key) => {
        started += 1
        await mayFinish
        return key.toLowerCase()
      },
    )

    await Promise.resolve()
    try {
      expect(started).toBe(2)
    } finally {
      release()
    }
    expect(await resultPromise).toBe('postgres://user:pass@db/user')
  })

  it('reports the first missing key in token order after the parallel read', () => {
    expect(
      resolveSecretTokens('${secret:FIRST}/${secret:SECOND}', async () => null),
    ).rejects.toThrow('Secret not found: FIRST')
  })
})
