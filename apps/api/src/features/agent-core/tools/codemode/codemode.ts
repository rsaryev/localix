import { z } from 'zod'
import { zodToJsonSchema, type ImageContent, type TextContent } from '@localixai/agent'
import { defineAgentTool, type AgentTool, type CallClass } from '@localixai/agent/agents'
import type { ScriptRunResult, ScriptSandbox, ScriptTool } from '@localixai/agent/runtime'

import { TOOL } from '../../tool-names'
import { createCallRecord, type CodemodeDetails } from './call-record'

/** The tools a script calls: pi's default coding tools, as many of them as this run has. */
export const SCRIPT_TOOL_NAMES: readonly string[] = [TOOL.read, TOOL.bash, TOOL.edit, TOOL.write]

/** As in pi's codemode example: a script that runs longer than this is stopped. */
const TIMEOUT_MS = 120_000

/** The script itself reads nothing; each call it makes is judged on its own at the gate. */
const CODEMODE_CLASS: CallClass = { effect: 'read' }

const inputSchema = z.object({
  code: z.string().describe('JavaScript source. Top-level await and return work.'),
})

/**
 * `codemode`, as pi's codemode example builds it (github.com/earendil-works/pi, `mcp-codemode`):
 * the model writes JavaScript, and the script calls `tools.<name>(args)` for the run's `read`,
 * `bash`, `edit` and `write`. Only the script's output and return value reach the model, not the
 * results of the calls.
 *
 * The description declares the tools as TypeScript; `tools` are this run's live tools, so a tool
 * the run does not have is never declared. Every call goes through `context.callTool` — the
 * runtime's nested-call path — so validation, the permission gate and the hooks apply to it exactly
 * as to a call the model makes.
 */
export function createCodemodeTool(scripts: ScriptSandbox, tools: readonly AgentTool[]) {
  const callable = tools.filter((tool) => SCRIPT_TOOL_NAMES.includes(tool.name))
  const declared = callable.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.inputSchema),
  }))
  return defineAgentTool<z.infer<typeof inputSchema>, CodemodeDetails>({
    name: TOOL.codemode,
    label: 'Codemode',
    activeVerb: 'Running a script',
    description: [
      'Run JavaScript that calls other tools, to chain calls, run them in parallel, or filter large results.',
      'The code is the body of an async function. There is no Node, file system, network, or timers.',
      "Call tools as `await tools.<name>(args)`: a call resolves to the tool's text and rejects with its error.",
      'Output with `text(value)` or `console.log()`, or `return` a value. Only the output and the return value reach you, not the results of the tool calls.',
      'Use everything JavaScript offers to turn the results into a concise, meaningful answer, and make the script fault-tolerant.',
      '',
      '```ts',
      scripts.declare(declared),
      '```',
    ].join('\n'),
    inputSchema,
    mutates: false,
    classify: () => CODEMODE_CLASS,
    // Its calls are not declared up front, so it does not share a turn's parallel slot.
    executionMode: 'sequential',
    async execute(_toolCallId, input, signal, _onUpdate, context) {
      if (!context?.callTool) {
        return { content: 'This run cannot make nested tool calls.', isError: true }
      }
      const record = createCallRecord()
      const scriptTools: ScriptTool[] = declared.map((tool) => ({
        ...tool,
        execute: async (args, callSignal) => {
          const end = record.start(tool.name, args)
          const outcome = await context.callTool!(tool.name, args, callSignal)
          if (outcome.isError) {
            const error = outcome.result.content || `Tool ${tool.name} failed`
            end({ error })
            throw new Error(error)
          }
          end({})
          return outcome.result.content
        },
      }))
      const run = await scripts.run({
        code: input.code,
        tools: scriptTools,
        timeoutMs: TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      })
      return scriptResult(run, record.snapshot())
    },
  })
}

const MODEL_IMAGE_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** The output items in order, then the return value, then the failure — as pi's example returns. */
function scriptResult(run: ScriptRunResult, details: CodemodeDetails) {
  const parts: (TextContent | ImageContent)[] = []
  for (const item of run.output) {
    if (item.type === 'text') parts.push({ type: 'text', text: item.text })
    else if (MODEL_IMAGE_TYPES.has(item.mimeType))
      parts.push({
        type: 'image',
        mediaType: item.mimeType as ImageContent['mediaType'],
        data: item.data,
      })
  }
  if (run.ok && run.value !== undefined) {
    const value = typeof run.value === 'string' ? run.value : JSON.stringify(run.value)
    parts.push({ type: 'text', text: value })
  }
  if (!run.ok) {
    parts.push({ type: 'text', text: `Script failed: ${run.error.stack ?? run.error.message}` })
  }
  const content = parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
  return {
    content,
    ...(parts.some((part) => part.type === 'image') ? { contentParts: parts } : {}),
    details,
    ...(run.ok ? {} : { isError: true }),
  }
}
