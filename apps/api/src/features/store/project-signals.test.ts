import { describe, expect, test } from 'bun:test'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { createProjectSignals } from './project-signals'

const dir = tempDirPerTest('store-project-signals')

describe('what the open project is written in', () => {
  test('is read from the files at its root: languages, frameworks and tools', async () => {
    writeTree(dir(), {
      'package.json': JSON.stringify({
        dependencies: { react: '19', pg: '8' },
        devDependencies: { typescript: '6', tailwindcss: '4' },
      }),
      'tsconfig.json': '{}',
      Dockerfile: 'FROM scratch',
      '.github/workflows/ci.yml': 'on: push',
      'infra/main.tf': '',
    })
    const signals = createProjectSignals({ projectDir: async () => dir() })
    expect([...(await signals.of('u1', 'p1'))].sort()).toEqual(
      [
        'docker',
        'github',
        'javascript',
        'node',
        'postgres',
        'react',
        'tailwind',
        'typescript',
      ].sort(),
    )
  })

  test('nothing for no project, or a folder it cannot read', async () => {
    const signals = createProjectSignals({ projectDir: async () => null })
    expect(await signals.of('u1', null)).toEqual(new Set())
    expect(await signals.of('u1', 'p1')).toEqual(new Set())
    const gone = createProjectSignals({ projectDir: async () => `${dir()}/missing` })
    expect(await gone.of('u1', 'p1')).toEqual(new Set())
  })

  test('is read once per project while it is fresh', async () => {
    writeTree(dir(), { 'Cargo.toml': '' })
    let now = 0
    const signals = createProjectSignals({ projectDir: async () => dir(), now: () => now })
    expect(await signals.of('u1', 'p1')).toEqual(new Set(['rust']))
    writeTree(dir(), { 'go.mod': '' })
    expect(await signals.of('u1', 'p1')).toEqual(new Set(['rust']))
    now = 10 * 60 * 1000
    expect(await signals.of('u1', 'p1')).toEqual(new Set(['rust', 'go']))
  })
})
