import { describe, it, expect } from 'bun:test'

import {
  parseMarkdownFrontmatter,
  parseYamlFrontmatterBlock,
  renderFrontmatterFile,
  splitFrontmatter,
} from './frontmatter-yaml'
import { parseSkillFrontmatter, renderSkillFile } from './skill-frontmatter'

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

describe('parseSkillFrontmatter hooks', () => {
  it('carries a nested hooks block onto the parsed skill', () => {
    const raw = [
      '---',
      'name: reviewer',
      'description: reviews on stop',
      'hooks:',
      '  Stop:',
      '    - hooks:',
      '        - type: command',
      '          command: echo done',
      '---',
      'Review the change.',
    ].join('\n')
    const fm = parseSkillFrontmatter(raw)
    expect(fm.name).toBe('reviewer')
    const hooks = fm.hooks as Record<string, unknown>
    expect(Array.isArray(hooks.Stop)).toBe(true)
  })

  it('keeps flat fields intact and drops hooks when the YAML is malformed', () => {
    // A tab in a nested value makes YAML fail; the flat line-parser still reads scalars.
    const raw = [
      '---',
      'name: fallback',
      'description: still parses',
      'allowed-tools: Bash(git *)',
      'hooks:',
      '\t- broken tab indentation',
      '---',
      'body',
    ].join('\n')
    const fm = parseSkillFrontmatter(raw)
    expect(fm.name).toBe('fallback')
    expect(fm.description).toBe('still parses')
    expect(fm.allowedTools).toEqual(['Bash(git *)'])
    expect(fm.hooks).toBeUndefined()
  })

  it('leaves hooks undefined when the frontmatter declares none', () => {
    const fm = parseSkillFrontmatter('---\nname: plain\ndescription: no hooks\n---\nbody')
    expect(fm.hooks).toBeUndefined()
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
  it('sets owned keys and keeps comments, order and unknown keys', () => {
    const existing = [
      '---',
      '# authored by hand',
      'name: old',
      'license: MIT # keep this note',
      'metadata:',
      '  author: jane',
      'description: old text',
      '---',
      'old body',
    ].join('\n')
    const out = renderSkillFile(existing, {
      name: 'new',
      description: 'Use when: deploying',
      content: 'new body',
    })
    expect(out).toBe(
      [
        '---',
        '# authored by hand',
        'name: new',
        'license: MIT # keep this note',
        'metadata:',
        '  author: jane',
        // The line writer emitted this unquoted — invalid YAML every real parser rejects.
        'description: "Use when: deploying"',
        '---',
        '',
        'new body',
        '',
      ].join('\n'),
    )
    expect(parseMarkdownFrontmatter(out).fields.description).toBe('Use when: deploying')
  })

  it('writes a new file with name and description first', () => {
    expect(renderSkillFile('', { name: 'n', description: 'd\nmore', content: ' b ' })).toBe(
      '---\nname: n\ndescription: d more\n---\n\nb\n',
    )
  })

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
