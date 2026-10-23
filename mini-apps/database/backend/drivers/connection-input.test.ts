import { describe, expect, it } from 'bun:test'
import { toDriverInput } from './connection-input'

describe('toDriverInput', () => {
  it('passes a url through verbatim', () => {
    expect(toDriverInput({ dialect: 'postgres', url: 'postgres://u:p@h:5432/db' })).toEqual({
      url: 'postgres://u:p@h:5432/db',
      host: undefined,
      port: undefined,
      user: undefined,
      password: undefined,
      database: undefined,
      ssl: undefined,
    })
  })

  it('carries discrete fields (field mode) including ssl', () => {
    const input = toDriverInput({
      dialect: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: 'root',
      database: 'app',
      ssl: { rejectUnauthorized: false },
    })
    expect(input).toEqual({
      url: undefined,
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: 'root',
      database: 'app',
      ssl: { rejectUnauthorized: false },
    })
  })

  it('returns an empty input for a file-based config', () => {
    expect(toDriverInput({ dialect: 'sqlite', file: '/tmp/x.db' })).toEqual({})
  })
})
