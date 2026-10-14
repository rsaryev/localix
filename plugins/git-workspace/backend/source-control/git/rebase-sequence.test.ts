import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { interactiveRebase } from './rebase'
import type { GitRunner } from './cli'

test.each(['success', 'failure', 'conflict'] as const)(
  'sequenced rebase %s retains temporary files only for a pending replay',
  async (outcome) => {
    const cwd = await mkdtemp(join(tmpdir(), 'localix-sequence-lifecycle-'))
    let sequenceDir: string | undefined
    const ok = (stdout = '') => ({ ok: true, code: 0, stdout, stderr: '' })
    try {
      if (outcome === 'conflict') await mkdir(join(cwd, 'rebase-merge'))
      const run: GitRunner = async (args, env) => {
        if (args[0] === 'status') return ok()
        if (args[0] === 'rev-list') return ok('target\n')
        if (args[0] === 'rev-parse') {
          if (args[1] === '--git-path') return ok(args[2])
          return ok(args[2] === 'target^' ? 'base' : 'target')
        }
        if (args[0] === 'rebase') {
          const todoPath = env?.LOCALIX_REBASE_TODO
          if (!todoPath) throw new Error('Missing sequence todo')
          sequenceDir = dirname(todoPath)
          expect(await readFile(todoPath, 'utf8')).toContain('pick target\nexec git commit')
          return outcome === 'success'
            ? ok()
            : { ok: false, code: 1, stdout: '', stderr: 'Replay stopped\nDetails' }
        }
        throw new Error(`Unexpected Git command: ${args.join(' ')}`)
      }
      const execution = interactiveRebase(run, cwd, 'target', [
        { hash: 'target', action: 'reword', message: 'New message' },
      ])
      if (outcome === 'success') await execution
      else {
        await expect(execution).rejects.toMatchObject({
          code: outcome === 'conflict' ? 'git_rebase_conflict' : 'git_rebase_failed',
          message: 'Replay stopped',
        })
      }
      expect(sequenceDir).toBeDefined()
      expect(existsSync(sequenceDir!)).toBe(outcome === 'conflict')
    } finally {
      if (sequenceDir) await rm(sequenceDir, { recursive: true, force: true })
      await rm(cwd, { recursive: true, force: true })
    }
  },
)
