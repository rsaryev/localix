/**
 * THE boundary: `agent-core` must not VALUE-import `features/chat`.
 *
 * agent-core is the provider-agnostic agent-loop infrastructure; `features/chat` is one
 * host that drives it. A type-only import is fine (it erases at runtime and only names a
 * shape). A VALUE import inverts the dependency: agent-core would then need the chat
 * runtime to exist in order to load at all, and the tools suite could no longer be driven
 * by any other host (the delegated task run, a future embedder) or unit-tested in isolation.
 *
 * The invariant was documented and held in practice — but nothing ENFORCED it.
 * A single `import { chatService } from '../../chat/service'` would have landed green.
 *
 * This is a source-READING lint, deliberately not ripgrep: rg goes half-blind on a file
 * containing a NUL byte (it matches the lines BEFORE the byte and then silently stops,
 * while `rg -l` still lists the file — so you get hits and conclude the file was searched).
 * Reading the bytes cannot be fooled that way.
 *
 * The four mechanisms that make a source lint honest — a comment-stripper that is not
 * fooled by a `//` inside a string, a walk that RECURSES and proves it opened something,
 * an anti-void assertion, and a positive control planted ON DISK — are NOT hand-rolled
 * here. They live once in `lib/source-lint.ts`; this file supplies only the detector.
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { dirname } from 'node:path'
import {
  assertNotVoid,
  assertPositiveControl,
  scanSources,
  type SourceFile,
} from '../../lib/source-lint'

// Walks the whole source tree: seconds under a parallel run of every package, not milliseconds.
setDefaultTimeout(30_000)

const CORE_DIR = dirname(Bun.fileURLToPath(import.meta.url))

/** Every `import … from '<spec>'` statement in comment-stripped source, as { clause, spec }. */
function imports(code: string): { clause: string; spec: string }[] {
  return [...code.matchAll(/^import\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/gm)].map((m) => ({
    clause: m[1] as string,
    spec: m[2] as string,
  }))
}

/** Does this specifier resolve into `features/chat`? */
const isChatModule = (spec: string) => /(^|\/)chat(\/|$)/.test(spec)

/**
 * A VALUE import is one that survives to runtime. Type-only comes in two spellings and
 * BOTH must be accepted, or the lint would reject the legitimate type-only imports we
 * have:
 *   `import type { X } from …`         — statement-level
 *   `import { type X, type Y } from …` — every specifier inline-typed
 * A single un-`type`d specifier makes the whole statement a value import.
 */
export function isValueImport(clause: string): boolean {
  const c = clause.trim()
  if (c.startsWith('type ')) return false
  const named = c.match(/\{([\s\S]*)\}/)
  if (!named) return true // default / namespace import → always a value
  const before = c.slice(0, c.indexOf('{')).replace(/,\s*$/, '').trim()
  if (before) return true // `import def, { … }` → the default binding is a value
  const specs = (named[1] as string)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (specs.length === 0) return true // `import {} from …` → a side-effecting import
  return specs.some((s) => !s.startsWith('type '))
}

/** THE detector, parameterized on its root so the positive control runs the REAL one. */
async function offendingImports(root: string): Promise<string[]> {
  const sources = await scanSources({
    root,
    include: ['**/*.ts'],
    skip: (f) => f.endsWith('.test.ts'),
    // SCAN LIVENESS: "no offender found" is only evidence if the walk found the tree. A
    // relocated/renamed directory would otherwise reduce this lint to a permanent
    // all-clear over an empty file set. (The planted control tree gets its own floor.)
    minFiles: 1,
  })
  return sources
    .flatMap((s: SourceFile) => imports(s.code).map((i) => ({ file: s.file, ...i })))
    .filter((i) => isChatModule(i.spec) && isValueImport(i.clause))
    .map((i) => `${i.file}: import ${i.clause.replace(/\s+/g, ' ')} from '${i.spec}'`)
}

/**
 * The UI half of the plugin SDK describes a WORKBENCH: locations, surfaces, navigation. agent-core
 * is the loop any host can drive, so a workbench concept has no place in it even as a type — the
 * `localix_ui` tool used to live here and pull `UiAgentLocationDescriptor` into the registry's
 * option shape, which made the registry's signature depend on a UI. It now lives with the catalog
 * it searches (`features/ui-locations`) and is injected as a ready instance.
 */
const isUiSdkModule = (spec: string) => /^@localixai\/mini-app-sdk\/ui(\/|$)/.test(spec)

async function uiSdkImports(root: string): Promise<string[]> {
  const sources = await scanSources({
    root,
    include: ['**/*.ts'],
    skip: (f) => f.endsWith('.test.ts'),
    minFiles: 1,
  })
  return sources
    .flatMap((s: SourceFile) => imports(s.code).map((i) => ({ file: s.file, ...i })))
    .filter((i) => isUiSdkModule(i.spec))
    .map((i) => `${i.file}: import ${i.clause.replace(/\s+/g, ' ')} from '${i.spec}'`)
}

describe("agent-core must not import the plugin SDK's UI half", () => {
  test('no import of @localixai/mini-app-sdk/ui, type or value', async () => {
    expect(await uiSdkImports(CORE_DIR)).toEqual([])
  })

  test('positive control — a type-only import is still an offence here', async () => {
    await assertPositiveControl({
      subject: 'an import of @localixai/mini-app-sdk/ui',
      file: 'tools/bash/ui-leak.ts',
      offender: "import type { UiAgentLocationDescriptor } from '@localixai/mini-app-sdk/ui'\n",
      detect: uiSdkImports,
      // The backend and navigation halves are legitimately used; the detector must not fire on them.
      scaffold: { 'clean.ts': "import { safeFileKey } from '@localixai/mini-app-sdk/backend'\n" },
    })
  })
})

describe('agent-core must not value-import features/chat', () => {
  test('the walk really walks agent-core', async () => {
    const sources = await scanSources({
      root: CORE_DIR,
      include: ['**/*.ts'],
      skip: (f) => f.endsWith('.test.ts'),
      minFiles: 100,
    })
    expect(sources.length).toBeGreaterThan(100)
  })

  test('no VALUE import crosses the boundary', async () => {
    expect(await offendingImports(CORE_DIR)).toEqual([])
  })

  test('the path matcher is still pointed at something — the type-only imports we DO have', async () => {
    // DEAD-REGEX GUARD. Zero offenders is the goal state, so this lint can never prove
    // itself by finding one in the real tree. If `isChatModule` stops matching (the chat
    // feature moves, the import style changes), it would report "all clear" forever while
    // enforcing nothing. agent-core legitimately TYPE-imports chat's SessionStreamRegistry /
    // ChatRepository, so the matcher must keep finding those.
    const sources = await scanSources({
      root: CORE_DIR,
      include: ['**/*.ts'],
      skip: (f) => f.endsWith('.test.ts'),
      minFiles: 100,
    })
    const chatImports = sources.flatMap((s) => imports(s.code)).filter((i) => isChatModule(i.spec))
    assertNotVoid(
      'type-only import of features/chat',
      chatImports.length,
      'agent-core type-imports chat contracts (SessionStreamRegistry, ChatRepository). Zero of them means `isChatModule` went blind, not that the tree got cleaner — re-point it.',
    )
    expect(chatImports.every((i) => !isValueImport(i.clause))).toBe(true)
  })

  test('positive control — the REAL detector fires on the shape of the bug, planted on disk', async () => {
    await assertPositiveControl({
      subject: 'a value-import of features/chat',
      // NESTED on purpose: a walk that stopped recursing is caught right here.
      file: 'tools/bash/leaky.ts',
      offender: "import { chatService } from '../../../chat/service'\n",
      detect: offendingImports,
      // The clean file also satisfies the walk's minFiles floor AND proves the detector
      // is a detector, not a klaxon: a type-only import of the same module stays silent.
      scaffold: { 'clean.ts': "import type { ChatRepository } from '../../chat/repository'\n" },
    })
  })

  test('the clause classifier, unit-wise', () => {
    // Offending shapes.
    expect(isValueImport('{ chatService }')).toBe(true)
    expect(isValueImport('chatService')).toBe(true) // default
    expect(isValueImport('* as chat')).toBe(true) // namespace
    expect(isValueImport('chatService, { type Session }')).toBe(true) // default + inline types
    expect(isValueImport('{ type Session, buildRun }')).toBe(true) // one value among types
    // Legitimately allowed.
    expect(isValueImport('type { SessionStreamRegistry }')).toBe(false)
    expect(isValueImport('{ type ChatRepository, type HistoryMessageRow }')).toBe(false)
    // And the path matcher itself.
    expect(isChatModule('../../chat/service')).toBe(true)
    expect(isChatModule('../../../chat/runtime/session-stream-registry')).toBe(true)
    expect(isChatModule('../../loops/contracts')).toBe(false)
    expect(isChatModule('./tools/chatty-helper')).toBe(false)
  })
})
