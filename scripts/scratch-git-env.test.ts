import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { scratchGitEnv, scrubGitEnv } from './scratch-git-env.mjs'

const root = resolve(import.meta.dir, '..')
const SCANNED = ['scripts', 'apps', 'packages']
const SKIP = new Set(['node_modules', 'dist', 'target', '.turbo', 'src', 'src-tauri'])

/** Files under scripts/, apps/<x>/scripts and packages/<x>/scripts. */
function scriptFiles(dir: string, inScripts: boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) scriptFiles(path, inScripts || name === 'scripts', out)
    else if (inScripts && /\.(?:[cm]?[jt]s|tsx)$/u.test(name)) out.push(path)
  }
  return out
}

describe('scratch git environment', () => {
  test('drops every hook-exported GIT_* variable and pins config and identity', () => {
    const env = scratchGitEnv({
      PATH: '/bin',
      GIT_DIR: '/repo/.git',
      GIT_WORK_TREE: '/repo',
      GIT_INDEX_FILE: '/repo/.git/index',
      GIT_COMMON_DIR: '/repo/.git',
      GIT_PREFIX: 'sub/',
      GIT_OBJECT_DIRECTORY: '/repo/.git/objects',
      GIT_CONFIG_PARAMETERS: "'core.bare'='true'",
    })
    expect(env.PATH).toBe('/bin')
    for (const key of [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_COMMON_DIR',
      'GIT_PREFIX',
      'GIT_OBJECT_DIRECTORY',
      'GIT_CONFIG_PARAMETERS',
    ])
      expect(env[key]).toBeUndefined()
    expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null')
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1')
    const live = { GIT_DIR: 'x', HOME: '/h' }
    expect(scrubGitEnv(live)).toBe(live)
    expect(live).toEqual({ HOME: '/h' })
  })

  test('script tests and fixtures that spawn git use the scratch environment', () => {
    const offenders: string[] = []
    for (const top of SCANNED) {
      for (const file of scriptFiles(join(root, top), top === 'scripts')) {
        const rel = relative(root, file)
        if (rel === 'scripts/scratch-git-env.mjs' || rel === 'scripts/scratch-git-env.test.ts')
          continue
        const code = readFileSync(file, 'utf8')
        // Tests always build a repository; elsewhere `git init` marks a fixture builder.
        const spawnsGit = /['"]git['"]/u.test(code)
        const fixture = /\.test\.[cm]?[jt]sx?$/u.test(rel) || /['"]init['"]/u.test(code)
        if (spawnsGit && fixture && !/scratchGitEnv|scrubGitEnv/u.test(code)) offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })
})
