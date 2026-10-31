import {
  REASONING_EFFORTS,
  isDeclarableEffort,
  resolveDeclaredReasoningEffort,
} from '../../db/types'
import { describe, it, expect } from 'bun:test'
import {
  checkApiVersion,
  isRequiredConfigMissing,
  isUnsafeRelPath,
  isKebabCase,
} from './manifest-validate'

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
