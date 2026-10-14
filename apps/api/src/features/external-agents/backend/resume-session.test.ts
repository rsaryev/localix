import { expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProviderId } from '../shared/identity'
import type { SessionSummary } from '../shared/contracts'
import { resumeSession } from './resume-session'

const summary = (provider: ProviderId, nativeSessionId = 'session-123'): SessionSummary => ({
  key: `${provider}:${nativeSessionId}`,
  provider,
  nativeSessionId,
  title: 'Foreign session',
  updatedAt: 0,
  sourcePath: '/fixture/history',
})

test('resumes the specific session only for adapters with native continuation', () => {
  expect(resumeSession(summary('claude-code'))).toEqual({
    providerName: 'Claude Code',
    command: "claude --resume 'session-123'",
  })
  expect(resumeSession(summary('codex'))).toEqual({
    providerName: 'Codex',
    command: "codex resume 'session-123'",
  })
  expect(resumeSession(summary('opencode'))).toEqual({
    providerName: 'opencode',
    command: "opencode --session 'session-123'",
  })
  expect(resumeSession(summary('gemini-cli'))).toEqual({
    providerName: 'Gemini CLI',
    command: "gemini --resume 'session-123'",
  })
  expect(resumeSession(summary('github-copilot'))).toEqual({
    providerName: 'GitHub Copilot',
    command: "copilot --resume='session-123'",
  })
  expect(resumeSession(summary('hermes'))).toEqual({
    providerName: 'Hermes',
    command: "hermes --resume 'session-123'",
  })
  expect(resumeSession(summary('codex', ''))).toBeUndefined()
})

test('runs in the source directory and treats a foreign id as one literal shell argument', () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "agent's workspace-")))
  const id = "foreign'; printf INJECTED; # $(printf expanded)"
  try {
    const resume = resumeSession({ ...summary('claude-code', id), cwd })!
    // A fake CLI prints its working directory and arguments; no installed agent is launched.
    const child = Bun.spawnSync(
      ['/bin/sh', '-c', `claude() { printf '%s\\n' "$PWD" "$@"; }; ${resume.command}`],
      { timeout: 1000, killSignal: 'SIGKILL' },
    )
    expect(child.exitCode).toBe(0)
    expect(child.stdout.toString().trim().split('\n')).toEqual([cwd, '--resume', id])
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
