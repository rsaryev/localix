import { describe, expect, test } from 'bun:test'

import { joinCommandLine, splitCommandLine } from './command-line'

describe('joinCommandLine', () => {
  test('quotes what a split would break apart, so a line reads back as the same argv', () => {
    const argv = ['node', './my server.js', '--name=a "b"', '', 'C:\\Program Files\\x.exe', '$HOME']
    expect(splitCommandLine(joinCommandLine(argv))).toEqual(argv)
  })

  test('leaves plain words bare', () => {
    expect(joinCommandLine(['npx', '-y', '@scope/server', '/tmp'])).toBe(
      'npx -y @scope/server /tmp',
    )
  })
})

describe('splitCommandLine', () => {
  test('splits a plain install line on whitespace, collapsing runs of it', () => {
    expect(splitCommandLine('  npx -y   @modelcontextprotocol/server-filesystem /tmp ')).toEqual([
      'npx',
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '/tmp',
    ])
    expect(splitCommandLine('')).toEqual([])
    expect(splitCommandLine('   ')).toEqual([])
  })

  test('honors double and single quotes, stripping them', () => {
    expect(splitCommandLine(`node "./my server.js" '/path with space' --flag`)).toEqual([
      'node',
      './my server.js',
      '/path with space',
      '--flag',
    ])
  })

  // The regex splitter cut this into `--env=FOO=` and `a b`: a quote mid-word is part of the word.
  test('keeps a quoted value glued to the flag it follows', () => {
    expect(splitCommandLine('server --env=FOO="a b" --x')).toEqual([
      'server',
      '--env=FOO=a b',
      '--x',
    ])
  })

  test('honors backslash escapes', () => {
    expect(splitCommandLine('node my\\ server.js "say \\"hi\\""')).toEqual([
      'node',
      'my server.js',
      'say "hi"',
    ])
  })

  test('keeps a deliberate empty argument', () => {
    expect(splitCommandLine(`cli --prefix "" --suffix ''`)).toEqual([
      'cli',
      '--prefix',
      '',
      '--suffix',
      '',
    ])
  })

  test('leaves variables for features/mcp/expand.ts and never throws on a half-typed one', () => {
    expect(splitCommandLine('srv $HOME/x ${TOKEN:-none} "${KEY}" \'$RAW\' ${')).toEqual([
      'srv',
      '$HOME/x',
      '${TOKEN:-none}',
      '${KEY}',
      '$RAW',
      '${',
    ])
  })

  test('treats shell operators, comments and globs as literal argv text', () => {
    expect(splitCommandLine('srv a|b && c foo#bar #c *.js')).toEqual([
      'srv',
      'a|b',
      '&&',
      'c',
      'foo#bar',
      '#c',
      '*.js',
    ])
  })

  test('keeps the separators of a pasted Windows path', () => {
    expect(splitCommandLine('C:\\Users\\me\\server.js "C:\\Program Files\\node.exe"')).toEqual([
      'C:\\Users\\me\\server.js',
      'C:\\Program Files\\node.exe',
    ])
  })

  test('runs a quote left open while typing to the end of the line', () => {
    expect(splitCommandLine('node "my server')).toEqual(['node', 'my server'])
  })
})
