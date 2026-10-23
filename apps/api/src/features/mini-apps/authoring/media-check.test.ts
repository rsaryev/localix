import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { formatMiniAppCheck } from './check'
import { checkMiniAppStoreMedia } from './media-check'

const root = tempDirPerTest('mini-app-media-check-')
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect/></svg>'

async function app(manifest: Record<string, unknown>, files: Record<string, string> = {}) {
  const dir = join(root(), 'notes')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    join(dir, 'mini-app.json'),
    JSON.stringify({ name: 'notes', version: '0.1.0', description: 'Notes', ...manifest }),
  )
  for (const [path, body] of Object.entries(files)) {
    await fs.mkdir(join(dir, path, '..'), { recursive: true })
    await fs.writeFile(join(dir, path), body)
  }
  return dir
}

describe('the store media step of the authoring check', () => {
  test('an app with a square icon passes', async () => {
    expect(
      await checkMiniAppStoreMedia(await app({ icon: './icon.svg' }, { 'icon.svg': ICON })),
    ).toEqual([])
  })

  test('an app with no icon, or a screenshot that is not there, is told what to fix', async () => {
    const problems = await checkMiniAppStoreMedia(
      await app({ screenshots: [{ path: './screenshots/main.png' }] }),
    )
    expect(problems).toEqual([
      'mini-app.json declares no "icon"; a published mini app needs one (an .svg, or a square .png of at least 512×512)',
      'The screenshot ./screenshots/main.png is not in the mini app folder',
    ])
  })

  test('reads like every other step in the report the agent and the chat see', async () => {
    const problems = await checkMiniAppStoreMedia(await app({ icon: './icon.gif' }))
    const text = formatMiniAppCheck('notes', {
      ok: false,
      published: true,
      steps: [{ title: 'store media', ok: false, problems }],
    })
    expect(text).toContain('- store media: FAILED')
    expect(text).toContain('The icon ./icon.gif is a .gif; use .svg, .png, .ico or .webp')
  })
})
