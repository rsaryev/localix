import { describe, expect, it } from 'bun:test'
import { isReadOnlyRedisCommand as ro } from './redis'

describe('isReadOnlyRedisCommand', () => {
  it('passes pure reads across every type', () => {
    for (const cmd of [
      'GET foo',
      'get foo',
      '  HGETALL h  ',
      'SCAN 0',
      'LRANGE l 0 -1',
      'ZRANGE z 0 -1 WITHSCORES',
      'XRANGE s - +',
      'SMEMBERS s',
      'INFO',
      'PING',
    ])
      expect(ro(cmd)).toBe(true)
  })

  it('blocks writes', () => {
    for (const cmd of [
      'SET foo bar',
      'DEL foo',
      'FLUSHALL',
      'FLUSHDB',
      'HSET h f v',
      'LPUSH l v',
      'ZADD z 1 m',
      'EXPIRE foo 10',
      'RENAME a b',
      'PFADD hll x',
      // Despite its read-like result and @read ACL category, Redis can update and
      // propagate the cached cardinality stored inside the HyperLogLog value.
      'PFCOUNT hll',
      'PFMERGE dst src',
      'RESTORE k 0 payload',
      'EVAL "return 1" 0',
      'SCRIPT LOAD "return 1"',
      'SHUTDOWN',
      'REPLICAOF host 1',
    ])
      expect(ro(cmd)).toBe(false)
  })

  it('distinguishes read from write subcommands on container commands', () => {
    expect(ro('CONFIG GET maxmemory')).toBe(true)
    expect(ro('MEMORY USAGE k')).toBe(true)
    expect(ro('CLIENT LIST')).toBe(true)
    expect(ro('LATENCY HISTORY x')).toBe(true)
    expect(ro('ACL WHOAMI')).toBe(true)

    // The whole reason this classifier is separate from the UI's keyspace-refresh set:
    // these mutate server state without touching a single key.
    expect(ro('CONFIG SET dir /tmp')).toBe(false)
    expect(ro('config set appendonly no')).toBe(false)
    expect(ro('CONFIG RESETSTAT')).toBe(false)
    expect(ro('CONFIG REWRITE')).toBe(false)
    expect(ro('MEMORY PURGE')).toBe(false)
    expect(ro('LATENCY RESET')).toBe(false)
    expect(ro('CLIENT KILL ID 4')).toBe(false)
    expect(ro('ACL SETUSER bob on')).toBe(false)
    expect(ro('SLOWLOG RESET')).toBe(false)
  })

  it('fails safe on a bare container command, an unknown verb, and empty input', () => {
    expect(ro('CONFIG')).toBe(false)
    expect(ro('MEMORY')).toBe(false)
    expect(ro('NOTACOMMAND k')).toBe(false)
    expect(ro('')).toBe(false)
    expect(ro('   ')).toBe(false)
  })
})
