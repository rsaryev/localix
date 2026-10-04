import { afterAll, beforeAll, describe, it, expect } from 'bun:test'
import type { SearchDomainContribution } from '@localixai/plugin-sdk/ui'
import { registerSearchDomain, unregisterSearchDomain } from '@/shared/contrib/searchDomains'
import { parseScope, scopeToDomains, scopeById, ALL_SCOPE } from './scopes'

const fixtureDomain: SearchDomainContribution = {
  id: 'fixture-domain',
  scope: {
    label: 'Fixture domain',
    prefix: 'fixture',
    aliases: ['fx'],
    icon: 'search',
  },
}

beforeAll(() => registerSearchDomain(fixtureDomain))
afterAll(() => unregisterSearchDomain(fixtureDomain))

describe('parseScope', () => {
  it('promotes a known prefix', () => {
    const r = parseScope('fixture:users')
    expect(r.scope?.id).toBe('fixture-domain')
    expect(r.text).toBe('users')
  })
  it('promotes a known alias', () => {
    expect(parseScope('file:store').scope?.id).toBe('files')
    expect(parseScope('proj:x').scope?.id).toBe('projects')
    expect(parseScope('agent:reviewer').scope?.id).toBe('agents')
  })
  it('trims whitespace after the colon', () => {
    expect(parseScope('f:   store').text).toBe('store')
  })
  it('leaves an unknown prefix literal', () => {
    const r = parseScope('foo:bar')
    expect(r.scope).toBeNull()
    expect(r.text).toBe('foo:bar')
  })
  it('no prefix → literal', () => {
    expect(parseScope('auth middleware')).toEqual({ scope: null, text: 'auth middleware' })
  })
  it('empty text after prefix is allowed (bare pill)', () => {
    expect(parseScope('fixture:')).toMatchObject({ text: '' })
    expect(parseScope('fixture:').scope?.id).toBe('fixture-domain')
  })
  it('is case-insensitive on the prefix', () => {
    expect(parseScope('FIXTURE:x').scope?.id).toBe('fixture-domain')
  })
})

describe('scopeToDomains', () => {
  it('all / null → undefined (every eager domain)', () => {
    expect(scopeToDomains(null)).toBeUndefined()
    expect(scopeToDomains('all')).toBeUndefined()
  })
  it('a server domain → [id]', () => {
    expect(scopeToDomains('fixture-domain')).toEqual(['fixture-domain'])
    expect(scopeToDomains('files')).toEqual(['files'])
  })
  it('a client-only domain → undefined (never hits the endpoint)', () => {
    expect(scopeToDomains('settings')).toBeUndefined()
    expect(scopeToDomains('commands')).toBeUndefined()
  })
})

describe('scopeById', () => {
  it('resolves known ids incl. all', () => {
    expect(scopeById('all')).toBe(ALL_SCOPE)
    expect(scopeById('sessions')?.label).toBe('Chats')
  })
  it('undefined for unknown / empty', () => {
    expect(scopeById('nope')).toBeUndefined()
    expect(scopeById(null)).toBeUndefined()
  })
})
