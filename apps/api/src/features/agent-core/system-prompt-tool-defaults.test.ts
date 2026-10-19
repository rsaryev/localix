/**
 * Drift lint: a prompt section may never assert what a TOOL PARAMETER defaults to.
 *
 * The boundary is fixed — a tool's schema `description` is the ONLY home for
 * tool-specific guidance, the prompt carries cross-cutting discipline. `system-prompt-
 * dedup.test.ts` enforces that no two SECTIONS say the same thing; nothing enforced
 * that a section doesn't restate a TOOL. So the task-board section grew a copy of
 * browser's mechanics, and the copy drifted into a falsehood:
 *
 *     "every click/type/press/scroll returns the new page state too
 *      (snapshotAfter is ON by default)"
 *
 * The tool defaults to a cheap change-diff; `snapshotAfter: true` is opt-in. The model
 * was told it held fresh `[ref=eN]` handles it had never been given.
 *
 * A default lives in exactly one place — the schema — and the prompt is not that place.
 * A sentence naming a parameter AND claiming a default is the shape of that bug, so it
 * is the shape this test forbids. Guidance that merely USES a parameter
 * ("bash with background:true") is untouched.
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { CHAT_RUN_PROFILE } from './run-shape'
import { renderLintMatrix } from './testing/prompt-harness'
import { richRegistry } from './testing/prompt-render'

/**
 * Parameter names too generic to attribute to a tool: the prompt uses them as ordinary
 * English, and a sentence like "reason COMPACTLY" must not be read as a claim about
 * `quiz.reason`. Only names that are unmistakably a schema field are linted.
 */
const GENERIC = new Set([
  'path',
  'cwd',
  'query',
  'content',
  'text',
  'url',
  'command',
  'commands',
  'mode',
  'offset',
  'reason',
  'name',
  'title',
  'description',
  'action',
  'input',
  'file_path',
  'prompt',
  'message',
  'id',
  'value',
  'format',
  'type',
  'key',
  'keys',
  'steps',
  // The batched file tools' arrays: plain nouns in prose ("edit files directly").
  'files',
  'edits',
])

/** zod v4 models `z.preprocess` as a pipe whose `out` side is the real schema. */
const isPipe = (schema: unknown): schema is { def: { type: 'pipe'; out: unknown } } =>
  typeof schema === 'object' &&
  schema !== null &&
  (schema as { def?: { type?: string } }).def?.type === 'pipe'

/** The zod object keys of every tool a fully-loaded run registers. */
function toolParamNames(): Set<string> {
  const names = new Set<string>()
  {
    const registry = richRegistry(CHAT_RUN_PROFILE)
    for (const tool of registry.tools) {
      // A tool may wrap its object in a preprocess (`browser` lifts legacy flat
      // interactions into `steps` before validation); the parameters live on the inner object.
      let schema = tool.inputSchema as unknown
      while (isPipe(schema)) schema = schema.def.out
      if (!(schema instanceof z.ZodObject)) continue
      for (const key of Object.keys(schema.shape)) {
        if (key.length >= 4 && !GENERIC.has(key)) names.add(key)
      }
    }
  }
  return names
}

/** Claims about what a value is when the model does not set it. */
const DEFAULT_CLAIM = /\b(?:by default|defaults? to|is (?:ON|OFF) by default|is the default)\b/i

/** Sentence-ish split: prompts are bullets and long clauses, so split on both. */
const sentences = (prompt: string) =>
  prompt
    .split(/\n|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

describe('no prompt section asserts a tool parameter default', () => {
  const params = toolParamNames()

  test('the harness actually sees schema parameters (guards a silent empty lint)', () => {
    expect(params.size).toBeGreaterThan(5)
    expect(params.has('snapshot_after')).toBe(true)
    expect(params.has('background')).toBe(true)
  })

  const offenders: string[] = []
  // Goldens ∪ the full cross-product: a default-claim can hide in a variant with no golden.
  for (const [golden, prompt] of Object.entries(renderLintMatrix())) {
    for (const sentence of sentences(prompt)) {
      if (!DEFAULT_CLAIM.test(sentence)) continue
      for (const param of params) {
        if (sentence.includes(param)) offenders.push(`${golden}: "${sentence.slice(0, 160)}"`)
      }
    }
  }

  test('every rendered prompt leaves parameter defaults to the schema', () => {
    expect(offenders).toEqual([])
  })

  /**
   * Mutation test: a lint that passes because it detects nothing is worse than none.
   * This is the exact sentence that shipped in the task-board section.
   */
  test('the lint catches the sentence that shipped', () => {
    const shipped =
      'every click/type/press/scroll returns the new page state too (snapshot_after is ON by default)'
    expect(DEFAULT_CLAIM.test(shipped)).toBe(true)
    expect([...params].some((p) => shipped.includes(p))).toBe(true)
  })

  test('the lint does not flag guidance that merely USES a parameter', () => {
    const fine = 'Long-running processes MUST use bash with background:true.'
    expect(DEFAULT_CLAIM.test(fine)).toBe(false)
  })
})
