/** What the Claude Code plugin scenarios (`scenarios-cc-*.mjs`) share beyond scenario-helpers.mjs. */
import assert from 'node:assert/strict'

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll until `check()` is truthy (bounded), returning its value. */
export async function until(check, what, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    assert.ok(Date.now() < deadline, `timed out waiting until ${what}`)
    await sleep(200)
  }
}

/** Write `{ relative path: text }` under `dir`, creating folders as needed. */
export function writeTree(dir, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), text)
  }
}

/** The JSON lines a hook or server appended to `file`, oldest first; none when it is missing. */
export const jsonLines = (file) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : []

/** A Markdown file with frontmatter (a skill, command or agent): frontmatter lines, then the body. */
export const md = (front, body) => `---\n${front.join('\n')}\n---\n\n${body}\n`

/** A scripted bash call. */
export const bash = (command) => ({ tool: 'bash', args: { command } })
