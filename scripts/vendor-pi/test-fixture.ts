/**
 * The vendored fork in miniature, against real git: a scratch "upstream" repository and a scratch
 * fork that vendors it with a Localix delta in `packages/ai`. Shared by the sync and carry suites,
 * so both meet the same fork.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { scratchGitEnv } from '../scratch-git-env'
import type { SyncContext } from './sync'

const env = {
  ...scratchGitEnv(),
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}
// The scratch repositories must never see the real one's hooks or identity.
Object.assign(process.env, env)

export async function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(['git', ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(' ')}: ${err}`)
  return out.trim()
}

export async function write(root: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
}

export const manifest = (
  scripts: Record<string, string>,
  extra: Record<string, unknown> = {},
  name = '@earendil-works/pi-ai',
) => `${JSON.stringify({ name, version: '1.0.0', ...extra, scripts }, null, '\t')}\n`

export const UPSTREAM_MANIFEST = manifest({ build: 'tsgo -p tsconfig.json', test: 'vitest --run' })
const OUR_MANIFEST = manifest(
  { build: 'tsgo -p tsconfig.json', 'type-check': 'tsc --noEmit', 'test:upstream': 'vitest --run' },
  { private: true },
)

export interface VendorFixture {
  dir: string
  upstream: string
  fork: string
  logs: string[]
  ctx: SyncContext
  commitUpstream: (files: Record<string, string>, message: string) => Promise<string>
  cleanup: () => Promise<void>
}

/** Upstream `u0` with `extraUpstream` beside `packages/ai`, and a fork that vendors only `packages/ai`. */
export async function createVendorFixture(
  extraUpstream: Record<string, string> = {},
): Promise<VendorFixture> {
  const dir = await mkdtemp(join(tmpdir(), 'vendor-sync-'))
  const upstream = join(dir, 'upstream')
  const fork = join(dir, 'fork')
  await mkdir(upstream)
  await mkdir(fork)
  const commitUpstream = async (files: Record<string, string>, message: string) => {
    await write(upstream, files)
    await git(upstream, 'add', '-A')
    await git(upstream, 'commit', '-qm', message)
    return git(upstream, 'rev-parse', 'HEAD')
  }
  await git(upstream, 'init', '-q', '-b', 'main')
  const u0 = await commitUpstream(
    {
      'packages/ai/package.json': UPSTREAM_MANIFEST,
      'packages/ai/src/auth.ts': 'export const port = 1455\nexport const retries = 0\n',
      'packages/ai/src/models.ts': 'export const models = ["a"]\n',
      'README.md': 'upstream only — never vendored\n',
      ...extraUpstream,
    },
    'u0',
  )

  // The fork: upstream u0 plus a Localix delta in auth.ts and in the manifest.
  await git(fork, 'init', '-q', '-b', 'main')
  await write(fork, {
    'vendor/pi/UPSTREAM.md': `# Vendored pi\n\n- Base commit: \`${u0}\`\n- Upstream version: \`1.0.0\`\n\n\`packages/ai/src/auth.ts\` retries the login port (the Localix recovery delta).\n`,
    'vendor/pi/packages/ai/package.json': OUR_MANIFEST,
    'vendor/pi/packages/ai/src/auth.ts':
      'export const port = 1455\nexport const retries = 10 // Localix\n',
    'vendor/pi/packages/ai/src/models.ts': 'export const models = ["a"]\n',
    'app.ts': 'console.log("the fork")\n',
  })
  await git(fork, 'add', '-A')
  await git(fork, 'commit', '-qm', 'fork')
  const logs: string[] = []
  return {
    dir,
    upstream,
    fork,
    logs,
    ctx: {
      root: fork,
      url: upstream,
      tripwires: [],
      install: false,
      log: (line) => logs.push(line),
    },
    commitUpstream,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}
