import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { HYPERFRAMES_VERSION, type MotionJob } from '../shared/contract'
import { announceWrite } from './writes'

/**
 * HyperFrames CLI runs (snapshot, render, lint, check), one at a time per project.
 *
 * The CLI needs Node ≥ 22 and FFmpeg on the login PATH (the host repairs `process.env` from the
 * login shell at startup) and downloads Chrome on first use. Jobs live in this process: a
 * restarted backend forgets them, and the files they wrote remain.
 */
interface Running {
  job: MotionJob
  child: ReturnType<typeof Bun.spawn> | null
  output: string[]
}
const jobs = new Map<string, Running>()
const TIMEOUTS = { render: 45 * 60_000, snapshot: 8 * 60_000, check: 5 * 60_000 } as const
// Built from a string so the escape byte is not a literal control character in the source.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, 'gu')

export const jobFor = (folder: string): MotionJob | null => jobs.get(folder)?.job ?? null

const env = () => ({
  ...process.env,
  HYPERFRAMES_NO_TELEMETRY: '1',
  DO_NOT_TRACK: '1',
  CI: '1',
  NO_COLOR: '1',
})

/**
 * npx must not start inside the film folder: a workspace that is itself an npm project (with
 * overrides, workspaces or a lockfile up the tree) makes `npm exec` fail before HyperFrames runs
 * (EOVERRIDE). The CLI runs from a neutral directory and gets the film as an absolute path.
 */
const NEUTRAL = join(tmpdir(), 'localix-motion-cli')
export function cliArgs(folder: string, args: string[]) {
  const [command, ...rest] = args
  const positional = rest[0] === '.' ? rest.slice(1) : rest
  const out = positional.map((value, index) =>
    positional[index - 1] === '--output' && !isAbsolute(value) ? join(folder, value) : value,
  )
  return [command!, folder, ...out]
}

/** Run the pinned CLI and collect its output. Resolves when it exits. */
async function run(
  folder: string,
  kind: MotionJob['kind'],
  args: string[],
  onLine?: (line: string) => void,
): Promise<{ code: number; output: string }> {
  mkdirSync(NEUTRAL, { recursive: true })
  const child = Bun.spawn(
    ['npx', '--yes', `hyperframes@${HYPERFRAMES_VERSION}`, ...cliArgs(folder, args)],
    {
      cwd: NEUTRAL,
      env: env(),
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    },
  )
  const entry = jobs.get(folder)
  if (entry) entry.child = child
  const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUTS[kind])
  const lines: string[] = []
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true })
      const parts = buffer.split(/\r|\n/u)
      buffer = parts.pop() ?? ''
      for (const raw of parts) {
        const line = raw.replace(ANSI, '').trim()
        if (!line) continue
        lines.push(line)
        if (lines.length > 400) lines.shift()
        onLine?.(line)
      }
    }
  }
  await Promise.all([
    pump(child.stdout as ReadableStream<Uint8Array>),
    pump(child.stderr as ReadableStream<Uint8Array>),
  ])
  const code = await child.exited
  clearTimeout(timer)
  return { code, output: lines.join('\n') }
}

/** Start a background job; refuses while another job runs for the same project. */
export function startJob(folder: string, kind: MotionJob['kind'], args: string[]) {
  if (jobs.get(folder)?.job.state === 'running')
    throw new Error('Another render or snapshot is running for this film. Cancel it first.')
  const entry: Running = {
    job: {
      kind,
      state: 'running',
      progress: null,
      message: 'Starting HyperFrames…',
      startedAt: new Date().toISOString(),
      finishedAt: null,
    },
    child: null,
    output: [],
  }
  jobs.set(folder, entry)
  announceWrite(folder)
  let last = 0
  const done = run(folder, kind, args, (line) => {
    entry.output.push(line)
    const percent = line.match(/(\d{1,3}(?:\.\d+)?)\s?%/u)
    if (percent) entry.job.progress = Math.min(100, Number(percent[1]))
    if (!/^[│◇◆─\s]*$/u.test(line)) entry.job.message = line.slice(0, 300)
    // Nudge the view at most a few times a second.
    if (Date.now() - last > 400) {
      last = Date.now()
      announceWrite(folder)
    }
  })
    .then(({ code, output }) => {
      entry.job.state = code === 0 ? 'done' : 'failed'
      entry.job.progress = code === 0 ? 100 : entry.job.progress
      if (code !== 0) entry.job.message = failureOf(output, code)
      else if (kind === 'render') entry.job.message = 'Render finished.'
      return { code, output }
    })
    .catch((error: unknown) => {
      entry.job.state = 'failed'
      entry.job.message = error instanceof Error ? error.message : 'HyperFrames could not start.'
      return { code: 1, output: entry.job.message }
    })
    .finally(() => {
      entry.job.finishedAt = new Date().toISOString()
      entry.child = null
      announceWrite(folder)
    })
  return { job: entry.job, done }
}

export function cancelJob(folder: string) {
  const entry = jobs.get(folder)
  if (entry?.job.state !== 'running') return false
  entry.child?.kill('SIGKILL')
  entry.job.message = 'Cancelled.'
  return true
}

function failureOf(output: string, code: number) {
  if (/command not found|ENOENT.*npx|No such file.*npx/iu.test(output))
    return 'Node.js is not on PATH. Install Node 22+ and restart Localix.'
  if (/ffmpeg/iu.test(output) && /not found|missing|ENOENT/iu.test(output))
    return 'FFmpeg is missing. Install it (e.g. brew install ffmpeg) and try again.'
  const errors = output.split('\n').filter((line) => /error|✗|failed/iu.test(line))
  return (errors.at(-1) ?? output.split('\n').at(-1) ?? `HyperFrames exited with ${code}.`).slice(
    0,
    400,
  )
}

/** Run a CLI command to completion (lint/check for the agent), with a job entry while it runs. */
export async function runToEnd(folder: string, kind: MotionJob['kind'], args: string[]) {
  const { done } = startJob(folder, kind, args)
  return done
}

let tooling: { node: string | null; ffmpeg: boolean; at: number } | null = null
const probe = async (cmd: string[]) => {
  try {
    const child = Bun.spawn(cmd, { env: env(), stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    const text = await new Response(child.stdout as ReadableStream).text()
    const code = await child.exited
    clearTimeout(timer)
    return code === 0 ? text.trim() : null
  } catch {
    return null
  }
}
/** Node (≥ 22) and FFmpeg availability, cached for a minute. */
export async function detectTooling() {
  if (tooling && Date.now() - tooling.at < 60_000)
    return { node: tooling.node, ffmpeg: tooling.ffmpeg }
  const [node, ffmpeg] = await Promise.all([
    probe(['node', '--version']),
    probe(['ffmpeg', '-version']),
  ])
  const major = Number(node?.match(/^v(\d+)/u)?.[1] ?? 0)
  tooling = { node: major >= 22 ? node : null, ffmpeg: ffmpeg !== null, at: Date.now() }
  return { node: tooling.node, ffmpeg: tooling.ffmpeg }
}
