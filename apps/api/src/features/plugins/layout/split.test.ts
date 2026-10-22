import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { parseCommandFile } from '../discovery-cc-files'
import { composeManifest } from './compose'
import { splitLegacyManifest } from './split'

const scratch = tempDirPerTest('split-command', {})

describe('splitLegacyManifest', () => {
  test('a workbench extension becomes a plugin and the mini app around it', () => {
    const split = splitLegacyManifest({
      name: 'chess',
      category: 'games',
      displayName: 'Chess',
      version: '0.1.0',
      apiVersion: 1,
      license: 'MIT',
      author: 'Localix',
      description: 'Chess',
      defaultEnabled: true,
      surfaces: ['agent', 'workbench'],
      keywords: ['chess'],
      tools: './backend/index.ts',
      skills: './skills',
    })
    expect(split.plugin).toEqual({
      name: 'chess',
      displayName: 'Chess',
      version: '0.1.0',
      description: 'Chess',
      license: 'MIT',
      keywords: ['chess'],
      author: { name: 'Localix' },
    })
    expect(split.app).toEqual({
      name: 'chess',
      apiVersion: 1,
      category: 'games',
      surfaces: ['agent', 'workbench'],
      backend: './backend/index.ts',
      defaultEnabled: true,
    })
    expect(Object.keys(split.files).sort()).toEqual([
      '.claude-plugin/plugin.json',
      '.localix-app/app.json',
    ])
  })

  test('an inline command becomes a command file; its pickers stay with the mini app', async () => {
    const split = splitLegacyManifest({
      name: 'review',
      commands: [
        {
          name: 'review',
          description: 'Review: pick a scope',
          argumentHint: '[scope] [focus]',
          args: [
            { name: 'scope', type: 'choice', options: [{ value: 'working' }] },
            { name: 'focus', type: 'text' },
          ],
          prompt: 'Scope ${scope}, focus ${focus}.',
        },
        {
          name: 'go',
          prompt: 'Goal: ${goal}',
          args: [{ name: 'goal', type: 'text' }],
          featured: true,
          activateTools: ['kanban'],
        },
      ],
    })
    expect(split.files['commands/review.md']).toBe(
      '---\ndescription: "Review: pick a scope"\nargument-hint: "[scope] [focus]"\narguments: [scope, focus]\n---\n\nScope $scope, focus $focus.\n',
    )
    expect(split.files['commands/go.md']).toBe('---\n\n---\n\nGoal: $ARGUMENTS\n')
    // The file reads back as the command it was, with Claude Code's positional names.
    const file = join(scratch(), 'review.md')
    await Bun.write(file, split.files['commands/review.md']!)
    expect(await parseCommandFile(file)).toMatchObject({
      name: 'review',
      description: 'Review: pick a scope',
      argumentHint: '[scope] [focus]',
      arguments: ['scope', 'focus'],
      prompt: 'Scope $scope, focus $focus.',
    })
    expect(split.app?.commands).toEqual({
      review: {
        args: [
          { name: 'scope', type: 'choice', options: [{ value: 'working' }] },
          { name: 'focus', type: 'text' },
        ],
      },
      go: {
        args: [{ name: 'goal', type: 'text' }],
        featured: true,
        activateTools: ['kanban'],
      },
    })
  })

  test('a plugin with nothing only Localix runs needs no mini app', () => {
    const split = splitLegacyManifest({ name: 'notes', version: '1.0.0', defaultEnabled: false })
    expect(split.app).toBeNull()
    expect(split.plugin).toEqual({ name: 'notes', version: '1.0.0', defaultEnabled: false })
  })

  test('composing the split gives the runtime manifest back', () => {
    const legacy = {
      name: 'api',
      category: 'development',
      version: '0.1.0',
      apiVersion: 1,
      description: 'HTTP',
      tools: './backend/index.ts',
      config: { TIMEOUT_MS: { type: 'string', default: '30000' } },
      fileAssociations: [{ ext: ['request.json'], name: 'Request' }],
    }
    const split = splitLegacyManifest(legacy)
    const composed = composeManifest(
      {
        plugin: { file: '.claude-plugin/plugin.json', json: split.plugin },
        app: { file: '.localix-app/app.json', json: split.app },
      },
      'api',
    )
    expect(composed.raw).toMatchObject(legacy)
  })
})
