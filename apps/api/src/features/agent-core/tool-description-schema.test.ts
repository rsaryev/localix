import { describe, expect, test } from 'bun:test'
import { zodToJsonSchema } from '@localixai/agent'

import { resolveRunProfile } from './run-shape'

/** Every run shape, derived — the surface a tool can reach the model through. */
const RUN_PROFILES = (['chat', 'subagent', 'job'] as const).map((sessionKind) =>
  resolveRunProfile({ sessionKind }),
)
import { richRegistry } from './prompt/testing/prompt-render'

/**
 * A tool's DESCRIPTION must not name a field or value its own SCHEMA rejects.
 *
 * This is the one place where the model is told how to call a tool, and the schema description
 * is the ONLY home for tool-specific guidance — so a description that
 * advertises something the schema refuses costs a whole round-trip and teaches the model a
 * call that can never succeed. That is not hypothetical: `browser` documented a
 * `"step"` action its enum did not accept, and it was found by watching a live agent fail
 * (recorded in a tool audit), because nothing checks the two halves against each
 * other.
 *
 * Rule: every backticked lowercase identifier in a description must be a property of that
 * tool's schema, a value its schema accepts, or the name of another tool. Cross-tool
 * references are legitimate and common — `read` tells the model to prefer `search` with its
 * `context` parameter — so a property of ANY tool counts.
 *
 * MEASURED and deliberately NOT enforced: seven tools have a required parameter their prose
 * never names (`ask.questions`, `write.path`, `loops.action`, `sleep.seconds`, …). That reads
 * like a gap but is not one — the provider hands the model the JSON Schema, `required` and
 * all, so requiredness is already machine-readable. The historical defect there
 * (`open_preview` requiring `start_command`) was that requiring it was WRONG, which no static
 * check can know. A rule nobody can justify, with seven immediate exemptions, would only
 * teach people to add exemptions.
 */

/** Every distinct tool the product can hand a model, across run shapes. */
function everyTool(): Map<string, { description: string; inputSchema: unknown }> {
  const byName = new Map<string, { description: string; inputSchema: unknown }>()
  for (const profile of RUN_PROFILES) {
    {
      for (const tool of richRegistry(profile).tools) {
        if (typeof tool.description !== 'string' || !tool.inputSchema) continue
        if (!byName.has(tool.name)) {
          byName.set(tool.name, { description: tool.description, inputSchema: tool.inputSchema })
        }
      }
    }
  }
  return byName
}

/** Property names and accepted literal values anywhere in a JSON Schema, unions included. */
function schemaVocabulary(node: unknown, props = new Set<string>(), values = new Set<string>()) {
  if (!node || typeof node !== 'object') return { props, values }
  const record = node as Record<string, unknown>
  if (record.properties && typeof record.properties === 'object') {
    for (const key of Object.keys(record.properties as object)) props.add(key)
  }
  if (Array.isArray(record.enum)) {
    for (const value of record.enum) if (typeof value === 'string') values.add(value)
  }
  if (typeof record.const === 'string') values.add(record.const)
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) child.forEach((item) => schemaVocabulary(item, props, values))
    else schemaVocabulary(child, props, values)
  }
  return { props, values }
}

/**
 * Backticked identifiers that are neither fields nor values — prose naming something else.
 * Keep this list tiny and specific; a growing list means the rule is being worked around.
 */
const PROSE_IDENTIFIERS: Readonly<Record<string, readonly string[]>> = {
  // The description steers the model away from shelling out to these, by name.
  bash: ['cat', 'head', 'tail'],
  // The description names the JavaScript a script ends with.
  codemode: ['return'],
}

describe('tool descriptions match their schemas', () => {
  const tools = everyTool()

  test('covers every tool the product can expose', () => {
    // Guards the guard: a registry change that stops yielding tools would otherwise turn
    // this whole file into a silent pass.
    console.log(`[tool-description-schema] checked ${tools.size} distinct tools`)
    expect(tools.size).toBeGreaterThanOrEqual(18)
  })

  test('every tool schema is an object at the root — a provider-side 400 otherwise', () => {
    // OpenAI-family providers reject a function whose parameters root has no `type: "object"`;
    // the `vault` tool's discriminatedUnion root failed exactly this way, live via OpenRouter,
    // and took every turn of the session down with it.
    const bareRoots = [...tools]
      .filter(
        ([, tool]) => zodToJsonSchema(tool.inputSchema as { _def?: unknown }).type !== 'object',
      )
      .map(([name]) => name)
    expect(bareRoots).toEqual([])
  })

  test('no description names a field or value the schemas reject', () => {
    const vocabulary = new Map<string, ReturnType<typeof schemaVocabulary>>()
    for (const [name, tool] of tools)
      vocabulary.set(name, schemaVocabulary(zodToJsonSchema(tool.inputSchema as never)))
    const everyProp = new Set([...vocabulary.values()].flatMap((v) => [...v.props]))

    const offenders: string[] = []
    for (const [name, tool] of tools) {
      const own = vocabulary.get(name)!
      const allowed = new Set(PROSE_IDENTIFIERS[name] ?? [])
      const ticked = [...tool.description.matchAll(/`([^`\n]{1,40})`/g)].map((match) => match[1]!)
      for (const token of new Set(ticked)) {
        if (!/^[a-z][a-zA-Z0-9_]*$/.test(token)) continue
        if (
          own.props.has(token) ||
          own.values.has(token) ||
          everyProp.has(token) ||
          tools.has(token) ||
          allowed.has(token)
        ) {
          continue
        }
        offenders.push(`${name}: \`${token}\``)
      }
    }
    expect(offenders).toEqual([])
  })
})
