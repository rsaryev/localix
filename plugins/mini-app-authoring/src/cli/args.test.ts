import { describe, expect, test } from 'bun:test'

import { parseArgs, stringOption } from './args'

describe('parseArgs', () => {
  test('reads the command, folders and options the way a person types them', () => {
    const args = parseArgs(['create', 'gpu-monitor', '--title', 'GPU Monitor', '--json', 'extra'])
    expect(args).toEqual({
      command: 'create',
      positional: ['gpu-monitor', 'extra'],
      options: { title: 'GPU Monitor', json: true },
    })
  })

  test('takes --name=value and treats a value-less option as missing', () => {
    const args = parseArgs(['pack', '--out=dist/catalog', '--publisher'])
    expect(stringOption(args, 'out')).toBe('dist/catalog')
    expect(stringOption(args, 'publisher')).toBeUndefined()
  })

  test('keeps everything after -- positional', () => {
    expect(parseArgs(['check', '--', '--odd-folder']).positional).toEqual(['--odd-folder'])
  })
})
