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
