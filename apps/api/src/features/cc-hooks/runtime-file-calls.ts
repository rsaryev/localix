/**
 * A Localix `edit`, `write` or `read` may name several files in one call; Claude Code's `Edit`,
 * `Write` and `Read` name one, and a hook reads `tool_input.file_path` (hooks.md, "PreToolUse
 * input"). So the tool hooks run once per file, each part a one-file call of its own: a deny of
 * any file refuses the call, an allow approves it only when every file is allowed, and each part's
 * rewrite lands on its own entry.
 */
import type { CcHookToolRef, CcHooksRuntime, PreToolUseResult } from './runtime-contracts'
import { joinContext } from './runtime-results'

type Fields = Record<string, unknown>
type ToolRunners = Pick<
  CcHooksRuntime,
  'runPreToolUse' | 'runPostToolUse' | 'runPostToolUseFailure'
>

/** The list each file tool names its files in. */
const LIST_KEY: Record<string, string> = { edit: 'edits', write: 'files', read: 'reads' }

const isRecord = (value: unknown): value is Fields =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const toolName = (tool: CcHookToolRef) => (typeof tool === 'string' ? tool : tool.name)

/** One call per file, and the way back to one call; undefined for a call of one file. */
export function fileCallParts(
  tool: string,
  input: unknown,
): { parts: Fields[]; join(parts: readonly unknown[]): Fields } | undefined {
  const key = LIST_KEY[tool]
  if (!key || !isRecord(input)) return undefined
  const list = input[key]
  if (!Array.isArray(list) || list.length < 2) return undefined
  return {
    parts: list.map((entry) => ({ ...input, [key]: [entry] })),
    join: (parts) => ({
      ...input,
      [key]: parts.map((part, i) => {
        const entries = isRecord(part) ? part[key] : undefined
        return Array.isArray(entries) && entries.length === 1 ? entries[0] : list[i]
      }),
    }),
  }
}

/** Fold the parts' PreToolUse results into the call's. */
async function preToolUseByFile(
  run: ToolRunners['runPreToolUse'],
  tool: CcHookToolRef,
  split: NonNullable<ReturnType<typeof fileCallParts>>,
  toolUseId?: string,
): Promise<PreToolUseResult> {
  const contexts: (string | undefined)[] = []
  const inputs: unknown[] = []
  let didRewrite = false
  let allowed = 0
  let ask: PreToolUseResult | undefined
  let allowReason: string | undefined
  for (const part of split.parts) {
    const result = await run(tool, part, toolUseId)
    contexts.push(result.additionalContext)
    const additionalContext = joinContext(contexts)
    if (result.stop || result.decision === 'deny')
      return { ...result, didRewrite: false, ...(additionalContext ? { additionalContext } : {}) }
    didRewrite ||= result.didRewrite
    inputs.push(result.didRewrite && result.updatedInput !== undefined ? result.updatedInput : part)
    if (result.decision === 'ask') ask ??= result
    if (result.decision === 'allow') {
      allowed += 1
      allowReason ??= result.reason
    }
  }
  const additionalContext = joinContext(contexts)
  const decision = ask ? 'ask' : allowed === split.parts.length ? 'allow' : 'proceed'
  const reason = ask ? ask.reason : decision === 'allow' ? allowReason : undefined
  return {
    decision,
    ...(reason ? { reason } : {}),
    didRewrite,
    ...(didRewrite ? { updatedInput: split.join(inputs) } : {}),
    ...(additionalContext ? { additionalContext } : {}),
  }
}

/** The tool runners, each running a several-file call's hooks once per file. */
export function byFile(runners: ToolRunners): ToolRunners {
  return {
    runPreToolUse(tool, input, toolUseId) {
      const split = fileCallParts(toolName(tool), input)
      return split
        ? preToolUseByFile(runners.runPreToolUse, tool, split, toolUseId)
        : runners.runPreToolUse(tool, input, toolUseId)
    },
    async runPostToolUse(tool, input, result, toolUseId) {
      const split = fileCallParts(toolName(tool), input)
      if (!split) return runners.runPostToolUse(tool, input, result, toolUseId)
      const contexts: (string | undefined)[] = []
      // A part's replacement stands for the whole result: a redacting hook redacts every file.
      let updatedToolOutput: string | undefined
      for (const part of split.parts) {
        const content = updatedToolOutput ?? result.content
        const post = await runners.runPostToolUse(tool, part, { ...result, content }, toolUseId)
        contexts.push(post.additionalContext)
        updatedToolOutput = post.updatedToolOutput ?? updatedToolOutput
      }
      const additionalContext = joinContext(contexts)
      return {
        ...(additionalContext ? { additionalContext } : {}),
        ...(updatedToolOutput !== undefined ? { updatedToolOutput } : {}),
      }
    },
    async runPostToolUseFailure(tool, input, failure) {
      const split = fileCallParts(toolName(tool), input)
      if (!split) return runners.runPostToolUseFailure(tool, input, failure)
      const contexts: (string | undefined)[] = []
      for (const part of split.parts)
        contexts.push((await runners.runPostToolUseFailure(tool, part, failure)).additionalContext)
      const additionalContext = joinContext(contexts)
      return additionalContext ? { additionalContext } : {}
    },
  }
}
