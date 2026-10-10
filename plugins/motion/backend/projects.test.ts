import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { motionStyles } from '../shared/styles'
import { lintProject } from './lint'
import { applyStyle, createProject, importAssets, listProjects, readProject } from './projects'
import { createMotionRoutes } from './routes'
import { viewBase } from './view'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function folder() {
  const dir = await mkdtemp(join(tmpdir(), 'localix-motion-'))
  dirs.push(dir)
  return dir
}
const film = (workspace: string, id: string) => join(workspace, '.localix/motion', id)

test('every direction forks into a valid project with the kit, tokens and rules', async () => {
  const workspace = await folder()
  for (const direction of motionStyles) {
    const id = await createProject(workspace, { title: direction.name, direction: direction.id })
    const path = film(workspace, id)
    for (const file of [
      'index.html',
      'AGENTS.md',
      'DIRECTION.md',
      'blocks/motion-kit.js',
      'blocks/motion-kit.css',
      'blocks/style.css',
    ])
      expect(await readFile(join(path, file), 'utf8')).toBeTruthy()
    const { issues, meta } = await lintProject(path)
    // Only the reminder to replace the sample copy remains on a fresh fork.
    expect(issues.filter((issue) => !issue.includes('data-sample'))).toEqual([])
    expect(meta.title).toBe(direction.name)
    expect(meta.duration).toBeGreaterThan(3)
    expect((await readProject(path, id)).style).toBe(direction.id)
  }
  expect((await listProjects(workspace)).length).toBe(motionStyles.length)
})

test('a fork in another format resizes the frame, and names stay unique', async () => {
  const workspace = await folder()
  const id = await createProject(workspace, {
    title: 'Launch',
    direction: 'relay',
    format: 'portrait',
  })
  expect(id).toBe('launch')
  const index = await readFile(join(film(workspace, id), 'index.html'), 'utf8')
  expect(index).toContain('data-width="1080"')
  expect(index).toContain('data-height="1920"')
  expect(index).not.toContain('data-width="1920"')
  expect(await createProject(workspace, { title: 'Launch', direction: 'relay' })).toBe('launch-2')
  await expect(createProject(workspace, { title: 'x', direction: 'nope' })).rejects.toMatchObject({
    code: 'invalid',
  })
})

test('restyle swaps tokens and rules; lint reports contract breaks with file names', async () => {
  const workspace = await folder()
  const id = await createProject(workspace, { title: 'Film', direction: 'blackout' })
  const path = film(workspace, id)
  await applyStyle(path, 'field-notes')
  expect(await readFile(join(path, 'DIRECTION.md'), 'utf8')).toContain('# Direction: Field notes')
  expect(await readFile(join(path, 'blocks/style.css'), 'utf8')).toContain('--mk-bg: #f2efe6')
  expect((await readProject(path, id)).style).toBe('field-notes')
  const index = await readFile(join(path, 'index.html'), 'utf8')
  await writeFile(
    join(path, 'index.html'),
    index
      .replace("window.__timelines['main'] = tl", 'tl.to({}, { duration: Math.random() })')
      .replace('data-duration="', 'data-x="'),
  )
  const { issues } = await lintProject(path)
  expect(issues.join('\n')).toContain('Math.random')
  expect(issues.join('\n')).toContain("window.__timelines['main']")
})

test('workspace media import copies files under readable names and refuses escapes', async () => {
  const workspace = await folder()
  const id = await createProject(workspace, { title: 'Film', direction: 'relay' })
  await mkdir(join(workspace, 'shots'))
  await writeFile(join(workspace, 'shots/Hero Shot.png'), new Uint8Array([137, 80, 78, 71]))
  const result = await importAssets(workspace, id, [
    { path: 'shots/Hero Shot.png' },
    { path: 'shots/Hero Shot.png' },
    { path: '/etc/hosts' },
    { path: 'missing.png' },
  ])
  expect(result[0]).toMatchObject({ path: 'assets/Hero-Shot.png' })
  expect(result[1]).toMatchObject({ path: 'assets/Hero-Shot.png' })
  expect(result[2]!.error).toContain('outside this workspace')
  expect(result[3]!.error).toContain('does not exist')
})

test('project files are served only under a valid signature, isolated, with the runtime injected', async () => {
  const workspace = await folder()
  const id = await createProject(workspace, { title: 'Film', direction: 'relay' })
  const app = createMotionRoutes()
  const env = { userId: 'owner', sessionId: 'live', cwd: workspace }
  const base = viewBase('owner', 'live', id).replace('/rpc/motion', '')
  const index = await app.request(`${base}index.html`, {}, env)
  expect(index.status).toBe(200)
  expect(index.headers.get('content-security-policy')).toContain('sandbox')
  expect(index.headers.get('access-control-allow-origin')).toBe('*')
  expect(await index.text()).toContain('hyperframe.runtime.iife.js')
  expect((await app.request(`${base}blocks/motion-kit.js`, {}, env)).status).toBe(200)
  expect((await app.request(`${base}../../package.json`, {}, env)).status).toBe(404)
  const forged = `/view/live/${id}/${'0'.repeat(32)}/index.html`
  expect((await app.request(forged, {}, env)).status).toBe(404)
  expect((await app.request(`${base}index.html`, {}, { ...env, userId: 'other' })).status).toBe(404)
  const sample = await app.request('/directions/blackout/blocks/style.css', {}, env)
  expect(await sample.text()).toContain('--mk-bg')
  expect((await app.request('/directions/blackout/index.html', {}, env)).status).toBe(200)
  expect((await app.request('/directions/nope/index.html', {}, env)).status).toBe(404)
})

test('creating from the view returns the new film; storage refuses escaped folders', async () => {
  const workspace = await folder()
  const app = createMotionRoutes()
  const env = { userId: 'owner', sessionId: 'live', cwd: workspace }
  const created = await app.request(
    '/projects',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'relay' }),
    },
    env,
  )
  const library = await created.json()
  expect(library.focus).toBe('relay')
  expect(library.projects[0].view).toContain('/rpc/motion/view/live/relay/')
  expect((await app.request('/library', {}, { userId: 'owner', cwd: workspace })).status).toBe(409)
  const outside = await folder()
  await writeFile(join(outside, 'index.html'), '<div data-composition-id="main"></div>')
  await symlink(outside, join(workspace, '.localix/motion/escape'))
  expect((await listProjects(workspace)).map((p) => p.id)).toEqual(['relay'])
})

test('the CLI gets the film as an absolute path, never runs inside it', async () => {
  const { cliArgs } = await import('./jobs')
  expect(cliArgs('/w/film', ['snapshot', '.', '--at', '1.00', '--output', 'snapshots'])).toEqual([
    'snapshot',
    '/w/film',
    '--at',
    '1.00',
    '--output',
    '/w/film/snapshots',
  ])
  expect(cliArgs('/w/film', ['lint'])).toEqual(['lint', '/w/film'])
})
