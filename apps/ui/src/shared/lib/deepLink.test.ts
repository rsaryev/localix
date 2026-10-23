import { describe, expect, it } from 'bun:test'
import { parseDeepLink } from './deepLink'

/** The hash a route-kind deep link addresses (null for any non-route link). */
const deepLinkToHash = (rawUrl: string): string | null => {
  const intent = parseDeepLink(rawUrl)
  return intent?.kind === 'route' ? intent.hash : null
}

describe('parseDeepLink — a tab the app opens', () => {
  it('passes a work-item link to the UI navigation as it came, query and all', () => {
    const url =
      'localix://ui/work-item/mini-app-store/add-catalog?url=https%3A%2F%2Fada.test%2Fc.json'
    expect(parseDeepLink(url)).toEqual({ kind: 'ui', uri: url })
  })

  it('takes no other kind of UI address from outside the app', () => {
    expect(parseDeepLink('localix://ui/action/command/quit')).toBeNull()
    expect(parseDeepLink('localix://ui/settings/root')).toBeNull()
  })
})

describe('parseDeepLink — route intent (as a hash)', () => {
  it('maps session links to the chat route', () => {
    expect(deepLinkToHash('localix://session/abc123')).toBe('#/chat/abc123')
    expect(deepLinkToHash('localix://session/AZ_0-9')).toBe('#/chat/AZ_0-9')
  })

  it('maps project links to the scoped project route', () => {
    // `#/chat?project=` was a legacy route without a session: its redirect ignored the
    // query and landed on `/`, which opened the default project instead of this one.
    expect(deepLinkToHash('localix://project/proj-1')).toBe('#/project/proj-1')
  })

  it('maps new?prompt to the home route with an encoded prompt', () => {
    expect(deepLinkToHash('localix://new?prompt=hello%20world')).toBe('#/?prompt=hello%20world')
    expect(deepLinkToHash('localix://new')).toBe('#/')
  })

  it('rejects anything outside the grammar', () => {
    expect(deepLinkToHash('https://session/abc')).toBeNull() // wrong scheme
    expect(deepLinkToHash('localix://session/')).toBeNull() // missing id
    expect(deepLinkToHash('localix://session/has spaces')).toBeNull() // bad charset
    expect(deepLinkToHash('localix://unknown/x')).toBeNull() // unknown host
    expect(deepLinkToHash('localix://session/a/b')).toBeNull() // extra segment
    expect(deepLinkToHash('not a url')).toBeNull()
  })

  it('rejects an over-long prompt', () => {
    const long = 'x'.repeat(4001)
    expect(deepLinkToHash(`localix://new?prompt=${long}`)).toBeNull()
  })
})

describe('parseDeepLink — open intent', () => {
  it('parses localix://open?path=… into an open intent', () => {
    expect(parseDeepLink('localix://open?path=/Users/me/proj')).toEqual({
      kind: 'open',
      path: '/Users/me/proj',
      fresh: false,
    })
  })

  it('decodes percent-encoded paths (spaces, drive letters)', () => {
    expect(parseDeepLink('localix://open?path=%2FUsers%2Fme%2Fmy%20app')).toEqual({
      kind: 'open',
      path: '/Users/me/my app',
      fresh: false,
    })
    expect(parseDeepLink('localix://open?path=C%3A%5Cdev%5Capp')).toEqual({
      kind: 'open',
      path: 'C:\\dev\\app',
      fresh: false,
    })
  })

  it('honors &new=1 as a fresh flag', () => {
    expect(parseDeepLink('localix://open?path=/x&new=1')).toEqual({
      kind: 'open',
      path: '/x',
      fresh: true,
    })
  })

  it('rejects an open link with no path or an absurd path', () => {
    expect(parseDeepLink('localix://open')).toBeNull()
    expect(parseDeepLink('localix://open?path=')).toBeNull()
    expect(parseDeepLink(`localix://open?path=/${'x'.repeat(4096)}`)).toBeNull()
  })

  // A deep link arrives from OUTSIDE the app, and `resolveProjectByPath` finds-or-CREATES a
  // project for whatever path it is handed — that project's workingDir is the scope every agent
  // tool then resolves against. `path.normalize` collapses `..` without making the result
  // absolute, so a relative path used to mint a project rooted at something that means a
  // different directory in every process that reads it.
  it('rejects a path that is not absolute', () => {
    expect(parseDeepLink('localix://open?path=../../etc')).toBeNull()
    expect(parseDeepLink('localix://open?path=relative/dir')).toBeNull()
    expect(parseDeepLink('localix://open?path=~/projects')).toBeNull()
    // Drive-RELATIVE on Windows: `C:foo` resolves against that drive's current directory.
    expect(parseDeepLink('localix://open?path=C%3Afoo')).toBeNull()
  })

  it('accepts every genuinely absolute form', () => {
    for (const raw of ['/Users/me/p', 'C%3A%5Cdev%5Cp', 'C%3A%2Fdev%2Fp', '%5C%5Cserver%5Cshare']) {
      expect(parseDeepLink(`localix://open?path=${raw}`)).not.toBeNull()
    }
  })

  it('rejects control characters, which can make the shown path differ from the opened one', () => {
    // A NUL truncates the path for anything that reaches libc.
    expect(parseDeepLink('localix://open?path=%2Ftmp%2Fsafe%00%2F..%2F..%2Fetc')).toBeNull()
    expect(parseDeepLink('localix://open?path=%2Ftmp%2Fa%0Ab')).toBeNull()
  })

  it('deepLinkToHash returns null for an open intent (needs async resolution)', () => {
    expect(deepLinkToHash('localix://open?path=/x')).toBeNull()
  })

  it('still classifies route links as route intents', () => {
    expect(parseDeepLink('localix://session/abc')).toEqual({ kind: 'route', hash: '#/chat/abc' })
  })
})
