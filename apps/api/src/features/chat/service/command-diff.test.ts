/** `/diff`: the uncommitted changes of the chat's folder, from git, bounded for a chat reply. */
import { describe, expect, test } from 'bun:test'

import { runDiff, type DiffPorts } from './command-diff'

const ports = (git: Record<string, string | null>, max?: number): DiffPorts => ({
  git: async (args) => git[args.join(' ')] ?? null,
  ...(max ? { maxPatchChars: max } : {}),
})

describe('/diff', () => {
  test('says so outside a git repository', async () => {
    expect(await runDiff(ports({}))).toContain('not a git repository')
  })

  test('says so when nothing changed', async () => {
    const reply = await runDiff(
      ports({ 'rev-parse --is-inside-work-tree': 'true', 'status --short': '' }),
    )
    expect(reply).toBe('No uncommitted changes in this folder.')
  })

  test('lists changed and new files, then the patch in a diff block', async () => {
    const reply = await runDiff(
      ports({
        'rev-parse --is-inside-work-tree': 'true',
        'status --short': ' M src/a.ts\n?? notes.md',
        'diff HEAD': 'diff --git a/src/a.ts b/src/a.ts\n-old\n+new',
      }),
    )
    expect(reply).toContain('```text\n M src/a.ts\n?? notes.md\n```')
    expect(reply).toContain('```diff\ndiff --git a/src/a.ts b/src/a.ts\n-old\n+new\n```')
    expect(reply).toContain('Untracked files are listed, not shown')
  })

  test('cuts a long patch and says how much was left out', async () => {
    const reply = await runDiff(
      ports(
        {
          'rev-parse --is-inside-work-tree': 'true',
          'status --short': ' M a',
          'diff HEAD': 'x'.repeat(100),
        },
        40,
      ),
    )
    expect(reply).not.toContain('Untracked')
    expect(reply).toContain('x'.repeat(40))
    expect(reply).not.toContain('x'.repeat(41))
    expect(reply).toContain('60 more characters')
  })

  test('uses a plain diff in a repository with no commit yet', async () => {
    const reply = await runDiff(
      ports({
        'rev-parse --is-inside-work-tree': 'true',
        'status --short': 'A  a',
        diff: 'staged-or-not',
      }),
    )
    expect(reply).toContain('staged-or-not')
  })

  test('a patch that holds backticks cannot close its own block', async () => {
    const patch = 'diff --git a/README.md b/README.md\n+```ts\n+code\n+```\n+`````'
    const reply = await runDiff(
      ports({
        'rev-parse --is-inside-work-tree': 'true',
        'status --short': ' M README.md',
        'diff HEAD': patch,
      }),
    )
    expect(reply).toContain('``````diff\n' + patch + '\n``````')
  })

  test('a cut never splits a character made of two UTF-16 units', async () => {
    const reply = await runDiff(
      ports(
        {
          'rev-parse --is-inside-work-tree': 'true',
          'status --short': ' M a',
          'diff HEAD': '+' + '😀'.repeat(10),
        },
        4,
      ),
    )
    expect(reply).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
    expect(reply).toContain('+😀')
  })
})
