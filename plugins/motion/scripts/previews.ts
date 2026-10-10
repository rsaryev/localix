// Renders the gallery stills: each direction's film at its poster second, into previews/.
// Needs Node 22+, FFmpeg and Chrome (downloaded by HyperFrames on first use). Run with
// `bun run --cwd plugins/motion previews [style…]`.
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { HYPERFRAMES_VERSION } from '../shared/contract'
import { motionStyles } from '../shared/styles'
import { createProject } from '../backend/projects'

const out = resolve(import.meta.dir, '..', 'previews')
const only = process.argv.slice(2)

const workspace = await mkdtemp(join(tmpdir(), 'motion-previews-'))
try {
  for (const style of motionStyles.filter((s) => !only.length || only.includes(s.id))) {
    const id = await createProject(workspace, {
      title: style.name,
      direction: style.id,
      name: style.id,
    })
    const folder = join(workspace, '.localix/motion', id)
    const at = style.poster.toFixed(1)
    const run = Bun.spawnSync(
      [
        'npx',
        '--yes',
        `hyperframes@${HYPERFRAMES_VERSION}`,
        'snapshot',
        '.',
        '--at',
        at,
        '--no-end',
        '--output',
        'snapshots',
        '--describe',
        'false',
      ],
      { cwd: folder, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, CI: '1' } },
    )
    const shots = join(folder, 'snapshots')
    const png = join(
      shots,
      (await readdir(shots).catch(() => [])).find((name) => name.startsWith('frame-00')) ??
        'missing.png',
    )
    const jpg = join(out, `${style.id}.jpg`)
    const convert = Bun.spawnSync([
      'sips',
      '-s',
      'format',
      'jpeg',
      '-s',
      'formatOptions',
      '78',
      '--resampleWidth',
      '640',
      png,
      '--out',
      jpg,
    ])
    console.log(
      style.id,
      run.exitCode === 0 && convert.exitCode === 0 && (await Bun.file(jpg).exists())
        ? 'ok'
        : `failed\n${run.stderr.toString().slice(-600)}`,
    )
  }
} finally {
  await rm(workspace, { recursive: true, force: true })
}
