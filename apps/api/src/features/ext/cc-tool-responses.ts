/**
 * A Localix tool's result in Claude Code's result shape, as a PostToolUse hook reads it in
 * `tool_response` (hooks.md: "The exact schema for both depends on the tool"; the mod types'
 * `BuiltinToolResults`). Built from what the tool reports (`details`) and the call's input.
 * Fields Localix does not know are left out or answered conservatively (`originalFile: null`,
 * as Claude Code itself does for a file too large to include). A tool or a call with no
 * Claude Code counterpart (several files in one call) keeps Localix's `{content, details}`.
 */
import { parsePatch } from 'diff'

import { absolutePath, baseOf, isRecord, num, only, str, type Fields } from './cc-tool-fields'
import { planText } from './cc-tool-inputs-agentic'

interface ToolResult {
  content: string
  details?: unknown
}

type Shaper = (result: ToolResult, details: Fields, input: Fields, cwd?: string) => unknown

/** A unified diff as Claude Code's `structuredPatch` hunks. */
function structuredPatch(diff: unknown) {
  if (typeof diff !== 'string' || !diff) return []
  try {
    return parsePatch(diff).flatMap((file) =>
      file.hunks.map((hunk) => ({
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines: hunk.lines,
      })),
    )
  } catch {
    return []
  }
}

const lineCount = (text: string) => (text ? text.replace(/\n$/, '').split('\n').length : 0)

/** The one file a batched file tool reported, made absolute against the call's directory. */
function oneFile(details: Fields, input: Fields, cwd?: string) {
  const file = only(details.files)
  if (!file || file.failed) return undefined
  const base = str(details.cwd) ?? baseOf(input, cwd)
  return { file, filePath: absolutePath(file.path, base) }
}

/** The job a backgrounded command became, as its result names it (`job_id: <id>`). */
const jobIdOf = (content: string) => /job_id(?::\s*|=")([\w.-]+)/.exec(content)?.[1]

const bash: Shaper = (result, details, input) => {
  const jobId = details.isBackground === true ? jobIdOf(result.content) : undefined
  const timeout = num(input.timeout)
  return {
    // The bash tool keeps the two streams apart when the command wrote to stderr.
    stdout:
      typeof details.stdout === 'string'
        ? details.stdout
        : typeof details.output === 'string'
          ? details.output
          : result.content,
    stderr: typeof details.stderr === 'string' ? details.stderr : '',
    // A command a signal stopped (exit code 128 + the signal) was interrupted.
    interrupted: details.jobStatus === 'killed' || (num(details.exitCode) ?? 0) > 128,
    isImage: false,
    ...(jobId ? { backgroundTaskId: jobId } : {}),
    ...(details.background === 'promoted' ? { timedOutAfterMs: (timeout ?? 60) * 1000 } : {}),
  }
}

const read: Shaper = (_result, details, input, cwd) => {
  const item = Array.isArray(details.items) ? only(details.items) : details
  if (!item || typeof item.path !== 'string') return undefined
  const filePath = absolutePath(item.path, baseOf(input, cwd))
  if (item.kind === 'image')
    return {
      type: 'image',
      file: {
        type: item.mediaType,
        originalSize: item.bytes,
        dimensions: { originalWidth: item.width, originalHeight: item.height },
      },
    }
  const content = str(item.output) ?? ''
  const numLines = lineCount(content)
  const startLine = num(input.start_line) ?? num(only(input.reads)?.start_line) ?? 1
  return {
    type: 'text',
    file: { filePath, content, numLines, startLine, totalLines: startLine - 1 + numLines },
  }
}

const edit: Shaper = (_result, details, input, cwd) => {
  const one = oneFile(details, input, cwd)
  const edits = Array.isArray(input.edits) ? input.edits.filter(isRecord) : []
  if (!one || edits.length === 0) return undefined
  const patch = structuredPatch(one.file.diff)
  if (edits.length > 1)
    return { filePath: one.filePath, edits, originalFile: null, structuredPatch: patch }
  return {
    filePath: one.filePath,
    oldString: edits[0]!.old_string,
    newString: edits[0]!.new_string,
    originalFile: null,
    structuredPatch: patch,
    userModified: false,
    replaceAll: edits[0]!.replace_all === true,
  }
}

const write: Shaper = (_result, details, input, cwd) => {
  const one = oneFile(details, input, cwd)
  const entry = only(input.files)
  if (!one || !entry) return undefined
  return {
    type: one.file.created === true ? 'create' : 'update',
    filePath: one.filePath,
    content: entry.content,
    structuredPatch: structuredPatch(one.file.diff),
    originalFile: null,
    // The person did not change the content before it was written (Claude Code's own record).
    userModified: false,
  }
}

const search: Shaper = (result, details, input) => {
  const output = str(details.output) ?? result.content
  const lines = output.split('\n').filter(Boolean)
  if (input.query === undefined && input.queries === undefined && input.glob !== undefined)
    return {
      filenames: lines,
      numFiles: lines.length,
      truncated: details.truncated === true,
      durationMs: 0,
    }
  const filenames = [...new Set(lines.map((line) => line.split(':')[0]!).filter(Boolean))]
  return {
    mode: 'content',
    numFiles: filenames.length,
    filenames,
    content: output,
    numLines: lines.length,
  }
}

const research: Shaper = (result, _details, input) => {
  const urls = Array.isArray(input.urls) ? input.urls : []
  if (urls.length > 0 && input.queries === undefined)
    return {
      url: urls[0],
      result: result.content,
      bytes: Buffer.byteLength(result.content),
      code: 200,
      codeText: 'OK',
      durationMs: 0,
    }
  return { query: input.question, results: [result.content], durationSeconds: 0 }
}

const ask: Shaper = (_result, details, input) => {
  const questions = Array.isArray(input.questions) ? input.questions.filter(isRecord) : []
  const answers: Record<string, string> = {}
  for (const answer of Array.isArray(details.answers) ? details.answers.filter(isRecord) : []) {
    const question = questions.find((q) => q.id === answer.id)
    const chosen = Array.isArray(answer.selectedOptions) ? answer.selectedOptions.join(', ') : ''
    answers[str(question?.question) ?? String(answer.id)] = str(answer.customInput) ?? chosen
  }
  return {
    questions: questions.map((q) => ({ ...q, header: q.header ?? q.id, multiSelect: !!q.multi })),
    answers,
  }
}

const skill: Shaper = (_result, _details, input) =>
  input.action === 'get' ? { success: true, commandName: input.name } : undefined

/** `Agent`'s result as Claude Code's: its reply when the call waited, else its launch. */
const agent: Shaper = (result, details, input) => {
  const task = Array.isArray(details.tasks) ? details.tasks.find(isRecord) : undefined
  const done =
    task?.status === 'completed' || task?.status === 'done' || input.run_in_background === false
  const id = str(task?.sessionId) ?? ''
  return done
    ? {
        status: 'completed',
        agentId: id,
        content: [{ type: 'text', text: result.content }],
        prompt: input.prompt,
      }
    : {
        status: 'async_launched',
        agentId: id,
        description: input.description,
        prompt: input.prompt,
      }
}

const plan: Shaper = (_result, _details, input) => {
  if (input.action !== 'present') return undefined
  return { plan: planText(input) ?? '', isAgent: false }
}

const SHAPERS: Record<string, Shaper> = {
  Plan: plan,
  Bash: bash,
  Read: read,
  Edit: edit,
  Write: write,
  Search: search,
  Research: research,
  AskUserQuestion: ask,
  Skill: skill,
  Agent: agent,
}

/** The result in Claude Code's shape, or undefined when this tool or call has none. */
export function claudeCodeResult(
  tool: string,
  result: ToolResult,
  input: unknown,
  cwd?: string,
): unknown {
  // An MCP tool's result is its content blocks (`updatedMCPToolOutput` takes the same shape).
  if (tool.startsWith('mcp_')) return [{ type: 'text', text: result.content }]
  const shaper = SHAPERS[tool]
  if (!shaper) return undefined
  const details = isRecord(result.details) ? result.details : {}
  return shaper(result, details, isRecord(input) ? input : {}, cwd)
}
