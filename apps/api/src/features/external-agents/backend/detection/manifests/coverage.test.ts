import { describe, expect, test } from 'bun:test'

import { PROVIDER_ADAPTERS } from '../../adapters/registry'
import { ManifestRegistry } from '../registry'
import { evaluateScreen } from '../evaluate'

/**
 * Every agent we can LAUNCH must be an agent we can READ.
 *
 * The terminal offers a one-click profile per provider, so an agent with no manifest sits at
 * `unknown` for its whole life — the roster shows it running and can say nothing about it, and
 * `wait` can never settle on it. That asymmetry is invisible until someone launches the one
 * provider nobody wrote a manifest for.
 */
const registry = new ManifestRegistry('/nonexistent-state-dir', () => {})

describe('detection coverage', () => {
  test('every provider adapter names a manifest that exists', () => {
    for (const adapter of PROVIDER_ADAPTERS) {
      expect(adapter.detectionManifestId, `${adapter.id} has no manifest`).toBeTruthy()
      expect(
        registry.get(adapter.detectionManifestId),
        `${adapter.id} manifest missing`,
      ).toBeTruthy()
    }
  })

  test("opencode's permission prompt is blocked, and its progress bar is working", () => {
    const manifest = registry.get('opencode')!
    expect(evaluateScreen(manifest, '△ Permission required').state).toBe('blocked')
    expect(evaluateScreen(manifest, 'thinking… esc to interrupt').state).toBe('working')
    expect(evaluateScreen(manifest, '■■■■■■ 60%').state).toBe('working')
  })

  test("gemini's confirmation is blocked, and a bare yes is not", () => {
    const manifest = registry.get('gemini-cli')!
    expect(evaluateScreen(manifest, '│ Apply this change').state).toBe('blocked')
    // "yes" appears on half the screens an agent ever draws; alone it proves nothing.
    expect(evaluateScreen(manifest, 'the answer is yes').state).toBe('idle')
    expect(evaluateScreen(manifest, 'yes — do you want to proceed?').state).toBe('blocked')
  })

  test('an unrecognized screen degrades to idle and says so', () => {
    // Guessing `blocked` would make a waiting caller believe a decision is needed when none is.
    for (const id of ['opencode', 'gemini-cli']) {
      const result = evaluateScreen(registry.get(id)!, 'some ordinary output')
      expect(result.state).toBe('idle')
      expect(result.fallbackReason).toBeTruthy()
    }
  })
})
