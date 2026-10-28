import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import { listFolderWorkflows } from './folder-workflows'

const script = (name: string, note: string) =>
  `export const meta = { name: '${name}', description: '${note}' }\nreturn 1\n`

describe('workflows kept in folders', () => {
  const tmp = tempDirPerTest('folder-workflows')

  test('the project folder wins over the user folder for the same name', async () => {
    const root = tmp()
    const home = join(root, 'home')
    const repo = join(root, 'repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    mkdirSync(join(repo, '.claude', 'workflows'), { recursive: true })
    mkdirSync(join(home, '.claude', 'workflows'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'workflows', 'audit.js'), script('audit', 'project'))
    writeFileSync(join(home, '.claude', 'workflows', 'audit.js'), script('audit', 'user'))
    writeFileSync(join(home, '.claude', 'workflows', 'sweep.js'), script('sweep', 'user'))
    const found = await listFolderWorkflows({ cwd: repo, homeDir: home })
    expect(found.map((e) => [e.fullName, e.description])).toEqual([
      ['audit', 'project'],
      ['sweep', 'user'],
    ])
  })
})
