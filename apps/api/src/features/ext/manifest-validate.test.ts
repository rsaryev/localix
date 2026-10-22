import {
  DECLARABLE_EFFORTS_TEXT,
  REASONING_EFFORTS,
  isDeclarableEffort,
  resolveDeclaredReasoningEffort,
} from '../../db/types'
import { describe, it, expect } from 'bun:test'
import {
  editDistance,
  checkApiVersion,
  isRequiredConfigMissing,
  isUnsafeRelPath,
  isKebabCase,
  collectTextTokens,
} from './manifest-validate'

describe('editDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(editDistance('abc', 'abc')).toBe(0)
  })

  it('returns 1 for a single substitution', () => {
    expect(editDistance('cat', 'bat')).toBe(1)
  })

  it('returns 1 for a single insertion', () => {
    expect(editDistance('cat', 'cats')).toBe(1)
  })

  it('returns 1 for a single deletion', () => {
    expect(editDistance('cats', 'cat')).toBe(1)
  })

  it('returns 2 for two edits', () => {
    expect(editDistance('kitten', 'sitten')).toBe(1)
    expect(editDistance('abc', 'xyz')).toBe(3)
  })

  it('caps at 3 when length difference > 2', () => {
    expect(editDistance('a', 'abcdef')).toBe(3)
    expect(editDistance('abcdef', 'a')).toBe(3)
  })
})

describe('checkApiVersion', () => {
  it('pushes a warning when apiVersion is undefined', () => {
    const errors: string[] = []
    const warnings: string[] = []
    checkApiVersion('Plugin', 2, undefined, errors, warnings)
    expect(errors).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('apiVersion')
    expect(warnings[0]).toContain('2')
  })

  it('pushes an error when declaredApi > hostVersion', () => {
    const errors: string[] = []
    const warnings: string[] = []
    checkApiVersion('Plugin', 2, 5, errors, warnings)
    expect(warnings).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Plugin')
    expect(errors[0]).toContain('v5')
    expect(errors[0]).toContain('v2')
  })

  it('uses the kind string in error messages ("Provider")', () => {
    const errors: string[] = []
    const warnings: string[] = []
    checkApiVersion('Provider', 3, 10, errors, warnings)
    expect(errors[0]).toContain('Provider')
  })

  it('pushes nothing when declaredApi equals hostVersion', () => {
    const errors: string[] = []
    const warnings: string[] = []
    checkApiVersion('Plugin', 2, 2, errors, warnings)
    expect(errors).toHaveLength(0)
    expect(warnings).toHaveLength(0)
  })

  it('pushes nothing when declaredApi < hostVersion', () => {
    const errors: string[] = []
    const warnings: string[] = []
    checkApiVersion('Plugin', 3, 1, errors, warnings)
    expect(errors).toHaveLength(0)
    expect(warnings).toHaveLength(0)
  })
})

describe('isRequiredConfigMissing', () => {
  it('returns true when required and value is undefined', () => {
    expect(isRequiredConfigMissing({ required: true }, undefined)).toBe(true)
  })

  it('returns true when required and value is empty string', () => {
    expect(isRequiredConfigMissing({ required: true }, '')).toBe(true)
  })

  it('returns false when required and value is set', () => {
    expect(isRequiredConfigMissing({ required: true }, 'some-value')).toBe(false)
  })

  it('returns false when not required and value is undefined', () => {
    expect(isRequiredConfigMissing({ required: false }, undefined)).toBe(false)
    expect(isRequiredConfigMissing({}, undefined)).toBe(false)
  })

  it('returns false when required and value is a number', () => {
    expect(isRequiredConfigMissing({ required: true }, 42)).toBe(false)
  })

  it('returns false when required and value is boolean true', () => {
    expect(isRequiredConfigMissing({ required: true }, true)).toBe(false)
  })
})

describe('isUnsafeRelPath', () => {
  it('returns true for paths containing ".."', () => {
    expect(isUnsafeRelPath('../x')).toBe(true)
    expect(isUnsafeRelPath('foo/../bar')).toBe(true)
    expect(isUnsafeRelPath('..')).toBe(true)
  })

  it('returns true for Unix absolute paths', () => {
    expect(isUnsafeRelPath('/abs/path')).toBe(true)
    expect(isUnsafeRelPath('/')).toBe(true)
  })

  it('returns true for Windows absolute paths (C:\\...)', () => {
    expect(isUnsafeRelPath('C:\\Users\\foo')).toBe(true)
    expect(isUnsafeRelPath('D:\\something')).toBe(true)
  })

  it('returns true for UNC paths (\\\\server\\share)', () => {
    expect(isUnsafeRelPath('\\\\server\\share')).toBe(true)
  })

  it('returns false for safe relative paths', () => {
    expect(isUnsafeRelPath('./ok/x')).toBe(false)
    expect(isUnsafeRelPath('tools/index.mjs')).toBe(false)
    expect(isUnsafeRelPath('skills')).toBe(false)
  })
})

describe('isKebabCase', () => {
  it('accepts valid kebab-case names', () => {
    expect(isKebabCase('my-plugin')).toBe(true)
    expect(isKebabCase('hello')).toBe(true)
    expect(isKebabCase('hello-world')).toBe(true)
    expect(isKebabCase('abc123')).toBe(true)
    expect(isKebabCase('a1-b2-c3')).toBe(true)
  })

  it('rejects names with uppercase letters', () => {
    expect(isKebabCase('MyPlugin')).toBe(false)
    expect(isKebabCase('camelCase')).toBe(false)
  })

  it('rejects names with underscores', () => {
    expect(isKebabCase('my_plugin')).toBe(false)
  })

  it('rejects names with leading or trailing hyphens', () => {
    expect(isKebabCase('-plugin')).toBe(false)
    expect(isKebabCase('plugin-')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isKebabCase('')).toBe(false)
  })
})

describe('isDeclarableEffort', () => {
  it('accepts every level the system can actually carry', () => {
    // Derived from REASONING_EFFORTS, so this list cannot drift from what persists. The
    // previous hand-written regex REJECTED `minimal` — a level the runtime accepts and the
    // model picker offers — which meant a legitimate declaration was reported as invalid.
    for (const v of REASONING_EFFORTS) {
      expect({ v, ok: isDeclarableEffort(v) }).toEqual({ v, ok: true })
    }
    expect(isDeclarableEffort('minimal')).toBe(true)
  })

  it('accepts a native `xhigh` as itself, no longer normalized away', () => {
    // It used to normalize to `max` because the column could not hold it — which up-shifted the
    // declaration one rung, since on Claude 4.7+/Sonnet 5/Fable 5 `xhigh` sits BELOW `max`. It is
    // a real level now, so it survives as authored.
    expect(isDeclarableEffort('xhigh')).toBe(true)
    expect(resolveDeclaredReasoningEffort('xhigh')).toBe('xhigh')
  })

  it('rejects everything else, and the message lists exactly what is accepted', () => {
    for (const v of ['ultra', 'High', '', 'xlow', 'hgih']) {
      expect({ v, ok: isDeclarableEffort(v) }).toEqual({ v, ok: false })
    }
    // Surrounding whitespace is tolerated rather than being a mysterious rejection.
    expect(resolveDeclaredReasoningEffort('  medium ')).toBe('medium')
    expect(DECLARABLE_EFFORTS_TEXT).toBe('off, minimal, low, medium, high, xhigh, max')
  })

  it('an unrecognized value resolves to undefined, never to a level', () => {
    // This is the contract the one consumer depends on: undefined means "not specified", so a
    // typo inherits the parent's effort instead of reaching the provider, where an
    // unrecognized level becomes something provider-dependent — lowest supported on the OpenAI
    // family, `high` on adaptive Claude, a 400 on the legacy Anthropic budget path.
    expect(resolveDeclaredReasoningEffort('hgih')).toBeUndefined()
    expect(resolveDeclaredReasoningEffort(undefined)).toBeUndefined()
    expect(resolveDeclaredReasoningEffort('   ')).toBeUndefined()
  })
})

describe('collectTextTokens', () => {
  it('returns bare key names for ${KEY} tokens', () => {
    const tokens = collectTextTokens('Hello ${FOO} and ${BAR}')
    expect(tokens.has('FOO')).toBe(true)
    expect(tokens.has('BAR')).toBe(true)
    expect(tokens.size).toBe(2)
  })

  it('strips the user_config. prefix', () => {
    const tokens = collectTextTokens('Value is ${user_config.MY_KEY}')
    expect(tokens.has('MY_KEY')).toBe(true)
    expect(tokens.has('user_config.MY_KEY')).toBe(false)
  })

  it('handles mixed declared and user_config. tokens', () => {
    const tokens = collectTextTokens('${DIRECT} and ${user_config.INDIRECT}')
    expect(tokens.has('DIRECT')).toBe(true)
    expect(tokens.has('INDIRECT')).toBe(true)
    expect(tokens.size).toBe(2)
  })

  it('returns an empty set when no tokens are present', () => {
    expect(collectTextTokens('no tokens here').size).toBe(0)
  })

  it('deduplicates repeated references', () => {
    const tokens = collectTextTokens('${KEY} and ${KEY} again')
    expect(tokens.size).toBe(1)
    expect(tokens.has('KEY')).toBe(true)
  })
})
