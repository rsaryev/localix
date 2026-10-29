import { describe, expect, test } from 'bun:test'

import { canonicalDeclaration, renderContract } from './mini-app-contract.mjs'
import { compareContracts, contractVerdict, parseContract } from './mini-app-contract-compare.mjs'

type Contract = Parameters<typeof renderContract>[0]

const base = (): Contract => ({
  apiVersion: 2,
  vendors: { zod: '4.6.7', '@types/react': '19.3.0' },
  served: {
    backend: ['@localixai/mini-app-sdk/backend', 'zod'],
    ui: { '@localixai/kit/button': ['Button'] },
  },
  modules: {
    '@localixai/kit/button': {
      Button:
        'export declare const Button: (props: {\n    size?: "sm" | "lg";\n    label: string;\n}) => React.ReactElement | null;',
    },
    '@localixai/mini-app-sdk/backend': {
      createMiniApp: 'export declare function createMiniApp(name: string, options?: Options): App;',
    },
  },
  types: { 'mini-app-sdk/dist/app.d.ts#Options': 'interface Options {\n    title?: string;\n}' },
})

const text = (contract: Contract) => renderContract(contract)
const changed = (edit: (contract: Contract) => void) => {
  const next = base()
  edit(next)
  return compareContracts(parseContract(text(base())), parseContract(text(next)))
}

describe('the committed mini app contract, read back', () => {
  test('is the contract it was rendered from', () => {
    const contract = base()
    const parsed = parseContract(text(contract))
    expect(parsed.apiVersion).toBe(2)
    expect(parsed.modules['@localixai/kit/button']?.Button).toBe(
      contract.modules['@localixai/kit/button']!.Button,
    )
    expect(parsed.served.ui['@localixai/kit/button']).toEqual(['Button'])
    expect(parsed.vendors.zod).toBe('4.6.7')
  })
})

// The compiler prints an inferred union in the order it created the members' types, which differs
// between machines; the committed contract must not.
describe('a declaration as the contract writes it', () => {
  test('reads the same whatever order its unions were printed in', () => {
    const a = canonicalDeclaration(
      'export declare const Button: (props: {\n    size?: "sm" | "lg" | null;\n    tone?: { kind: "b" | "a" };\n}) => void;',
    )
    const b = canonicalDeclaration(
      'export declare const Button: (props: {\n    size?: null | "lg" | "sm";\n    tone?: { kind: "a" | "b" };\n}) => void;',
    )
    expect(a).toBe(b)
  })
})

describe('what breaks a mini app built against the committed contract', () => {
  test('nothing, when nothing changed', () => {
    expect(changed(() => {})).toEqual({ breaking: [], changes: [] })
  })

  test('a module, an export or a served name taken away', () => {
    expect(
      changed((next) => {
        delete next.modules['@localixai/mini-app-sdk/backend']
      }).breaking,
    ).toContain('@localixai/mini-app-sdk/backend is gone')
    expect(
      changed((next) => {
        delete next.modules['@localixai/kit/button']!.Button
      }).breaking,
    ).toContain('@localixai/kit/button: Button is gone')
    expect(
      changed((next) => {
        next.served.ui['@localixai/kit/button'] = []
      }).breaking,
    ).toContain('the UI host no longer serves Button from @localixai/kit/button')
  })

  test('a prop removed, or one that was optional made required', () => {
    const removed = changed((next) => {
      next.modules['@localixai/kit/button']!.Button = next.modules[
        '@localixai/kit/button'
      ]!.Button!.replace('    size?: "sm" | "lg";\n', '')
    })
    expect(removed.breaking).toEqual(['@localixai/kit/button: Button loses props.size'])
    const required = changed((next) => {
      next.types['mini-app-sdk/dist/app.d.ts#Options'] =
        'interface Options {\n    title: string;\n}'
    })
    expect(required.breaking).toEqual(['mini-app-sdk/dist/app.d.ts#Options: title is now required'])
  })

  test('a function that now needs an argument it did not', () => {
    const result = changed((next) => {
      next.modules['@localixai/mini-app-sdk/backend']!.createMiniApp =
        'export declare function createMiniApp(name: string, options: Options): App;'
    })
    expect(result.breaking).toEqual([
      '@localixai/mini-app-sdk/backend: createMiniApp now requires options',
    ])
  })

  // An app written for a newer module fails to load on an older Localix: the host must say
  // it needs an update, which it only can from the apiVersion.
  test('a module the host serves for the first time', () => {
    expect(
      changed((next) => {
        next.served.backend.push('@localixai/mini-app-sdk/navigation')
      }).breaking,
    ).toEqual(['the backend host serves @localixai/mini-app-sdk/navigation for the first time'])
  })

  test('a lent package moved to another major version, or gone', () => {
    expect(changed((next) => void (next.vendors.zod = '5.0.0')).breaking).toEqual([
      'zod moves from 4.6.7 to 5.0.0',
    ])
    expect(changed((next) => void (next.vendors.zod = '4.7.0')).breaking).toEqual([])
  })
})

describe('what changes without breaking: listed for review', () => {
  test('a new export, a new optional prop, a declaration rewritten', () => {
    const result = changed((next) => {
      next.modules['@localixai/kit/button']!.ButtonGroup =
        'export declare const ButtonGroup: () => null;'
      next.types['mini-app-sdk/dist/app.d.ts#Options'] =
        'interface Options {\n    title?: string;\n    icon?: string;\n}'
    })
    expect(result.breaking).toEqual([])
    expect(result.changes).toEqual([
      '@localixai/kit/button: ButtonGroup is new',
      'mini-app-sdk/dist/app.d.ts#Options changed',
    ])
  })
})

describe('the verdict on a contract that moved', () => {
  const committed = text(base())
  const grown = (() => {
    const next = base()
    next.modules['@localixai/kit/button']!.ButtonGroup =
      'export declare const ButtonGroup: () => null;'
    return text(next)
  })()
  const broken = (apiVersion: number) => {
    const next = base()
    next.apiVersion = apiVersion
    delete next.modules['@localixai/kit/button']!.Button
    return text(next)
  }

  test('current: nothing to do', () => {
    expect(contractVerdict(committed, committed, { write: false })).toMatchObject({ ok: true })
  })

  test('a change that breaks nothing is written on request, and only then', () => {
    expect(contractVerdict(committed, grown, { write: false })).toMatchObject({
      ok: false,
      write: false,
    })
    expect(contractVerdict(committed, grown, { write: true })).toMatchObject({
      ok: true,
      write: true,
    })
  })

  // An agent that regenerates the contract cannot make a break pass: only a new apiVersion can.
  test('a break is refused, written or not, until the apiVersion moves', () => {
    expect(contractVerdict(committed, broken(2), { write: true })).toMatchObject({
      ok: false,
      write: false,
    })
    expect(contractVerdict(committed, broken(3), { write: true })).toMatchObject({
      ok: true,
      write: true,
    })
  })
})
