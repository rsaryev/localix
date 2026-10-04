import { describe, expect, it } from 'bun:test'

import { buildOpenUrl, openOutcomeMessage, resolveOpenPath } from './open-url'

const CWD = '/Users/me/work'
const HOME = '/Users/me'

describe('resolveOpenPath', () => {
  it('maps "." and empty to the cwd', () => {
    expect(resolveOpenPath('.', CWD, HOME)).toBe(CWD)
    expect(resolveOpenPath('', CWD, HOME)).toBe(CWD)
    expect(resolveOpenPath('  ', CWD, HOME)).toBe(CWD)
  })

  it('expands a literal ~ to the home dir', () => {
    expect(resolveOpenPath('~', CWD, HOME)).toBe(HOME)
    expect(resolveOpenPath('~/proj', CWD, HOME)).toBe('/Users/me/proj')
  })

  it('resolves a relative path against the cwd', () => {
    expect(resolveOpenPath('src/index.ts', CWD, HOME)).toBe('/Users/me/work/src/index.ts')
    expect(resolveOpenPath('../other', CWD, HOME)).toBe('/Users/me/other')
  })

  it('keeps an absolute path (normalized)', () => {
    expect(resolveOpenPath('/tmp/x', CWD, HOME)).toBe('/tmp/x')
    expect(resolveOpenPath('/tmp/./x/../y', CWD, HOME)).toBe('/tmp/y')
  })
})

describe('buildOpenUrl', () => {
  it('encodes the path into a localix://open link', () => {
    expect(buildOpenUrl('/Users/me/my app')).toBe('localix://open?path=%2FUsers%2Fme%2Fmy+app')
  })

  it('adds new=1 when fresh', () => {
    expect(buildOpenUrl('/x', true)).toBe('localix://open?path=%2Fx&new=1')
  })

  it('round-trips through the URL parser', () => {
    const url = new URL(buildOpenUrl('/Users/me/my app', true))
    expect(url.searchParams.get('path')).toBe('/Users/me/my app')
    expect(url.searchParams.get('new')).toBe('1')
  })
})

describe('openOutcomeMessage', () => {
  it('reports success to stdout with the path', () => {
    const { stream, text } = openOutcomeMessage('/Users/me/proj', true)
    expect(stream).toBe('stdout')
    expect(text).toContain('/Users/me/proj')
    expect(text).toContain('Opening')
  })

  it('reports failure to stderr with install guidance', () => {
    const { stream, text } = openOutcomeMessage('/x', false)
    expect(stream).toBe('stderr')
    expect(text).toContain('Could not reach')
    expect(text).toContain('localix://')
  })

  it("appends what the opener said, so not every failure reads as 'not installed'", () => {
    const { text } = openOutcomeMessage('/x', false, 'The system opener did not answer.')
    expect(text).toContain('The system opener did not answer.')
  })
})
