import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PluginContext } from '@localixai/plugin-sdk/backend'
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
    ui: { open: (input: unknown) => input },
  } as unknown as PluginContext
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

test('guide then one custom init creates grouped skills and returns the revision for editing without get', async () => {
  const root = await mkdtemp(join(tmpdir(), 'resume-authoring-'))
  const ctx = {
    z,
    userId: 'user',
    cwd: root,
    defineTool: (definition: unknown) => definition,
    ui: { open: (input: unknown) => input },
  } as unknown as PluginContext
  const tool = createResumeTool(ctx, createResumeService(root)) as unknown as Definition
  try {
    const guide = JSON.parse((await tool.execute('guide', { action: 'guide' })).content)
    const document = {
      ...guide.emptyDocument,
      title: 'Illustrative DevOps resume',
      sections: [
        {
          id: crypto.randomUUID(),
          type: 'skills',
          title: 'Skills',
          hidden: false,
          entries: [
            {
              id: crypto.randomUUID(),
              title: 'Infrastructure',
              organization: '',
              location: '',
              start: '',
              end: '',
              current: false,
              body: 'AWS, Terraform, Kubernetes',
              bullets: [],
              link: null,
            },
          ],
        },
      ],
    }
    const created = await tool.execute(
      'init',
      toolInputSchema.parse({
        action: 'init',
        title: document.title,
        document,
      }),
    )
    expect(created.isError).toBeUndefined()
    const resume = JSON.parse(created.content)
    expect(resume.document.sections[0].entries[0].body).toBe('AWS, Terraform, Kubernetes')
    expect(resume.revision).toMatch(/^[a-f0-9]{64}$/u)
    const edited = await tool.execute('update', {
      action: 'update',
      id: resume.id,
      revision: resume.revision,
      operations: [{ op: 'header', value: { headline: 'DevOps Engineer' } }],
    })
    expect(edited.isError).toBeUndefined()
    expect(JSON.parse(edited.content).document.header.headline).toBe('DevOps Engineer')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
