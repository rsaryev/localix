import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createResumeService } from './service'
import { createTemplateDocument } from '../shared/templates'
import { exportDocument } from '../shared/format'
import { emptyEntry } from '../shared/schema'

test('agent rich descriptions survive canonical files, export and historical restoration', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'resume-rich-'))
  try {
    const service = createResumeService(folder)
    const created = await service.create('user', createTemplateDocument('awal', 'CV'))
    const section = created.document.sections.find((item) => item.type === 'experience')!
    const entry = {
      ...emptyEntry(),
      title: 'Engineer',
      body: {
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph' as const,
            content: [
              { type: 'text' as const, text: 'Delivered ', marks: [{ type: 'bold' as const }] },
              { type: 'text' as const, text: 'user_id', marks: [{ type: 'italic' as const }] },
            ],
          },
        ],
      },
    }
    const saved = await service.update(
      'user',
      created.id,
      created.revision,
      [{ op: 'addEntry', sectionId: section.id, entry }],
      'agent',
    )
    const persisted = JSON.parse(await readFile(join(folder, service.path(saved.id)), 'utf8'))
    expect(
      persisted.document.sections.find((item: { id: string }) => item.id === section.id).entries[0]
        .body,
    ).toEqual(entry.body)
    expect(exportDocument(saved.document, 'text')).toContain('Delivered user_id')
    expect(exportDocument(saved.document, 'markdown')).toContain('**Delivered** _user\\_id_')
    const edited = await service.update('user', saved.id, saved.revision, [
      {
        op: 'updateEntry',
        sectionId: section.id,
        entryId: entry.id,
        value: { body: 'Later prose' },
      },
    ])
    const restored = await service.restore('user', saved.id, edited.revision, saved.revision)
    expect(
      restored.document.sections.find((item) => item.id === section.id)!.entries[0]!.body,
    ).toEqual(entry.body)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
