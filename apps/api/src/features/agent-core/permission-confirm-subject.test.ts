import { describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import path from 'node:path'

import { confirmSubject } from './permission-confirm-subject'
import type { CallFacts } from './permission-facts'

const facts = (over: Partial<CallFacts>): CallFacts => ({
  paths: [],
  outsidePaths: [],
  outsideWorkspace: false,
  insideWorkspace: false,
  dangerous: false,
  catastrophic: false,
  readOnly: false,
  touchesSecret: false,
  ...over,
})

// Under the real home, since the walk is bounded by it: nothing at or above `~` is offered.
const file = path.join(homedir(), 'code', 'other', 'src', 'hooks', 'useTheme.ts')

describe('what a card shows and how far it may reach', () => {
  test('a file read outside the workspace is a PATH, widened by folder', () => {
    // The card that prompted this showed the path and offered "Always for useTheme.ts
    // commands": the displayed string had been parsed as a shell line.
    const shown = confirmSubject(facts({ paths: [file], outsidePaths: [file] }), 'read')
    expect(shown).toMatchObject({ subject: 'path', command: file, targets: [file] })
    expect(shown.grants.map((g) => g.label).slice(0, 3)).toEqual(['useTheme.ts', 'hooks', 'src'])
    expect(shown.grants.every((g) => g.rule)).toBe(true)
  })

  test('a shell line is a COMMAND, widened by program', () => {
    const shown = confirmSubject(facts({ command: 'git push', commands: ['git push'] }), 'bash')
    expect(shown.subject).toBe('command')
    expect(shown.grants.map((g) => g.scope)).toEqual(['bash(git)'])
  })

  test('a redacted terminal input can be approved once and never remembered', () => {
    const shown = confirmSubject(
      facts({ command: 'interactive terminal type', commandRedacted: true }),
      'bash',
    )
    expect(shown.grants).toEqual([])
  })

  test('a rule that would not allow this very call is withheld, the session grant kept', () => {
    // A call can also name the directory it runs in, which a folder rule does not cover — so
    // "Always" would write a row that asks again on the next call. The session grant matches
    // only what the card showed, and still works.
    const cwd = path.join(homedir(), 'workspace')
    const shown = confirmSubject(facts({ paths: [file, cwd], outsidePaths: [file] }), 'edit')
    const folder = shown.grants.find((g) => g.label === 'src')
    expect(folder?.scope).toBe(`edit(${path.dirname(path.dirname(file))}${path.sep}*)`)
    expect(folder?.rule).toBeUndefined()
  })

  test('a call that names nothing shows the tool and offers it for the session only', () => {
    const shown = confirmSubject(facts({}), 'agents')
    expect(shown).toMatchObject({ subject: 'resource', command: 'agents', targets: [] })
    expect(shown.grants).toMatchObject([{ scope: 'agents', kind: 'tool' }])
    expect(shown.grants[0]?.rule).toBeUndefined()
  })
})
