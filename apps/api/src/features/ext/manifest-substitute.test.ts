/**
 * Tests for the unified manifest token substituter.
 *
 * The KEY regression (B3): a config key declared as `API_KEY` (UPPERCASE) must
 * resolve identically via `${CLAUDE_PLUGIN_OPTION_API_KEY}` on BOTH the prompt
 * path (non-secret) and the MCP path. Previously the MCP path lowercased the
 * suffix to `api_key`, missing the `API_KEY` entry and silently returning `''`.
 */

import { describe, it, expect } from 'bun:test'
import { makeSubstituter, normalizeTokenKey } from './manifest-substitute'

// ---------------------------------------------------------------------------
// normalizeTokenKey
// ---------------------------------------------------------------------------

describe('normalizeTokenKey', () => {
  it('strips CLAUDE_PLUGIN_OPTION_ prefix without casing coercion', () => {
    expect(normalizeTokenKey('CLAUDE_PLUGIN_OPTION_API_KEY')).toBe('API_KEY')
    expect(normalizeTokenKey('CLAUDE_PLUGIN_OPTION_api_key')).toBe('api_key')
    expect(normalizeTokenKey('CLAUDE_PLUGIN_OPTION_MixedCase')).toBe('MixedCase')
  })

  it('strips user_config. prefix without casing coercion', () => {
    expect(normalizeTokenKey('user_config.API_KEY')).toBe('API_KEY')
    expect(normalizeTokenKey('user_config.api_key')).toBe('api_key')
  })

  it('returns bare key unchanged', () => {
    expect(normalizeTokenKey('API_KEY')).toBe('API_KEY')
    expect(normalizeTokenKey('token')).toBe('token')
  })
})

// ---------------------------------------------------------------------------
// makeSubstituter — B3 regression (the core fix)
// ---------------------------------------------------------------------------

describe('makeSubstituter — B3 regression: CLAUDE_PLUGIN_OPTION casing', () => {
  const config = { API_KEY: 'secret-value-123' }

  it('[prompt path] resolves ${CLAUDE_PLUGIN_OPTION_API_KEY} for a non-secret key', () => {
    const subst = makeSubstituter({
      pluginRoot: '/plugin',
      dataDir: '/data',
      projectDir: '/project',
      config,
      isSecret: () => false, // prompt path: explicitly non-secret for this key
    })
    expect(subst('key=${CLAUDE_PLUGIN_OPTION_API_KEY}')).toBe('key=secret-value-123')
  })

  it('[mcp path] resolves ${CLAUDE_PLUGIN_OPTION_API_KEY} with isSecret: () => false', () => {
    // B3: previously the MCP path lowercased the suffix → looked up config['api_key'] → miss → ''
    const subst = makeSubstituter({
      pluginRoot: '/plugin',
      dataDir: '/data',
      projectDir: '/project',
      config,
      isSecret: () => false, // MCP path: secrets allowed
    })
    expect(subst('Authorization: Bearer ${CLAUDE_PLUGIN_OPTION_API_KEY}')).toBe(
      'Authorization: Bearer secret-value-123',
    )
  })

  it('both paths produce the same substitution result (the B3 invariant)', () => {
    const promptSubst = makeSubstituter({
      pluginRoot: '/p',
      dataDir: '/d',
      projectDir: '/proj',
      config,
      isSecret: () => false,
    })
    const mcpSubst = makeSubstituter({
      pluginRoot: '/p',
      dataDir: '/d',
      projectDir: '/proj',
      config,
      isSecret: () => false,
    })
    const input = 'v=${CLAUDE_PLUGIN_OPTION_API_KEY}'
    expect(promptSubst(input)).toBe(mcpSubst(input))
    expect(promptSubst(input)).toBe('v=secret-value-123')
  })
})

// ---------------------------------------------------------------------------
// makeSubstituter — all token forms
// ---------------------------------------------------------------------------

describe('makeSubstituter — token forms', () => {
  const config = { MY_TOKEN: 'tok-abc', low_key: 'lower-val' }

  const subst = makeSubstituter({
    pluginRoot: '/root/plugin',
    dataDir: '/home/.localix/plugin-data/my-plugin',
    projectDir: '/projects/mine',
    config,
    isSecret: () => false,
  })

  it('resolves ${CLAUDE_PLUGIN_ROOT}', () => {
    expect(subst('root=${CLAUDE_PLUGIN_ROOT}')).toBe('root=/root/plugin')
  })

  it('resolves ${CLAUDE_PLUGIN_DATA}', () => {
    expect(subst('data=${CLAUDE_PLUGIN_DATA}')).toBe('data=/home/.localix/plugin-data/my-plugin')
  })

  it('resolves ${CLAUDE_PROJECT_DIR}', () => {
    expect(subst('dir=${CLAUDE_PROJECT_DIR}')).toBe('dir=/projects/mine')
  })

  it('resolves ${user_config.MY_TOKEN}', () => {
    expect(subst('t=${user_config.MY_TOKEN}')).toBe('t=tok-abc')
  })

  it('resolves bare ${MY_TOKEN}', () => {
    expect(subst('t=${MY_TOKEN}')).toBe('t=tok-abc')
  })

  it('resolves ${CLAUDE_PLUGIN_OPTION_MY_TOKEN} — the B3 form', () => {
    expect(subst('t=${CLAUDE_PLUGIN_OPTION_MY_TOKEN}')).toBe('t=tok-abc')
  })

  it('resolves lowercase key ${low_key} and its OPTION_ form', () => {
    expect(subst('v=${low_key}')).toBe('v=lower-val')
    expect(subst('v=${user_config.low_key}')).toBe('v=lower-val')
    expect(subst('v=${CLAUDE_PLUGIN_OPTION_low_key}')).toBe('v=lower-val')
  })

  it('resolves multiple tokens in one string', () => {
    expect(subst('root=${CLAUDE_PLUGIN_ROOT} token=${MY_TOKEN}')).toBe(
      'root=/root/plugin token=tok-abc',
    )
  })

  it('unknown key is left verbatim', () => {
    // Unknown bare keys are NOT substituted — they don't appear in the config
    // iteration, so the original ${UNKNOWN_KEY} text remains. This matches the
    // original prompt-path behavior.
    expect(subst('x=${UNKNOWN_KEY}')).toBe('x=${UNKNOWN_KEY}')
  })
})

// ---------------------------------------------------------------------------
// makeSubstituter — secret boundary
// ---------------------------------------------------------------------------

describe('makeSubstituter — secret boundary', () => {
  const config = { PUBLIC_KEY: 'pub-value', SECRET_KEY: 'my-secret' }

  it('[prompt path] secret key is NOT substituted (empty string)', () => {
    const subst = makeSubstituter({
      pluginRoot: '/p',
      dataDir: '/d',
      projectDir: '/proj',
      config,
      isSecret: (key) => key === 'SECRET_KEY',
    })
    expect(subst('pub=${PUBLIC_KEY} sec=${SECRET_KEY}')).toBe('pub=pub-value sec=')
    expect(subst('sec=${user_config.SECRET_KEY}')).toBe('sec=')
    expect(subst('sec=${CLAUDE_PLUGIN_OPTION_SECRET_KEY}')).toBe('sec=')
  })

  it('[mcp path] secret key IS substituted with isSecret: () => false', () => {
    const subst = makeSubstituter({
      pluginRoot: '/p',
      dataDir: '/d',
      projectDir: '/proj',
      config,
      isSecret: () => false,
    })
    expect(subst('sec=${SECRET_KEY}')).toBe('sec=my-secret')
    expect(subst('sec=${CLAUDE_PLUGIN_OPTION_SECRET_KEY}')).toBe('sec=my-secret')
  })
})
