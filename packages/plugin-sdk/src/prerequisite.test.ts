import { describe, expect, test } from 'bun:test'

import {
  isMissingExecutable,
  parsePrerequisite,
  prerequisiteActionLabel,
  prerequisiteHint,
  prerequisiteTitle,
  type Prerequisite,
} from './prerequisite'

const docker = (state: Prerequisite['state'], extra: Partial<Prerequisite> = {}): Prerequisite => ({
  id: 'docker',
  name: 'Docker',
  state,
  installUrl: 'https://docs.docker.com/get-docker/',
  command: 'open -a Docker',
  ...extra,
})

describe('isMissingExecutable', () => {
  // The shipped defect: the packaged app's spawn threw Bun's wording, no classifier knew it, and
  // the DevOps sidebar said "Docker returned an error." instead of "Docker is not installed".
  test("recognises Bun's spawn failure by its text", () => {
    expect(isMissingExecutable(new Error('Executable not found in $PATH: "docker"'))).toBe(true)
  })

  test('recognises it by its code, which a message-only classifier never saw', () => {
    const err = Object.assign(new Error('boom'), { code: 'ENOENT', syscall: 'spawn docker' })
    expect(isMissingExecutable(err)).toBe(true)
  })

  test("Node's and a shell's wording", () => {
    expect(isMissingExecutable(new Error('spawn git ENOENT'))).toBe(true)
    expect(isMissingExecutable('zsh: command not found: kubectl')).toBe(true)
  })

  test('a missing FILE is not a missing program', () => {
    const err = Object.assign(new Error("ENOENT: no such file or directory, open '/x'"), {
      code: 'ENOENT',
      syscall: 'open',
    })
    expect(isMissingExecutable(err)).toBe(false)
    // A dead docker socket ends in "no such file or directory" too — it is a stopped engine.
    expect(
      isMissingExecutable(
        new Error(
          'dial unix /Users/me/.docker/run/docker.sock: connect: no such file or directory',
        ),
      ),
    ).toBe(false)
  })
})

describe('wording', () => {
  test('each state says what is wrong and what to do', () => {
    expect(prerequisiteTitle(docker('missing'))).toBe('Docker is not installed')
    expect(prerequisiteTitle(docker('stopped'))).toBe('Docker is not running')
    expect(prerequisiteTitle(docker('signed-out'))).toBe('Not signed in to Docker')
    expect(prerequisiteHint(docker('stopped'))).toContain('`open -a Docker`')
  })

  test('the action exists only when there is something to act with', () => {
    expect(prerequisiteActionLabel(docker('missing'))).toBe('Install Docker')
    expect(prerequisiteActionLabel(docker('stopped'))).toBe('Start Docker')
    expect(prerequisiteActionLabel(docker('missing', { installUrl: undefined }))).toBeNull()
    expect(prerequisiteActionLabel(docker('stopped', { command: undefined }))).toBeNull()
  })
})

describe('parsePrerequisite', () => {
  test('round-trips the wire shape', () => {
    expect(parsePrerequisite(JSON.parse(JSON.stringify(docker('stopped'))))).toEqual(
      docker('stopped'),
    )
  })

  test('untrusted JSON degrades to null, never to a half-built button', () => {
    expect(parsePrerequisite(null)).toBeNull()
    expect(parsePrerequisite({ id: 'docker', name: 'Docker', state: 'exploded' })).toBeNull()
    expect(parsePrerequisite({ name: 'Docker', state: 'missing' })).toBeNull()
  })

  test('only an https install link survives', () => {
    const parsed = parsePrerequisite({ ...docker('missing'), installUrl: 'javascript:alert(1)' })
    expect(parsed?.installUrl).toBeUndefined()
  })
})
