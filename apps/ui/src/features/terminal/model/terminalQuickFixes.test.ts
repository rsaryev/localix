import { describe, expect, it } from 'bun:test'
import { computeQuickFixes } from './terminalQuickFixes'

describe('computeQuickFixes', () => {
  it('offers set-upstream from git push output', () => {
    const fixes = computeQuickFixes({
      command: 'git push',
      output: [
        'fatal: The current branch feat/x has no upstream branch.',
        'To push the current branch and set the remote as upstream, use',
        '',
        '    git push --set-upstream origin feat/x',
        '',
      ].join('\n'),
      exitCode: 128,
    })
    expect(fixes).toEqual([
      {
        kind: 'command',
        label: 'Set upstream to origin/feat/x',
        command: 'git push --set-upstream origin feat/x',
      },
    ])
  })

  it('does not offer set-upstream on success', () => {
    expect(
      computeQuickFixes({
        command: 'git push',
        output: 'git push --set-upstream origin y',
        exitCode: 0,
      }),
    ).toEqual([])
  })

  it('offers each git "did you mean" suggestion, rewriting the subcommand', () => {
    const fixes = computeQuickFixes({
      command: 'git statuss',
      output: [
        "git: 'statuss' is not a git command. See 'git --help'.",
        '',
        'The most similar commands are',
        '\tstatus',
        '\tstash',
        '',
      ].join('\n'),
      exitCode: 1,
    })
    expect(fixes).toEqual([
      { kind: 'command', label: 'git status', command: 'git status' },
      { kind: 'command', label: 'git stash', command: 'git stash' },
    ])
  })

  it('handles the singular "most similar command is" form', () => {
    const fixes = computeQuickFixes({
      command: 'git chekout main',
      output: 'The most similar command is\n\tcheckout\n',
      exitCode: 1,
    })
    expect(fixes).toEqual([
      { kind: 'command', label: 'git checkout', command: 'git checkout main' },
    ])
  })

  it('offers to free a stuck port (node EADDRINUSE)', () => {
    const fixes = computeQuickFixes({
      command: 'npm run dev',
      output: 'Error: listen EADDRINUSE: address already in use :::5050',
      exitCode: 1,
    })
    expect(fixes).toEqual([
      {
        kind: 'command',
        label: 'Free port 5050 (kill listener)',
        command: 'lsof -ti tcp:5050 | xargs kill -9',
      },
    ])
  })

  it('offers to free a stuck port ("address already in use" form)', () => {
    const fixes = computeQuickFixes({
      command: 'python -m http.server',
      output: 'OSError: [Errno 48] Address already in use 0.0.0.0:8000',
      exitCode: 1,
    })
    expect(fixes[0]).toEqual({
      kind: 'command',
      label: 'Free port 8000 (kill listener)',
      command: 'lsof -ti tcp:8000 | xargs kill -9',
    })
  })

  it('offers a link for a GitHub PR-create URL regardless of exit code', () => {
    const fixes = computeQuickFixes({
      command: 'git push',
      output: [
        "remote: Create a pull request for 'feat/x' on GitHub by visiting:",
        'remote:      https://github.com/acme/repo/pull/new/feat/x',
        'remote:',
      ].join('\n'),
      exitCode: 0,
    })
    expect(fixes).toEqual([
      {
        kind: 'link',
        label: 'Create pull request',
        url: 'https://github.com/acme/repo/pull/new/feat/x',
      },
    ])
  })

  it('returns nothing for a plain successful command', () => {
    expect(computeQuickFixes({ command: 'ls -la', output: 'file.txt', exitCode: 0 })).toEqual([])
  })

  it('returns nothing with empty context', () => {
    expect(computeQuickFixes({ command: '', output: '', exitCode: null })).toEqual([])
  })
})
