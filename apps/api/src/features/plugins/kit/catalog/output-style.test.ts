import { describe, expect, test } from 'bun:test'

import { builtinStyleDescription, outputStyleFile } from './output-style'

describe('outputStyleFile', () => {
  test('reads the frontmatter and trims the instructions', () => {
    const style = outputStyleFile(
      '/s/terse.md',
      '---\nname: Terse\ndescription: Short\nkeep-coding-instructions: true\n---\n\nBe brief.\n',
    )
    expect(style).toEqual({
      id: 'Terse',
      name: 'Terse',
      description: 'Short',
      keepCodingInstructions: true,
      forceForPlugin: false,
      instructions: 'Be brief.',
    })
  })

  test('a file with no frontmatter loads under the file name', () => {
    const style = outputStyleFile('/s/plain.md', 'Body')
    expect(style.name).toBe('plain')
    expect(style.description).toBeUndefined()
  })

  test('force-for-plugin is never set on a style that is not a plugin one', () => {
    expect(outputStyleFile('/s/f.md', '---\nforce-for-plugin: true\n---\nX').forceForPlugin).toBe(
      false,
    )
  })
})

test('builtinStyleDescription is the kit description', () => {
  expect(builtinStyleDescription('Concise')).toContain('lead with the result')
  expect(builtinStyleDescription('nope')).toBeUndefined()
})
