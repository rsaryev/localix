import { describe, it, expect } from 'bun:test'

import {
  parseMarkdownFrontmatter,
  parseYamlFrontmatterBlock,
  renderFrontmatterFile,
  splitFrontmatter,
} from './frontmatter-yaml'

describe('parseYamlFrontmatterBlock', () => {
  it('parses a nested hooks map from frontmatter', () => {
    const raw = [
      '---',
      'name: guard',
      'description: guards writes',
      'hooks:',
      '  PreToolUse:',
      '    - matcher: Write',
      '      hooks:',
      '        - type: command',
      '          command: ./deny.sh',
      '---',
      'body text',
    ].join('\n')
    const fm = parseYamlFrontmatterBlock(raw)
    expect(fm).toBeDefined()
    const hooks = fm!.hooks as Record<string, unknown>
    expect(Array.isArray(hooks.PreToolUse)).toBe(true)
    const group = (hooks.PreToolUse as Record<string, unknown>[])[0]
    expect(group.matcher).toBe('Write')
    expect((group.hooks as Record<string, unknown>[])[0].command).toBe('./deny.sh')
  })

  it('returns undefined on malformed YAML (fallback signal)', () => {
    const raw = ['---', 'name: x', 'hooks: [unbalanced', '---', 'body'].join('\n')
    expect(parseYamlFrontmatterBlock(raw)).toBeUndefined()
  })

  it('returns undefined when there is no frontmatter', () => {
    expect(parseYamlFrontmatterBlock('just a body, no frontmatter')).toBeUndefined()
  })

  it('returns undefined when the document is a scalar/array, not a map', () => {
    expect(parseYamlFrontmatterBlock('---\n- a\n- b\n---\nbody')).toBeUndefined()
  })
})

describe('one parse, two views', () => {
  // Hand-written frontmatter that is not quite YAML: an unquoted `: ` and a leading `@`.
  const sloppy = [
    '---',
    'name: deploy',
    'description: Use when: shipping to prod',
    'argument-hint: @environment',
    'version: 1.0',
    'tools: []',
    '---',
    'Body.',
  ].join('\n')

  it('repairs unquoted special values so BOTH views read the block', () => {
    const { fields } = parseMarkdownFrontmatter(sloppy)
    expect(fields.description).toBe('Use when: shipping to prod')
    expect(fields['argument-hint']).toBe('@environment')
    expect(fields.version).toBe('1.0') // as written, not the number 1
    expect(fields.tools).toEqual([]) // an explicit empty list stays one
    expect(parseYamlFrontmatterBlock(sloppy)?.description).toBe('Use when: shipping to prod')
  })

  it('keeps a literal block scalar indentation the line reader flattened', () => {
    const { fields } = parseMarkdownFrontmatter('---\ntext: |\n  a\n    b\n---\nB.')
    expect(fields.text).toBe('a\n  b')
  })

  it('splits the block once for every caller', () => {
    expect(splitFrontmatter('﻿---\r\nname: x\r\n---\r\nbody\r\n')).toEqual({
      yaml: 'name: x',
      body: 'body\n',
    })
    expect(splitFrontmatter('no frontmatter')).toBeNull()
  })
})

describe('renderFrontmatterFile', () => {
  it('writes lists and mappings, and removes a key given undefined', () => {
    const out = renderFrontmatterFile(
      '---\nname: a\nmodel: opus\nunknown: 1\n---\nbody',
      { name: 'a', model: undefined, tools: ['read', 'grep'], localix: { priority: 1 } },
      'new',
    )
    expect(out).toBe(
      '---\ntools:\n  - read\n  - grep\nlocalix:\n  priority: 1\nname: a\nunknown: 1\n---\n\nnew\n',
    )
  })

  it('refuses to rewrite a block it cannot read rather than drop its keys', () => {
    const broken = '---\nname: x\nhooks:\n\t- tab\n---\nbody'
    expect(() => renderFrontmatterFile(broken, { name: 'y' }, 'body')).toThrow(/not valid YAML/)
  })
})

describe('parseMarkdownFrontmatter', () => {
  it('parses basic frontmatter and body', () => {
    const { fields, body } = parseMarkdownFrontmatter(
      '---\nname: test\ndescription: A test skill\n---\n\nBody here.',
    )
    expect(fields.name).toBe('test')
    expect(fields.description).toBe('A test skill')
    expect(body).toBe('Body here.')
  })

  it('returns empty fields + raw body when no frontmatter', () => {
    const { fields, body } = parseMarkdownFrontmatter('Just a body.')
    expect(Object.keys(fields)).toHaveLength(0)
    expect(body).toBe('Just a body.')
  })

  it('strips UTF-8 BOM before parsing', () => {
    const withBom = '﻿---\nname: bom-test\n---\n\nBody.'
    const { fields, body } = parseMarkdownFrontmatter(withBom)
    expect(fields.name).toBe('bom-test')
    expect(body).toBe('Body.')
  })

  it('normalizes CRLF line endings (Windows)', () => {
    const crlf = '---\r\nname: win-test\r\n---\r\n\r\nBody.'
    const { fields, body } = parseMarkdownFrontmatter(crlf)
    expect(fields.name).toBe('win-test')
    expect(body).toBe('Body.')
  })

  it('strips quotes from values', () => {
    const { fields } = parseMarkdownFrontmatter('---\ndescription: "quoted value"\n---\n\nb')
    expect(fields.description).toBe('quoted value')
  })

  it('parses block-list values as string arrays', () => {
    const src = '---\nname: my-skill\nallowed-tools:\n  - Read\n  - Bash(git *)\n---\n\nBody.'
    const { fields, body } = parseMarkdownFrontmatter(src)
    expect(fields.name).toBe('my-skill')
    expect(fields['allowed-tools']).toEqual(['Read', 'Bash(git *)'])
    expect(body).toBe('Body.')
  })

  it('parses block-list arguments as string arrays', () => {
    const src = '---\nname: s\narguments:\n  - target\n  - branch\n---\n\nBody.'
    const { fields } = parseMarkdownFrontmatter(src)
    expect(fields.arguments).toEqual(['target', 'branch'])
  })

  it('scalar fields remain strings when block-list is absent', () => {
    const src = '---\nname: plain\ndescription: A plain skill\n---\n\nBody.'
    const { fields } = parseMarkdownFrontmatter(src)
    expect(typeof fields.name).toBe('string')
    expect(fields.name).toBe('plain')
  })

  it('folds a multi-line scalar (value on indented continuation lines) into one string', () => {
    // Regression: a `description:` whose value sat on the next indented line(s) used to
    // parse as '' — silently dropping the description in skill validation AND selection.
    const src =
      '---\nname: jwt\ndescription:\n  JWT and OIDC security testing covering token forgery,\n  algorithm confusion, and claim manipulation\n---\n\nBody.'
    const { fields } = parseMarkdownFrontmatter(src)
    expect(fields.description).toBe(
      'JWT and OIDC security testing covering token forgery, algorithm confusion, and claim manipulation',
    )
    expect(fields.name).toBe('jwt')
  })

  it('preserves newlines for a `|` literal block scalar and folds a `>` block scalar', () => {
    const literal = parseMarkdownFrontmatter('---\ntext: |\n  line one\n  line two\n---\n\nB.')
    expect(literal.fields.text).toBe('line one\nline two')
    const folded = parseMarkdownFrontmatter('---\ntext: >\n  line one\n  line two\n---\n\nB.')
    expect(folded.fields.text).toBe('line one line two')
  })

  it('an empty scalar with no continuation stays an empty string', () => {
    const { fields } = parseMarkdownFrontmatter('---\nname: n\ndescription:\n---\n\nBody.')
    expect(fields.description).toBe('')
    expect(fields.name).toBe('n')
  })

  it('handles block-list with BOM and CRLF', () => {
    const src = '﻿---\r\nallowed-tools:\r\n  - Read\r\n  - Write\r\n---\r\n\r\nBody.'
    const { fields, body } = parseMarkdownFrontmatter(src)
    expect(fields['allowed-tools']).toEqual(['Read', 'Write'])
    expect(body).toBe('Body.')
  })
})
