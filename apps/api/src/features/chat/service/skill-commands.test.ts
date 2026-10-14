import { describe, it, expect } from 'bun:test'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  expandSkillContent,
  SKILL_CMD_MAX_COUNT,
  SKILL_CMD_TOTAL_MAX_BYTES,
} from './skill-commands'

const cwd = tmpdir()

describe('expandSkillContent', () => {
  it('returns content unchanged when no !cmd patterns are present', async () => {
    const content = 'Review the code.\n\nCheck for bugs.'
    expect(await expandSkillContent(content, cwd)).toBe(content)
  })

  it('expands an inline !cmd to its stdout output', async () => {
    const content = 'Date: !`echo hello`'
    const result = await expandSkillContent(content, cwd)
    expect(result).toBe('Date: hello')
  })

  it('expands a fenced !cmd block', async () => {
    const content = '## Context\n```!\necho world\n```\n\nDo the task.'
    const result = await expandSkillContent(content, cwd)
    expect(result).toContain('world')
    expect(result).not.toContain('```!')
  })

  it('expands multiple inline commands', async () => {
    const content = 'A: !`echo one`\nB: !`echo two`'
    const result = await expandSkillContent(content, cwd)
    expect(result).toBe('A: one\nB: two')
  })

  it('inline form only triggers when ! follows start-of-line or whitespace', async () => {
    // KEY=!`cmd` should NOT be expanded (! follows `=`)
    const content = 'KEY=!`echo nope`'
    const result = await expandSkillContent(content, cwd)
    expect(result).toBe(content) // unchanged
  })

  it('inserts [Error:...] for a failing command', async () => {
    const content = 'Result: !`exit 1`'
    const result = await expandSkillContent(content, cwd)
    expect(result).toContain('[Error:')
  })

  it('injects env vars so !cmd scripts can read CLAUDE_SESSION_ID', async () => {
    const content = 'Session: !`echo $CLAUDE_SESSION_ID`'
    const result = await expandSkillContent(content, cwd, {
      CLAUDE_SESSION_ID: 'test-session-123',
    })
    expect(result).toBe('Session: test-session-123')
  })

  it('shares one command-count budget across inline and fenced embeds', async () => {
    const commands = [
      '```!\nprintf fenced\n```',
      ...Array.from({ length: SKILL_CMD_MAX_COUNT + 1 }, (_, i) => `!\`printf ${i}\``),
    ].join('\n')
    const result = await expandSkillContent(commands, cwd)

    expect(result).toContain('fenced')
    expect(result.match(/command budget reached/g)?.length).toBe(1)
    expect(result).not.toContain(`printf ${SKILL_CMD_MAX_COUNT}`)
  })

  it('handles tens of thousands of embeds with bounded planning and overflow output', async () => {
    const embedCount = 30_000
    const fixture = await mkdtemp(join(tmpdir(), 'skill-embed-stress-'))
    const overflowMarker = join(fixture, 'overflow-command-ran')
    try {
      const enabled = Array.from({ length: embedCount }, (_, index) =>
        index < SKILL_CMD_MAX_COUNT ? '!`printf RUN_OK`' : '!`:>"$M"`',
      ).join('\n')

      const expanded = await expandSkillContent(enabled, cwd, { M: overflowMarker })
      expect(expanded.match(/RUN_OK/g)?.length).toBe(SKILL_CMD_MAX_COUNT)
      expect(expanded.match(/command budget reached/g)?.length).toBe(1)
      expect(expanded.length).toBeLessThan(embedCount * 2 + 2_000)
      // Every overflow command would create this file. Its absence proves the
      // scan did not merely discard results after spawning beyond the limit.
      expect(access(overflowMarker)).rejects.toThrow()
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })

  it('caps aggregate shell output independent of concurrent completion order', async () => {
    const command = "!`printf '%070000d' 0`"
    const result = await expandSkillContent(command, cwd)

    // The per-command cap fires before the larger aggregate cap, and the error
    // remains compact rather than inserting the authored 70 KB output.
    expect(result).toContain('command output exceeded')
    expect(result.length).toBeLessThan(200)

    const chunks = Array.from({ length: 3 }, () => "!`printf '%030000d' 0`").join('\n')
    const aggregate = await expandSkillContent(chunks, cwd)
    expect(aggregate).toContain('aggregate budget reached')
    expect(Buffer.byteLength(aggregate)).toBeLessThan(SKILL_CMD_TOTAL_MAX_BYTES + 200)
  })

  it('does not split multibyte command output at the aggregate byte cap', async () => {
    const cjk = Array.from(
      { length: 3 },
      () => "!`printf '%s' \"$(printf '界%.0s' $(seq 1 10000))\"`",
    ).join('\n')
    const result = await expandSkillContent(cjk, cwd)

    expect(result).not.toContain('�')
    expect(Buffer.byteLength(result)).toBeLessThan(SKILL_CMD_TOTAL_MAX_BYTES + 200)
  })

  it('reaps background processes left by a preprocessing command', async () => {
    if (process.platform === 'win32') return
    const result = await expandSkillContent('!`sleep 30 & echo $!`', cwd)
    const pid = Number(result.trim())
    expect(Number.isInteger(pid)).toBe(true)

    let alive = true
    for (let attempt = 0; attempt < 20 && alive; attempt++) {
      await Bun.sleep(25)
      try {
        process.kill(pid, 0)
      } catch {
        alive = false
      }
    }
    if (alive) {
      // Test cleanup before asserting — never leak the fixture process into the suite.
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
    expect(alive).toBe(false)
  })
})
