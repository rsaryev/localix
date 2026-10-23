import { describe, expect, test } from 'bun:test'
import {
  capabilityResourceUri,
  capabilitySettingsUiUri,
  fileOpenMarkdownLink,
  fileUiUri,
  localixResourceUri,
  localixUiUri,
  parseCapabilityResourceUri,
  parseLocalixUri,
} from './index'

describe('capability resource URIs', () => {
  test('round-trips encoded ids and exact scope', () => {
    const uri = capabilityResourceUri({
      kind: 'mcp',
      id: 'cluster tools/primary',
      scope: 'PRJ/7',
      label: 'Cluster tools',
      description: 'Kubernetes operations',
      enabled: false,
    })

    expect(parseCapabilityResourceUri(uri)).toEqual({
      kind: 'mcp',
      id: 'cluster tools/primary',
      scope: 'PRJ/7',
      label: 'Cluster tools',
      description: 'Kubernetes operations',
      enabled: false,
    })
    expect(capabilitySettingsUiUri(parseCapabilityResourceUri(uri)!)).toBe(
      'localix://ui/settings/mcp/mcp-cluster%20tools%2Fprimary?scope=PRJ%2F7',
    )
  })
})

describe('a mini app in Settings', () => {
  test('a mini app and its screens open the Mini apps tab, never Plugins', () => {
    const app = capabilityResourceUri({ kind: 'mini-app', id: 'tracker', scope: '' })
    expect(capabilitySettingsUiUri(parseCapabilityResourceUri(app)!)).toBe(
      'localix://ui/settings/mini-apps/mini-app-tracker?scope=',
    )
    expect(capabilitySettingsUiUri({ kind: 'view', id: 'tracker:board', scope: '' })).toBe(
      'localix://ui/settings/mini-apps?scope=',
    )
  })
})

describe('canonical Localix URI protocol', () => {
  test('round-trips decoded breadcrumbs and query arguments', () => {
    const uri = localixResourceUri('fixture-db', ['connection/a', 'public schema'], {
      view: 'columns',
    })
    expect(uri).toBe('localix://resource/fixture-db/connection%2Fa/public%20schema?view=columns')
    const parsed = parseLocalixUri(uri)
    expect(parsed?.primitive).toBe('resource')
    expect(parsed?.breadcrumbs).toEqual(['fixture-db', 'connection/a', 'public schema'])
    expect(parsed?.query.get('view')).toBe('columns')
  })

  // The grammar is CANONICAL-SPELLING, and nothing asserted that until now. Two different
  // checks enforce it, which is why both cases are here:
  //   - The AUTHORITY is held by the plain `hostname !== 'ui' && hostname !== 'resource'`
  //     equality. That works only because `localix:` is a NON-SPECIAL scheme, so its host is
  //     opaque and `URL` leaves the case alone — `new URL('localix://RESOURCE/x').hostname` is
  //     `'RESOURCE'`, where an `http:` host would have been folded to lowercase.
  //   - The PROVIDER is held by `LOCALIX_PROVIDER`, which is case-sensitive. The SDK's resource
  //     parser reads it the same way (`mini-app-sdk/src/resource.test.ts`).
  test('requires canonical lowercase spelling for both the authority and the provider', () => {
    expect(parseLocalixUri('localix://resource/fixture-db/x')).toMatchObject({
      primitive: 'resource',
    })
    expect(parseLocalixUri('localix://RESOURCE/db/x')).toBeNull()
    expect(parseLocalixUri('localix://resource/DB/x')).toBeNull()
  })

  test('uses the same grammar for UI destinations without conflating authorities', () => {
    expect(parseLocalixUri(localixUiUri('settings', ['plugins']))).toMatchObject({
      primitive: 'ui',
      breadcrumbs: ['settings', 'plugins'],
    })
  })

  test('builds one canonical file destination for tools and user-facing Markdown', () => {
    const path = '/Users/me/My [final] report.pdf'
    const uri = fileUiUri({ path, line: 9 })
    expect(uri).toBe(
      'localix://ui/work-item/file?path=%2FUsers%2Fme%2FMy+%5Bfinal%5D+report.pdf&line=9',
    )
    expect(parseLocalixUri(uri)?.query.get('path')).toBe(path)
    expect(fileOpenMarkdownLink(path)).toBe(
      '[My \\[final\\] report.pdf](localix://ui/work-item/file?path=%2FUsers%2Fme%2FMy+%5Bfinal%5D+report.pdf)',
    )
  })

  test('rejects legacy schemes, fragments, aliases, and incomplete UI intents', () => {
    for (const uri of [
      'db://main/public',
      'localix://resource/fixture-db/main#fragment',
      'localix://resource/fixture-db/../git/root',
      'localix://resource/fixture-db/%2E%2E/git/root',
      'localix://resource/fixture-db/',
      'localix://resource/fixture-db//main',
      'localix://ui/command',
      'localix://ui/unknown/destination',
    ]) {
      expect(parseLocalixUri(uri)).toBeNull()
    }
  })

  test('builder fails fast on invalid providers and identity segments', () => {
    expect(() => localixResourceUri('DB', ['main'])).toThrow()
    expect(() => localixResourceUri('bad provider', ['main'])).toThrow()
    expect(() => localixResourceUri('db', [''])).toThrow()
    expect(() => localixResourceUri('db', ['..'])).toThrow()
    expect(() => localixResourceUri('db', ['x'.repeat(513)])).toThrow()
    expect(() => localixUiUri('settings', [])).toThrow()
  })
})

describe('capability resource URI validation', () => {
  test('fails closed on unknown, duplicate, malformed, and oversized query metadata', () => {
    const base = 'localix://resource/capability/tool/loops'
    for (const uri of [
      `${base}?unknown=1`,
      `${base}?scope=a&scope=b`,
      `${base}?enabled=yes`,
      `${base}?label=`,
      `${base}?description=`,
      `${base}?label=${'x'.repeat(161)}`,
      `${base}?description=${'x'.repeat(401)}`,
      `${base}?scope=${'x'.repeat(513)}`,
    ]) {
      expect(parseCapabilityResourceUri(uri)).toBeNull()
    }
  })
})
