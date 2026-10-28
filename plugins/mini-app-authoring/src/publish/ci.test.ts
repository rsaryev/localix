import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '../testing/temp'
import { ensureGitignore, localixPin, releaseWorkflow } from './ci'

const tempDir = tempDirPerTest('mini-app-ci-')

const workflow = (version?: string) =>
  Bun.YAML.parse(releaseWorkflow({ displayName: 'Meal Log', pin: localixPin(version) })) as {
    on: { push: { tags: string[] } }
    env: Record<string, string>
    jobs: { build: { steps: { name?: string; run?: string; with?: Record<string, string> }[] } }
  }

const step = (name: string, version?: string) =>
  workflow(version).jobs.build.steps.find((s) => s.name === name)!

describe('the release workflow', () => {
  test('builds with the toolchain and kit of the Localix the app was made with', () => {
    const { env, jobs } = workflow('0.1.0-beta.18')

    expect(env.LOCALIX_REF).toBe('v0.1.0-beta.18')
    expect(env.MINI_APP_KIT_RELEASES).toBe(
      'https://github.com/rsaryev/localix/releases/download/v0.1.0-beta.18',
    )
    const toolchain = jobs.build.steps.find((s) => s.with?.repository === 'rsaryev/localix')
    expect(toolchain?.with).toMatchObject({
      ref: '${{ env.LOCALIX_REF }}',
      'sparse-checkout': 'plugins/mini-app-authoring',
    })
  })

  // A development build names a version no release carries.
  test('follows the latest Localix when the app was made with an unreleased one', () => {
    const { env } = workflow('unknown')

    expect(env.LOCALIX_REF).toBe('main')
    expect(env.MINI_APP_KIT_RELEASES).toBe(
      'https://github.com/rsaryev/localix/releases/latest/download',
    )
  })

  test('releases on a version tag only, and refuses a tag that is not the version', async () => {
    expect(workflow('0.1.0').on.push.tags).toEqual(['v*'])
    const guard = step('The tag is the version in mini-app.json').run!
    const dir = tempDir()
    writeTree(dir, { 'app/mini-app.json': JSON.stringify({ version: '0.2.0' }) })
    const run = async (tag: string) => {
      const child = Bun.spawn(['sh', '-c', guard], {
        cwd: dir,
        env: { ...process.env, GITHUB_REF_NAME: tag },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      return { code: await child.exited, out: await new Response(child.stdout).text() }
    }

    expect((await run('v0.2.0')).code).toBe(0)
    const wrong = await run('v0.1.0')
    expect(wrong.code).toBe(1)
    expect(wrong.out).toContain('v0.1.0 is not v0.2.0')
  })
})

describe('the ignore file of a mini app', () => {
  test('keeps what the checks generate out of git, and keeps the lines already there', async () => {
    const dir = tempDir()
    writeTree(dir, { '.gitignore': 'node_modules/\n.env\n' })

    expect(await ensureGitignore(dir)).toContain('tsconfig.json')
    const lines = (await fs.readFile(join(dir, '.gitignore'), 'utf8')).split('\n')
    expect(lines).toEqual(expect.arrayContaining(['.env', 'tsconfig.json', 'KIT.md', 'dist/']))
    expect(lines.filter((line) => line === 'node_modules/')).toHaveLength(1)
    expect(await ensureGitignore(dir)).toEqual([])
  })
})
