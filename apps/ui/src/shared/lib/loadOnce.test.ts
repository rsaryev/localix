import { describe, expect, test } from 'bun:test'
import { loadOnce } from '@localixai/kit/lib'

describe('loadOnce', () => {
  test('concurrent callers share one load, and a success is remembered', async () => {
    let calls = 0
    const load = loadOnce(async () => {
      calls += 1
      return 'module'
    })
    expect(await Promise.all([load(), load()])).toEqual(['module', 'module'])
    expect(await load()).toBe('module')
    expect(calls).toBe(1)
  })

  test('a failed load is forgotten, so the next call retries', async () => {
    let calls = 0
    const load = loadOnce(async () => {
      calls += 1
      if (calls === 1) throw new Error('chunk fetch failed')
      return 'module'
    })
    await expect(load()).rejects.toThrow('chunk fetch failed')
    expect(await load()).toBe('module')
    expect(calls).toBe(2)
  })
})
