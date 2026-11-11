import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { readClientModules } from './client-source'

const scratch = tempDirPerTest('mods-client-source', {})

function read(files: Record<string, string>, entry: string, found?: Set<string>) {
  const root = scratch()
  writeTree(root, files)
  const file = join(root, entry)
  return readClientModules({
    source: readFileSync(file, 'utf8'),
    file,
    root,
    loader: 'tsx',
    ...(found ? { found } : {}),
  })
}

test('a hooks file is rewritten to the module path under the plugin; JSX text is not code', () => {
  const found = new Set<string>()
  const code = read(
    {
      'hooks/panes/clock.tsx':
        "export const draw = (Client, Text) => <><Text>don't Client(</Text><Client key='k' module='../client/face.tsx' /></>",
      'hooks/client/face.tsx': 'export default () => null',
    },
    'hooks/panes/clock.tsx',
    found,
  )
  expect(code).toContain('module: "hooks/client/face.tsx"')
  expect([...found]).toEqual(['hooks/client/face.tsx'])
})

test('a file that constructs no Client loads as it is', () => {
  expect(read({ 'hooks/a.ts': 'export const x = 1' }, 'hooks/a.ts')).toBeUndefined()
})

test('a module that is no literal, or names no file of the plugin, is refused', () => {
  expect(() =>
    read(
      { 'hooks/a.tsx': 'export const f = (Client, dir) => <Client module={dir + "/c.tsx"} />' },
      'hooks/a.tsx',
    ),
  ).toThrow('hooks/a.tsx: Client module must be a string literal')
  expect(() =>
    read(
      { 'hooks/a.tsx': 'export const f = (Client) => <Client module="./gone.tsx" />' },
      'hooks/a.tsx',
    ),
  ).toThrow('names no file inside the plugin')
  expect(() =>
    read({ 'hooks/a.ts': 'export const f = (Client, props) => Client(props)' }, 'hooks/a.ts'),
  ).toThrow('Client takes its props as an object literal')
})
