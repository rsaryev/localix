import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { clientSitesOf, maskCode, readClientModules } from './client-source'

const scratch = tempDirPerTest('mods-client-source', {})

test('masking blanks comments, strings, templates and regexes, and keeps template code', () => {
  const code = 'a("Client(", /Cl"ient(/g, `x${Client({ module: "./m.tsx" })}y`) // Client('
  const masked = maskCode(code)
  expect(masked).toHaveLength(code.length)
  expect(masked.match(/Client/g)).toHaveLength(1)
  expect(masked).toContain('${Client({ module: "       " })}')
})

test('sites name their literal, or null when the module is not one', () => {
  const code = [
    'h(Client, { key: "a", module: "./a.tsx", props: { n: f(1, 2) } })',
    'ui.Client({ "module": `./b.tsx`, key })',
    'Client({ key: "c", module: dir + "/c.tsx" })',
    'Client(props)',
    'h(Text, null, "Client(", text)',
  ].join('\n')
  expect(clientSitesOf(code).map((site) => site.literal)).toEqual([
    './a.tsx',
    './b.tsx',
    null,
    null,
  ])
})

test('a hooks file is rewritten to the module path under the plugin; JSX text is not code', () => {
  const root = scratch()
  writeTree(root, {
    'hooks/panes/clock.tsx': [
      "export const draw = (Client, Text) => <><Text>don't</Text><Client key='k' module='../client/face.tsx' /></>",
    ].join('\n'),
    'hooks/client/face.tsx': 'export default () => null',
  })
  const found = new Set<string>()
  const file = join(root, 'hooks/panes/clock.tsx')
  const code = readClientModules({
    source: readFileSync(file, 'utf8'),
    file,
    root,
    loader: 'tsx',
    found,
  })
  expect(code).toContain('module: "hooks/client/face.tsx"')
  expect([...found]).toEqual(['hooks/client/face.tsx'])
  expect(
    readClientModules({ source: 'export const x = 1', file, root, loader: 'ts' }),
  ).toBeUndefined()
})
