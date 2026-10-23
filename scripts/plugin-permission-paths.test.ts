/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import {
  assertNotVoid,
  auditExemptions,
  exemptionKey,
  scanSources,
  staleReport,
  withPlantedSources,
  type Exemptions,
} from '../apps/api/src/lib/source-lint'

/**
 * EVERY BUNDLED PLUGIN TOOL THAT MUTATES MUST BE VISIBLE TO THE PERMISSION RULES.
 *
 * `extractCallFacts` derives a call's path facts from a switch over tool NAMES, and by construction
 * that switch can only know core built-ins. A tool it does not recognise yields `paths: []` — and no
 * paths means `outsideWorkspace: false`, so the default `mutates + outside-workspace → ask` rule
 * cannot fire, and a user's own path `pattern` rule has nothing to match either (`matchesPattern`
 * only tests `call.paths` / `call.commands`). A plugin tool that writes files was therefore able to
 * write anywhere on disk with no prompt.
 *
 * THIS HOLE WAS FIRST CLOSED with name-specific core cases and then generically for contributed
 * tools. A plugin-owned writer could not get a core case, which is why each tool now declares its
 * own targets (`AgentTool.permissionPaths`)
 * and this guard exists: the failure is an ABSENCE, and an absence is invisible to ordinary tests.
 * A new mutating plugin tool that declares nothing fails HERE instead of in production.
 *
 * Blessing a tool is allowed, but it must carry its reason AND the shape it was blessed with, so a
 * tool that starts taking a path loses its blessing (`exemptionKey`).
 */

/** The repo root — this file lives under scripts/. */
const REPO_ROOT = path.resolve(import.meta.dir, '..')

/** Canonical bundled plugin backends. `packages/cli/server/**` is gitignored BUILD OUTPUT. */
const INCLUDE = ['mini-apps/**/backend/**/*.ts']

/**
 * A tool declaring `mutates: true` that contributes NO filesystem path, keyed by name + the reason's
 * shape. Each has been read: the mutation is real but does not land on a path a rule could match.
 */
const EXEMPT: Exemptions = {}

/** One `defineAgentTool({ … })` declaration. */
interface ToolDecl {
  file: string
  name: string
  mutates: boolean
  declaresPaths: boolean
  /** Its calls carry a class (`classify`). Only a writer needs one: a reader's class is `read`. */
  classifies: boolean
}

/**
 * OPTIONAL TYPE ARGUMENTS, and that is the THIRD blindness this detector has had. `defineAgentTool`
 * is generic, and a tool that states its own types — `defineAgentTool<Input, Details>({…})`, which
 * `write.ts` recommends and `read_document` already did — put a `<…>` between the name and the `(`,
 * so a pattern anchored on `name(` skipped the declaration entirely. It was found by adding a
 * `mutates: true` tool written that way and watching this guard PASS.
 *
 * BOTH declaration forms, and that is load-bearing: a bundled plugin either imports
 * `defineAgentTool` directly or takes it from its context as
 * `ctx.defineTool` — which is the PUBLIC SDK path, i.e. exactly how a third-party plugin
 * declares a tool. A detector that knew only the first form was blind to the
 * authored-by-plugin case it exists to guard; the exemption audit's stale half is what surfaced
 * that, by reporting two blessings for tools the scan could no longer see.
 */
const DECLARATION = /\b(?:defineAgentTool|defineTool)\s*(?:<[^(]*>)?\s*\(/g

/**
 * Every tool literal in `code`, read by BRACE MATCHING rather than a line window: a declaration
 * spans dozens of lines and contains nested object literals (schema, hints), so a fixed-size window
 * would read half of one tool and half of the next.
 */
export function toolDeclarations(file: string, code: string): ToolDecl[] {
  const out: ToolDecl[] = []
  const starts = [...code.matchAll(DECLARATION)].map((m) => m.index)
  let cursor = 0
  for (const at of starts) {
    if (at < cursor) continue
    const open = code.indexOf('{', at)
    let depth = 0
    let end = -1
    for (let i = open; i >= 0 && i < code.length; i++) {
      if (code[i] === '{') depth++
      else if (code[i] === '}' && --depth === 0) {
        end = i
        break
      }
    }
    const body = code.slice(open, end < 0 ? code.length : end)
    const name = /\bname:\s*'([^']+)'/.exec(body)?.[1]
    if (name) {
      out.push({
        file,
        name,
        mutates: /\bmutates:\s*true\b/.test(body),
        declaresPaths: /\bpermissionPaths\s*:/.test(body),
        classifies: /\bclassify\s*:/.test(body),
      })
    }
    // Skip past this declaration so a nested `defineTool(` inside it is not read as a second tool.
    cursor = end < 0 ? code.length : end
  }
  return out
}

/** Mutating plugin tools that declare NO paths, as exemption keys. */
async function undeclaredMutators(root: string, minFiles: number): Promise<string[]> {
  const files = await scanSources({
    root,
    include: INCLUDE,
    skip: (f) => f.includes('.test.'),
    minFiles,
  })
  const decls = files.flatMap((f) => toolDeclarations(f.file, f.code))

  // ANTI-VOID, on the DECLARATIONS and not just the files: a moved plugin directory, or a rename of
  // `defineAgentTool`, makes `decls` empty — and a guard that examines nothing passes forever.
  assertNotVoid(
    'defineAgentTool declaration under plugins/',
    decls.length,
    `Scanned ${files.length} file(s) matching ${INCLUDE.join(', ')} under ${root}.`,
  )

  return decls
    .filter((d) => d.mutates && !d.declaresPaths)
    .map((d) => d.name)
    .sort()
}

/**
 * Writing plugin tools whose calls carry no class.
 *
 * A writer that only says `mutates: true` is classed `external` on every call, the widest answer:
 * a Plan conversation refuses its reads with its writes (a game's `state`, a board's `list`), and
 * no rule can tell where its effect lands. The SDK's `classifyByAction` makes the answer one table.
 */
async function unclassifiedWriters(root: string, minFiles: number): Promise<string[]> {
  const files = await scanSources({
    root,
    include: INCLUDE,
    skip: (f) => f.includes('.test.'),
    minFiles,
  })
  return files
    .flatMap((f) => toolDeclarations(f.file, f.code))
    .filter((d) => d.mutates && !d.classifies)
    .map((d) => d.name)
    .sort()
}

/** Keys as the audit sees them: the exemption's own key, matched by tool name prefix. */
function matchExemptions(names: string[]): string[] {
  return names.map((name) => {
    const hit = Object.keys(EXEMPT).find((key) => key.split('::')[0] === name)
    return hit ?? exemptionKey(name, 'UNBLESSED')
  })
}

describe('bundled plugin tools that mutate are visible to the permission rules', () => {
  test('every mutating plugin tool declares its filesystem targets, or is blessed with a reason', async () => {
    const undeclared = await undeclaredMutators(REPO_ROOT, 8)
    const { offenders, stale } = auditExemptions(EXEMPT, matchExemptions(undeclared))

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : [
            '',
            `${offenders.length} bundled plugin tool(s) declare \`mutates: true\` and contribute NO path:`,
            ...offenders.map((k) => `  ${k.split('::')[0]}`),
            '',
            'The permission engine cannot see them: no paths → `outsideWorkspace: false`, so the',
            'default `mutates + outside-workspace → ask` rule never fires and a user path rule has',
            'nothing to match. Add `permissionPaths: (input) => [...]` to the tool, or bless it in',
            'EXEMPT with the reason its mutation reaches no path a rule could judge.',
            '',
          ].join('\n'),
    ).toEqual([])

    expect(stale, stale.length === 0 ? '' : staleReport(stale)).toEqual([])
  })

  /**
   * POSITIVE CONTROL, ON DISK. The goal state is ZERO offenders, so a green run is indistinguishable
   * from a detector that stopped finding tools. Plant the original bug — a mutating plugin tool with
   * no declaration — and prove the REAL scan names it.
   */
  test('POSITIVE CONTROL — a mutating plugin tool with no declaration is named', async () => {
    const tool = (extra: string) =>
      `export const t = defineAgentTool({\n  name: 'planted_writer',\n  mutates: true,\n${extra}  async execute() { return { content: 'x' } },\n})\n`

    expect(
      await withPlantedSources({ 'mini-apps/x/backend/w.ts': tool('') }, (root) =>
        undeclaredMutators(root, 1),
      ),
    ).toEqual(['planted_writer'])

    // And a declaration clears it.
    expect(
      await withPlantedSources(
        { 'mini-apps/x/backend/w.ts': tool('  permissionPaths: (i) => [i.path],\n') },
        (root) => undeclaredMutators(root, 1),
      ),
    ).toEqual([])

    // A READ-ONLY plugin tool is not the defect: only `mutates: true` needs targets.
    expect(
      await withPlantedSources(
        {
          'mini-apps/x/backend/r.ts': `export const t = defineAgentTool({\n  name: 'planted_reader',\n  async execute() { return { content: 'x' } },\n})\n`,
        },
        (root) => undeclaredMutators(root, 1),
      ),
    ).toEqual([])
  })

  test('the extractor reads whole declarations, not a line window', () => {
    // Two tools in one file, the first carrying a nested object literal: a window-based reader
    // attributes the second tool's `mutates` to the first, or misses it entirely.
    const code = `
      const a = defineAgentTool({
        name: 'first',
        inputSchema: z.object({ nested: z.object({ deep: z.string() }) }),
        permissionPaths: (i) => [i.path],
        mutates: true,
      })
      const b = defineAgentTool({
        name: 'second',
        mutates: true,
      })
    `
    expect(toolDeclarations('f.ts', code)).toEqual([
      { file: 'f.ts', name: 'first', mutates: true, declaresPaths: true, classifies: false },
      { file: 'f.ts', name: 'second', mutates: true, declaresPaths: false, classifies: false },
    ])
  })
})

describe('bundled plugin tools that write class their calls', () => {
  test('every writing plugin tool declares `classify`', async () => {
    const offenders = await unclassifiedWriters(REPO_ROOT, 8)
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : [
            '',
            `${offenders.length} bundled plugin tool(s) declare \`mutates: true\` and class no call:`,
            ...offenders.map((name) => `  ${name}`),
            '',
            'Every call is then `external`: Plan mode refuses its reads with its writes. Declare',
            '`classify` — `classifyByAction({...})` from `@localixai/mini-app-sdk/backend`.',
            '',
          ].join('\n'),
    ).toEqual([])
  })

  test('POSITIVE CONTROL — a writer without `classify` is named; a classed one is not', async () => {
    const tool = (extra: string) =>
      `export const t = defineAgentTool({\n  name: 'planted_writer',\n  mutates: true,\n${extra}  async execute() { return { content: 'x' } },\n})\n`
    const run = (extra: string) =>
      withPlantedSources({ 'mini-apps/x/backend/w.ts': tool(extra) }, (root) =>
        unclassifiedWriters(root, 1),
      )
    expect(await run('')).toEqual(['planted_writer'])
    expect(await run("  classify: () => ({ effect: 'session' }),\n")).toEqual([])
  })
})
