import { describe, expect, it } from 'bun:test'
import { matchRedisCommands } from './redisCommands'

describe('matchRedisCommands', () => {
  it('matches by verb prefix, case-insensitive', () => {
    const names = matchRedisCommands('hg').map((c) => c.name)
    expect(names).toContain('HGET')
    expect(names).toContain('HGETALL')
    expect(names.every((n) => n.startsWith('HG'))).toBe(true)
  })

  it('floats an exact verb match to the top', () => {
    expect(matchRedisCommands('get')[0]?.name).toBe('GET')
  })

  it('returns [] once the verb is complete (trailing space) or empty', () => {
    expect(matchRedisCommands('GET ')).toEqual([])
    expect(matchRedisCommands('')).toEqual([])
    expect(matchRedisCommands('   ')).toEqual([])
  })

  it('respects the limit', () => {
    expect(matchRedisCommands('S', 3).length).toBeLessThanOrEqual(3)
  })
})
