import { expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSkillsFromRoot } from './skill-scan'

test('retries a failed lazy transformation and memoizes only a successfully loaded body', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'skill-lazy-transform-'))
  const file = join(root, 'SKILL.md')
  const transformed: string[] = []
  const markdown = (body: string) =>
    `---\nname: snapshot\ndescription: original metadata\n---\n${body}`
  try {
    await fs.writeFile(file, markdown('Initial body.'))
    const [skill] = await readSkillsFromRoot(root, 'global', undefined, (body) => {
      transformed.push(body)
      if (transformed.length === 1) throw new Error('Transform unavailable')
      return `Transformed: ${body}`
    })
    expect(transformed).toEqual([])
    expect(Object.getOwnPropertyDescriptor(skill, 'content')).toMatchObject({
      enumerable: true,
      configurable: false,
    })
    expect(() => skill!.content).toThrow('Transform unavailable')
    await fs.writeFile(
      file,
      markdown('Body on retry.').replace('original metadata', 'changed metadata'),
    )
    expect(skill!.content).toBe('Transformed: Body on retry.')
    await fs.writeFile(file, markdown('Later body.'))
    expect(skill!.content).toBe('Transformed: Body on retry.')
    expect(skill!.description).toBe('original metadata')
    expect(transformed).toEqual(['Initial body.', 'Body on retry.'])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
