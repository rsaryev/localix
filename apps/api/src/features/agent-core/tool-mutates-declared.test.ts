/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import {
  assertNotVoid,
  assertPositiveControl,
  scanSources,
  withPlantedSources,
} from '../../lib/source-lint'

/**
 * EVERY CORE TOOL MUST SAY, OUT LOUD, WHETHER IT MUTATES.
 *
 * `AgentTool.mutates` is OPTIONAL, and its absence is not "unknown" — two layers read it as a
 * positive claim that the tool only reads:
 *
 *   • `permission-engine.ts` — the `mutates` rule permission matches on `tool.mutates`, so a
 *     "confirm every mutating tool" rule (and any user rule written against `mutates`) never
 *     fires for a tool that omitted the flag;
 *   • `permission-gate.ts` — `Boolean(tool?.mutates)` is the fact fed to the rule engine.
 *
 * So the omission is a bug in BOTH directions, and neither is observable from outside. A tool that
 * writes but says nothing silently skips the write gate: no confirm, whatever the scope's rules
 * say. A read-only tool marked `true` raises a confirm on every read instead, which trains the
 * user to approve without looking.
 *
 * Both failures are an ABSENCE, and an absence is invisible to an ordinary test: there is no call
 * that behaves wrongly, only a decision that was never made. Measured before this guard: 18 of the
 * 27 `defineAgentTool` definitions under `tools/` named `mutates` nowhere at all — including
 * the then-core task board (persists board state), `agents` (starts one-shot task runs), and `browser` (drives the user's
 * running app).
 *
 * NO EXEMPTION LIST, deliberately, and that is a departure from the sibling guards that carry one.
 * The only blessing this lint could grant is "this tool need not say" — which is precisely the
 * defect. Every answer is one word long and every tool has one, so a hole here would not buy a
 * legitimate special case; it would only reintroduce the silent default under a different name.
 */

/** This file lives beside the tool tree it polices. */
const ROOT = import.meta.dir

/** Core tool definitions. `**` on purpose: a one-level walk never opens `preview/`, `file/`, … */
const INCLUDE = ['tools/**/*.ts']

/**
 * The walk must open most of the tree or the lint is off. Well under the ~130 non-test files there
 * are today, so ordinary deletions do not cry wolf, and far above what a moved/renamed directory
 * would leave behind.
 */
const MIN_FILES = 60

/**
 * BOTH declaration spellings, and OPTIONAL TYPE ARGUMENTS.
 *
 * Core tools import `defineAgentTool` directly, but `ctx.defineTool` is the public SDK spelling a
 * contributed tool uses, and a core tool moved behind it must not fall out of the scan. The
 * `(?:<[^(]*>)?` is the blindness the sibling plugin guard was measured to have: several of these
 * tools state their own generics — `defineAgentTool<z.infer<typeof schema>, Details>({…})` — so a
 * pattern anchored on `name(` skipped exactly the definitions most likely to be complex.
 */
const DECLARATION = /\b(?:defineAgentTool|defineTool)\s*(?:<[^(]*>)?\s*\(/g

/** One tool definition, whether it states `mutates` at all, and whether its calls are classed. */
interface ToolDecl {
  file: string
  name: string
  declaresMutates: boolean
  /** A `classify`, or the one static answer that needs none: `mutates: false`. */
  classified: boolean
}

/**
 * Is `property` set at the TOP LEVEL of this object literal?
 *
 * Depth matters: a `mutates` sitting inside a nested literal (a hints object, a step schema) is not
 * this tool's declaration, and a substring test would read it as one — a false PASS, which is the
 * only kind of failure a guard like this cannot survive. String and template literals are skipped
 * because a tool `description` routinely contains braces, and one unbalanced `{` inside prose would
 * throw the depth off for every property after it. Comments are already gone (`code`, never `raw`).
 */
function hasTopLevelProperty(body: string, property: string, value = ''): boolean {
  const needle = new RegExp(`^${property}\\s*:${value ? `\\s*${value}\\b` : ''}`)
  let depth = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i++; i < body.length; i++) {
        if (body[i] === '\\') i++
        else if (body[i] === ch) break
      }
      continue
    }
    if (ch === '{' || ch === '[' || ch === '(') depth++
    else if (ch === '}' || ch === ']' || ch === ')') depth--
    // Depth 1 is the tool literal's own body — `body` starts at its opening brace.
    else if (depth === 1 && needle.test(body.slice(i))) return true
  }
  return false
}

/**
 * Every tool definition in `code`, read by BRACE MATCHING rather than a line window: a definition
 * spans dozens of lines and nests whole object literals (schema, availability, guard), so a
 * fixed-size window reads half of one tool and half of the next.
 */
export function toolDeclarations(file: string, code: string): ToolDecl[] {
  const out: ToolDecl[] = []
  let cursor = 0
  for (const match of code.matchAll(DECLARATION)) {
    const at = match.index
    if (at < cursor) continue
    const open = code.indexOf('{', at)
    if (open < 0) continue
    let depth = 0
    let end = -1
    for (let i = open; i < code.length; i++) {
      if (code[i] === '{') depth++
      else if (code[i] === '}' && --depth === 0) {
        end = i
        break
      }
    }
    const body = code.slice(open, end < 0 ? code.length : end)
    const name = /\bname:\s*(?:'([^']+)'|TOOL\.(\w+)|(\w+))/.exec(body)
    if (name) {
      out.push({
        file,
        name: name[1] ?? name[2] ?? name[3] ?? '(unnamed)',
        declaresMutates: hasTopLevelProperty(body, 'mutates'),
        classified:
          hasTopLevelProperty(body, 'classify') || hasTopLevelProperty(body, 'mutates', 'false'),
      })
    }
    // Past this definition, so a nested `defineTool(` inside it is not read as a second tool.
    cursor = end < 0 ? code.length : end
  }
  return out
}

/** Tool definitions that state no `mutates`, as `file::name`. */
async function undeclared(root: string, minFiles: number): Promise<string[]> {
  const files = await scanSources({
    root,
    include: INCLUDE,
    skip: (f) => f.includes('.test.'),
    minFiles,
  })
  const decls = files.flatMap((f) => toolDeclarations(f.file, f.code))

  // ANTI-VOID on the DECLARATIONS, not merely on the files: a renamed `defineAgentTool`, a tools/
  // directory that moved, or a formatter that reshapes the call site all leave `decls` empty — and
  // a lint that examines nothing reports a clean tree forever.
  assertNotVoid(
    'defineAgentTool definition under tools/',
    decls.length,
    `Scanned ${files.length} file(s) matching ${INCLUDE.join(', ')} under ${root}.`,
  )

  return decls
    .filter((d) => !d.declaresMutates)
    .map((d) => `${d.file}::${d.name}`)
    .sort()
}

/**
 * Tool definitions whose calls carry no class, as `file::name`.
 *
 * `mutates: true` alone used to be a complete answer; it no longer is. A session mode decides on
 * WHERE a call's effect lands (`AgentTool.classify`), and a writer that says only "I write" is
 * classed `external` — the widest answer — so plan mode refuses its every call, game moves and
 * board cards included, and nothing can tell its reads from its writes. A pure reader needs no
 * classifier: `mutates: false` is already the whole answer.
 */
async function unclassified(root: string, minFiles: number): Promise<string[]> {
  const files = await scanSources({
    root,
    include: INCLUDE,
    skip: (f) => f.includes('.test.'),
    minFiles,
  })
  return files
    .flatMap((f) => toolDeclarations(f.file, f.code))
    .filter((d) => !d.classified)
    .map((d) => `${d.file}::${d.name}`)
    .sort()
}

/** A well-formed definition, for the positive control's scaffold and its planted offender. */
const toolSource = (name: string, extra = ''): string =>
  `import { defineAgentTool } from '@localixai/agent/agents'\n` +
  `export const t = defineAgentTool<Input, Details>({\n` +
  `  name: '${name}',\n` +
  `  description: 'a { brace } in prose, to prove strings are skipped',\n` +
  `  inputSchema: schema,\n` +
  extra +
  `  async execute() { return { content: 'x' } },\n` +
  `})\n`

/**
 * A file the scan always sees, so the anti-void assertion still has a subject when the offender is
 * masked. Without it a fully commented-out plant would THROW on anti-void instead of returning the
 * empty list the comment-blindness check needs to observe.
 */
const SCAFFOLD = {
  'tools/scaffold/reader.ts': toolSource('scaffold_reader', '  mutates: false,\n'),
}

describe('every core tool declares whether it mutates', () => {
  test('no defineAgentTool definition under tools/ leaves `mutates` unstated', async () => {
    const offenders = await undeclared(ROOT, MIN_FILES)

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : [
            '',
            `${offenders.length} tool definition(s) state no \`mutates\`:`,
            ...offenders.map((o) => `  ${o}`),
            '',
            'Omitting it is not "unspecified" — every reader treats it as `false`. A tool that writes',
            'then skips the confirm its scope asked for. Add `mutates: true` or `mutates: false` —',
            'whichever is true of what the tool actually does. For a tool whose calls are sometimes',
            'read-only, `mutates: true` plus `classify` keeps the read half confirm-free.',
            '',
          ].join('\n'),
    ).toEqual([])
  })

  test('every writing tool classes its calls', async () => {
    const offenders = await unclassified(ROOT, MIN_FILES)
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : [
            '',
            `${offenders.length} tool definition(s) write but class none of their calls:`,
            ...offenders.map((o) => `  ${o}`),
            '',
            'Declare `classify: (input) => CallClass` (`@localixai/agent/agents`): the effect of each',
            'call — read, view, session, files, host or external — plus irreversible/needsHuman.',
            '',
          ].join('\n'),
    ).toEqual([])
  })

  test('POSITIVE CONTROL — a writer without `classify` is named; a reader is not', async () => {
    const run = (extra: string) =>
      withPlantedSources(
        { ...SCAFFOLD, 'tools/nested/deep/planted.ts': toolSource('planted_tool', extra) },
        (root) => unclassified(root, 1),
      )
    expect(await run('  mutates: true,\n')).toEqual(['tools/nested/deep/planted.ts::planted_tool'])
    expect(await run('  mutates: false,\n')).toEqual([])
    expect(await run("  mutates: true,\n  classify: () => ({ effect: 'files' }),\n")).toEqual([])
  })

  /**
   * POSITIVE CONTROL, ON DISK. Zero offenders is the goal state, so a green run is indistinguishable
   * from a detector that quietly stopped finding tools. Plant the original bug — a tool definition
   * with no `mutates` — in a NESTED directory the walk must recurse into, and prove the REAL scan
   * names it (and stays silent when the same source is commented out).
   */
  test('POSITIVE CONTROL — a definition with no `mutates` is named', async () => {
    await assertPositiveControl({
      subject: 'a tool definition that states no `mutates`',
      file: 'tools/nested/deep/planted.ts',
      offender: toolSource('planted_tool'),
      scaffold: SCAFFOLD,
      detect: (root) => undeclared(root, 1),
    })
  })

  test('either explicit answer clears it; nothing else does', async () => {
    const run = (extra: string) =>
      withPlantedSources(
        { ...SCAFFOLD, 'tools/nested/deep/planted.ts': toolSource('planted_tool', extra) },
        (root) => undeclared(root, 1),
      )

    // Both answers are answers. The guard demands a DECISION, never a particular one.
    expect(await run('  mutates: true,\n')).toEqual([])
    expect(await run('  mutates: false,\n')).toEqual([])
    expect(await run('')).toEqual(['tools/nested/deep/planted.ts::planted_tool'])

    // A `mutates` nested inside another literal is NOT this tool's declaration. Without the
    // depth check this passed, which is the one failure mode a guard cannot survive: a false green.
    expect(await run('  hints: { mutates: true },\n')).toEqual([
      'tools/nested/deep/planted.ts::planted_tool',
    ])
  })

  test('the extractor reads whole definitions, and both spellings', () => {
    // Two tools in one file, the first carrying nested literals: a window-based reader attributes
    // the second tool's `mutates` to the first, or misses it entirely.
    const code = `
      const a = defineAgentTool<In, Out>({
        name: TOOL.first,
        inputSchema: z.object({ nested: z.object({ deep: z.string() }) }),
        mutates: true,
      })
      const b = ctx.defineTool({
        name: 'second',
      })
    `
    expect(toolDeclarations('f.ts', code)).toEqual([
      { file: 'f.ts', name: 'first', declaresMutates: true, classified: false },
      { file: 'f.ts', name: 'second', declaresMutates: false, classified: false },
    ])
  })
})
