import { expect, test } from 'bun:test'
import { localixResourceUri } from '@localixai/plugin-sdk/navigation'
import { linkKeyOf } from '@localixai/api/external-agent-identity'
import {
  externalSessionUri,
  externalSessionBinding,
  parseExternalResource,
  EXTERNAL_NAMESPACE,
} from './sessionResource'

test('a native identity is the same in a resource, context binding and navigation', () => {
  const identity = { provider: 'codex', nativeSessionId: 'session/100%:child' }
  const key = linkKeyOf(identity)
  const uri = externalSessionUri(key)
  expect(parseExternalResource(uri)).toEqual({ kind: 'session', ...identity, key })
  const binding = externalSessionBinding({ key, provider: 'codex', title: 'Review parser' })
  expect(binding.kind).toBe('context')
  expect(binding.target).toMatchObject({
    kind: 'resource',
    uri,
    token: `@resource:${uri}`,
    label: 'Review parser',
  })
  expect(uri).toContain('session%2F100%25%3Achild')
})

test('breadcrumbs distinguish containers from a session literally named cwd', () => {
  expect(parseExternalResource(localixResourceUri(EXTERNAL_NAMESPACE))).toEqual({ kind: 'root' })
  expect(parseExternalResource(localixResourceUri(EXTERNAL_NAMESPACE, ['codex']))).toEqual({
    kind: 'provider',
    provider: 'codex',
  })
  expect(
    parseExternalResource(localixResourceUri(EXTERNAL_NAMESPACE, ['codex', 'cwd', '/work/100%'])),
  ).toEqual({ kind: 'project', provider: 'codex', cwd: '/work/100%' })
  expect(parseExternalResource(externalSessionUri('codex:cwd'))?.kind).toBe('session')
  expect(parseExternalResource('localix://resource/other-agent/codex/s1')).toBeNull()
  expect(parseExternalResource('localix://resource/external-agent/codex/%ZZ')).toBeNull()
  expect(() => externalSessionUri('not-a-key')).toThrow()
})
