/** `/export [filename]`: the conversation as a Markdown file, and where it went. */
import { describe, expect, test } from 'bun:test'

import type { PersistedMessage } from '../contracts'
import { renderTranscript, runExport, type ExportPorts } from './command-export'

const message = (id: string, payload: Record<string, unknown>) =>
  ({ id, createdAt: '2026-03-04T05:06:07.000Z', payload }) as unknown as PersistedMessage

const conversation = [
  message('1', { role: 'user', content: 'Fix the login bug' }),
  message('2', { role: 'assistant', content: 'Done — the check was inverted.' }),
  message('3', { role: 'assistant', content: 'secret reasoning', isInternal: true }),
  message('4', { role: 'assistant', content: '/usage output', uiOnly: true }),
]

function ports(over: Partial<ExportPorts> = {}) {
  const written: [string, string][] = []
  const all: ExportPorts = {
    title: 'Fix login!',
    cwd: '/work/app',
    exportsDir: '/home/me/.localix/exports',
    now: () => new Date('2026-03-04T05:06:07.000Z'),
    messages: async () => conversation,
    exists: async () => false,
    write: async (path, text) => {
      written.push([path, text])
    },
    ...over,
  }
  return { all, written }
}

describe('/export', () => {
  test('renders what the person read: their messages and the replies, not internal rows', () => {
    const text = renderTranscript('Fix login!', conversation)
    expect(text).toContain('# Fix login!')
    expect(text).toContain('## You\n\nFix the login bug')
    expect(text).toContain('## Assistant\n\nDone — the check was inverted.')
    expect(text).not.toContain('secret reasoning')
    expect(text).not.toContain('/usage output')
  })

  test('without a name, writes a dated file in the exports folder and says where', async () => {
    const p = ports()
    const reply = await runExport(p.all, '')
    expect(p.written[0]![0]).toBe('/home/me/.localix/exports/fix-login-20260304-050607.md')
    expect(reply).toContain('/home/me/.localix/exports/fix-login-20260304-050607.md')
  })

  test('with a name, writes it relative to the folder, adding .md when there is no extension', async () => {
    const p = ports()
    await runExport(p.all, 'notes/session')
    await runExport(p.all, 'plain.txt')
    expect(p.written.map(([path]) => path)).toEqual([
      '/work/app/notes/session.md',
      '/work/app/plain.txt',
    ])
  })

  test('never replaces a file that is there', async () => {
    const p = ports({ exists: async () => true })
    expect(await runExport(p.all, 'a.md')).toContain('already exists')
    expect(p.written).toEqual([])
  })

  test('says so when there is nothing to export', async () => {
    const p = ports({ messages: async () => [] })
    expect(await runExport(p.all, '')).toContain('Nothing to export')
  })

  test('a file that cannot be written is a reply, not an error', async () => {
    const p = ports({
      write: async () => {
        throw Object.assign(new Error("EACCES: permission denied, open '/work/app/x.md'"), {
          code: 'EACCES',
        })
      },
    })
    const reply = await runExport(p.all, 'x')
    expect(reply).toContain('/work/app/x.md')
    expect(reply).toContain('permission denied')
  })

  test('a file that appeared since the check is not replaced either', async () => {
    const p = ports({
      write: async () => {
        throw Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' })
      },
    })
    expect(await runExport(p.all, 'x')).toContain('already exists; choose another name')
  })
})
