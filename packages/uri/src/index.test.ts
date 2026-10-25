import { describe, expect, test } from 'bun:test'
import {
  capabilityResourceUri,
  capabilityUiUri,
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
    expect(capabilityUiUri(parseCapabilityResourceUri(uri)!)).toBe(
      'localix://ui/work-item/store?kind=mcp-server&id=project%3Acluster+tools%2Fprimary',
    )
  })
})

describe('where a capability is managed', () => {
  test('items open their page in the Store, in the scope they live in', () => {
    const at = (kind: Parameters<typeof capabilityUiUri>[0]['kind'], id: string, scope = '') =>
      capabilityUiUri({ kind, id, scope })
    expect(at('mini-app', 'tracker')).toBe('localix://ui/work-item/store?kind=mini-app&id=tracker')
    expect(at('agent', 'cc:a1')).toBe('localix://ui/work-item/store?kind=agent&id=cc%3Aa1')
    expect(at('skill', 'deploy')).toBe('localix://ui/work-item/store?kind=skill&id=user%3Adeploy')
    expect(at('skill', 'deploy', 'PRJ-1')).toBe(
      'localix://ui/work-item/store?kind=skill&id=project%3Adeploy',
    )
    expect(at('mcp', 'github')).toBe('localix://ui/work-item/store?kind=mcp-server&id=github')
    expect(at('plugin', 'lint@market')).toBe(
      'localix://ui/work-item/store?kind=plugin&id=lint%40market',
    )
  })

  test('a plugin known by name alone opens the Plugins shelf, a screen opens its mini app', () => {
    expect(capabilityUiUri({ kind: 'plugin', id: 'lint', scope: '' })).toBe(
      'localix://ui/work-item/store?kind=plugin',
    )
    expect(capabilityUiUri({ kind: 'view', id: 'tracker:board', scope: '' })).toBe(
      'localix://ui/work-item/store?kind=mini-app&id=tracker',
    )
  })

  test('a tool is decided in Settings → Permissions', () => {
    expect(capabilityUiUri({ kind: 'tool', id: 'bash', scope: 'PRJ-1' })).toBe(
      'localix://ui/settings/permissions?scope=PRJ-1',
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
