import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * `bun run start` (`bin/localix`): the API serving a built UI from one port. It imported
 * `src/index.ts`, whose start sits behind `import.meta.main`, which is false for an import — so the
 * launcher printed nothing and exited 0 without ever listening.
 */
const homes: string[] = []
const children: Bun.Subprocess[] = []
afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL')
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

test.skipIf(process.platform === 'win32')(
  'bin/localix starts the API and serves the UI',
  async () => {
    const home = mkdtempSync(join(tmpdir(), 'localix-bin-'))
    homes.push(home)
    const ui = join(home, 'ui')
    mkdirSync(ui)
    writeFileSync(join(ui, 'index.html'), '<!doctype html><title>bin-localix</title>')
    const child = Bun.spawn([process.execPath, join(import.meta.dir, '../bin/localix')], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        PORT: '0',
        HOST: '127.0.0.1',
        NODE_ENV: 'production',
        LOCALIX_DB_FILE: join(home, '.localix', 'localix.db'),
        LOCALIX_UI_DIR: ui,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    children.push(child)

    let output = ''
    const decoder = new TextDecoder()
    // A reader, not `for await`: breaking out of that cancels the pipe, and the server's next log
    // line then kills it.
    const reader = child.stdout.getReader()
    while (!output.includes('"event":"server.started"')) {
      const { done, value } = await reader.read()
      if (done) break
      output += decoder.decode(value)
    }
    const started = output.split('\n').find((line) => line.includes('"event":"server.started"'))
    expect(
      started,
      `${output}\n${child.exitCode === null ? '' : await new Response(child.stderr).text()}`,
    ).toBeDefined()

    const { port } = JSON.parse(started!.slice(started!.indexOf('{'))) as { port: number }
    const page = await fetch(`http://127.0.0.1:${port}/`)
    expect(await page.text()).toContain('bin-localix')
  },
  30_000,
)
