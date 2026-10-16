/**
 * `uri.ts` cannot import the vocabulary that owns its provider segment (it is bundled into the
 * browser — see that file's header), so the literal is written inline there. This test is what
 * keeps the two honest: a test is not the browser and may import the SDK.
 */
import { expect, test } from 'bun:test'
import { PROVIDER } from './resource-provider-id'
import { buildRequestUri } from './uri'

test('the inline provider segment equals the shared vocabulary', () => {
  expect(buildRequestUri('x')).toBe(`localix://resource/${PROVIDER}/x`)
})
