import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { z } from 'zod'
import { createResumeService } from './service'
import { createResumeTool, toolInputSchema } from './tool'
import { templateIds } from '../shared/templates'

interface Definition {
  execute: (
    call: string,
    input: z.infer<typeof toolInputSchema>,
  ) => Promise<{ content: string; isError?: boolean }>
  permissionPaths: (input: unknown) => string[]
}
test('one agent tool initializes every template into a real workspace file and returns its editable path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'resume-tool-'))
  const ctx = {
    z,
    userId: 'user',
    cwd: root,
    defineTool: (definition: unknown) => definition,
    ui: { offer: (input: unknown) => input },
  } as unknown as MiniAppContext
  const tool = createResumeTool(ctx, createResumeService(root)) as unknown as Definition
  try {
    for (const template of templateIds) {
      const input = toolInputSchema.parse({ action: 'init', title: `CV ${template}`, template })
      expect(tool.permissionPaths(input)).toEqual([join(root, '.localix/resumes')])
      const result = await tool.execute('call', input)
      expect(result.isError).toBeUndefined()
      const resume = JSON.parse(result.content)
      const file = JSON.parse(await readFile(join(root, resume.path), 'utf8'))
      expect(file.document.presentation.template).toBe(template)
      expect(file.document.sections.map((section: { type: string }) => section.type)).toContain(
        'experience',
      )
      const read = await tool.execute('get', { action: 'get', id: resume.id })
      expect(JSON.parse(read.content).path).toBe(resume.path)
      const saved = await tool.execute('edit', {
        action: 'update',
        id: resume.id,
        revision: resume.revision,
        operations: [{ op: 'header', value: { name: 'Test Candidate' } }],
      })
      expect(saved.isError).toBeUndefined()
      const history = await tool.execute('history', { action: 'history', id: resume.id })
      expect(
        JSON.parse(history.content).some((record: { actor: string }) => record.actor === 'agent'),
      ).toBe(true)
    }
    expect(tool.permissionPaths({ action: 'list' })).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function setup(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix)).then((root) => {
    const ctx = {
      z,
      userId: 'user',
      cwd: root,
      defineTool: (definition: unknown) => definition,
      ui: { offer: (input: unknown) => input },
    } as unknown as MiniAppContext
    const tool = createResumeTool(ctx, createResumeService(root)) as unknown as Definition
    const call = async (input: unknown) => {
      const result = await tool.execute('call', input as never)
      return { ...result, json: result.isError ? undefined : JSON.parse(result.content) }
    }
    return { root, call }
  })
}

test('one init carries a whole resume written the way models write it (LOCALIX-64/66)', async () => {
  const { root, call } = await setup('resume-authoring-')
  try {
    // No ids, no empty fields, no `link: null`; a titled summary, bulleted skills and an
    // ongoing role spelled "present" — each of these refused the whole resume before.
    const created = await call({
      action: 'init',
      title: 'Mock — Senior Backend Engineer',
      document: {
        targetRole: 'Senior Backend Engineer',
        header: {
          name: 'Alex Morgan',
          email: 'alex@example.com',
          links: ['https://github.com/alex'],
        },
        sections: [
          { type: 'summary', entries: [{ title: 'Summary', body: 'Go and PostgreSQL, 6 years.' }] },
          {
            type: 'experience',
            entries: [
              {
                title: 'Senior Backend Engineer',
                organization: 'Northstar',
                start: '2021-03-01',
                end: 'Present',
                bullets: ['Cut p99 latency by 40%'],
              },
            ],
          },
          { type: 'skills', entries: [{ title: 'Data', bullets: ['PostgreSQL', 'Redis'] }] },
        ],
      },
    })
    expect(created.isError).toBeUndefined()
    expect(created.json.notes).toEqual([
      'sections[0].entries[0]: dropped title "Summary" (summary entries take body)',
      'sections[2].entries[0]: bullets moved into body (skills entries have no bullets)',
    ])
    expect(created.json.sections.map((section: { type: string }) => section.type)).toEqual([
      'summary',
      'experience',
      'skills',
    ])
    const file = JSON.parse(await readFile(join(root, created.json.path), 'utf8'))
    const [summary, experience, skills] = file.document.sections
    expect(summary.title).toBe('Summary')
    expect(experience.entries[0]).toMatchObject({
      start: '2021-03',
      end: '',
      current: true,
      link: null,
    })
    expect(skills.entries[0].body).toBe('PostgreSQL, Redis')
    expect(file.document.header.links).toEqual([
      { label: 'github.com/alex', url: 'https://github.com/alex' },
    ])
    expect(file.document.presentation.template).toBe('awal')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('update normalizes merged entries, addresses sections by type and guards a stated revision', async () => {
  const { root, call } = await setup('resume-update-')
  try {
    const created = await call({ action: 'init', title: 'CV' })
    const summary = created.json.sections.find(
      (section: { type: string }) => section.type === 'summary',
    )
    const edited = await call({
      action: 'update',
      id: created.json.id,
      revision: created.json.revision,
      operations: [
        // LOCALIX-66's refused first update.
        {
          op: 'updateEntry',
          sectionId: summary.id,
          entryId: summary.entries[0].id,
          value: { title: 'Summary', body: 'Backend engineer.' },
        },
        {
          op: 'addEntry',
          sectionId: 'experience',
          entry: { title: 'Engineer', organization: 'Acme' },
        },
        { op: 'addEntry', sectionId: 'languages', entry: { title: 'English', proficiency: 'C1' } },
      ],
    })
    expect(edited.isError).toBeUndefined()
    expect(edited.json.notes).toContain('operations[2]: added a languages section')
    // Without a revision the operations apply to the latest file.
    const again = await call({
      action: 'update',
      id: created.json.id,
      operations: [{ op: 'header', value: { name: 'Test Candidate' } }],
    })
    expect(again.isError).toBeUndefined()
    const stale = await call({
      action: 'update',
      id: created.json.id,
      revision: created.json.revision,
      operations: [{ op: 'header', value: { name: 'Stale' } }],
    })
    expect(stale.content).toStartWith('conflict:')
    const read = await call({ action: 'get', id: created.json.id })
    expect(read.json.document.header.name).toBe('Test Candidate')
    expect(read.json.document.sections[0].entries[0]).toMatchObject({
      title: '',
      body: 'Backend engineer.',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a refused call names each bad field by its path and saves nothing', async () => {
  const { root, call } = await setup('resume-invalid-')
  try {
    const refused = await call({
      action: 'init',
      title: 'CV',
      document: {
        sections: [{ type: 'experience', entries: [{ title: 'Engineer', start: 'spring 2020' }] }],
      },
    })
    expect(refused.isError).toBe(true)
    expect(refused.content).toContain('- sections[0].entries[0].start: Use YYYY or YYYY-MM')
    expect(refused.content).toContain('Nothing was saved')
    expect((await call({ action: 'list' })).json).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
