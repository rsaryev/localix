import { test, expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { Input, BufferSource, ALL_FORMATS } from 'mediabunny'
import { createTemplateDocument } from '../../plugins/motion/shared/templates.ts'
import { layerSchema } from '../../plugins/motion/shared/schema.ts'
import { retimeScene } from '../../plugins/motion/shared/retime-scene.ts'
import { fixtureFile, uiOrigin, verifyDemoRuntime } from './runtime.mjs'
import { motionApi as api } from './motion-workbench.mjs'
import { openTool } from './scenarios.mjs'

function audioFixture() {
  const rate = 48000
  const frames = rate * 2
  const buffer = Buffer.alloc(44 + frames * 2)
  buffer.write('RIFF')
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(frames * 2, 40)
  for (let i = 0; i < frames; i++)
    buffer.writeInt16LE(Math.round(Math.sin((i / rate) * Math.PI * 880) * 4000), 44 + i * 2)
  return buffer
}
test.beforeAll(verifyDemoRuntime)
for (const format of ['mp4', 'webm']) {
  test(`motion/export-${format}`, async ({ page }, testInfo) => {
    const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.sessionId}`)
    await page.getByRole('button', { name: 'Add participant', exact: true }).waitFor()
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 32
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#df3a3a'
      ctx.fillRect(0, 0, 32, 32)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    const imageState = await api('/motion/assets', {
      name: 'Export fixture.png',
      mime: 'image/png',
      base64: png,
    })
    const image = imageState.assets.at(-1)
    const audioState = await api('/motion/assets', {
      name: 'Export fixture.wav',
      mime: 'audio/wav',
      base64: audioFixture().toString('base64'),
    })
    const audio = audioState.assets.at(-1)
    const document = createTemplateDocument('launch', `Encoding fixture ${format}`)
    document.format = 'square'
    document.soundtrackId = audio.id
    document.scenes = [
      { ...retimeScene(document.scenes[1], 2), headline: 'Render evidence', imageId: image.id },
    ]
    document.scenes[0].layers = [
      layerSchema.parse({
        id: crypto.randomUUID(),
        kind: 'rectangle',
        width: 0.12,
        height: 0.08,
        keyframes: [
          { time: 0, x: 0.15, y: 0.9, opacity: 0, scale: 0 },
          { time: 0.8, x: 0.15, y: 0.9 },
        ],
      }),
    ]
    const created = await api('/motion/projects', {
      template: 'launch',
      title: document.title,
      document,
    })
    const project = created.projects.at(-1)
    try {
      await openTool(page, 'Motion Studio')
      await page
        .getByRole('button', { name: new RegExp(`Encoding fixture ${format}.*Product`) })
        .click()
      await page.getByRole('button', { name: '1080p', exact: true }).click()
      await page.getByRole('menuitemradio', { name: '720p', exact: true }).click()
      if (format === 'webm') {
        await page.getByRole('button', { name: 'MP4', exact: true }).click()
        await page.getByRole('menuitemradio', { name: 'WEBM', exact: true }).click()
      }
      const downloaded = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Export video', exact: true }).click()
      const download = await downloaded
      expect(download.suggestedFilename()).toBe(`${document.title}.${format}`)
      const path = testInfo.outputPath(`evidence.${format}`)
      await download.saveAs(path)
      const bytes = await fs.readFile(path)
      const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS })
      try {
        const video = await input.getPrimaryVideoTrack()
        const sound = await input.getPrimaryAudioTrack()
        expect(await video.getDisplayWidth()).toBe(720)
        expect(await video.getDisplayHeight()).toBe(720)
        expect(await video.computeDuration()).toBeCloseTo(2, 2)
        expect(await sound.getCodec()).toBe(format === 'mp4' ? 'aac' : 'opus')
        expect(await sound.computeDuration()).toBeGreaterThanOrEqual(1.9)
      } finally {
        input.dispose()
      }
      // Decode an actual exported frame with the browser and verify the uploaded image survived.
      const decoded = await page.evaluate(
        async ({ base64, mime }) => {
          const video = document.createElement('video')
          const url = URL.createObjectURL(
            new Blob([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], { type: mime }),
          )
          try {
            video.src = url
            video.muted = true
            video.preload = 'auto'
            await new Promise((resolve, reject) => {
              video.onloadeddata = resolve
              video.onerror = reject
            })
            video.currentTime = 1.2
            await new Promise((resolve) => {
              video.onseeked = resolve
            })
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 720
            const ctx = canvas.getContext('2d')
            ctx.drawImage(video, 0, 0)
            const sample = Array.from(ctx.getImageData(525, 300, 1, 1).data)
            const layer = Array.from(ctx.getImageData(108, 648, 1, 1).data)
            return { duration: video.duration, sample, layer }
          } finally {
            URL.revokeObjectURL(url)
            video.src = ''
            video.load()
          }
        },
        { base64: bytes.toString('base64'), mime: format === 'mp4' ? 'video/mp4' : 'video/webm' },
      )
      // Video samples end at exactly 2s (asserted above); the audio encoder may pad its last packet.
      expect(decoded.duration).toBeGreaterThanOrEqual(2)
      expect(decoded.duration).toBeLessThan(2.1)
      expect(decoded.sample[0]).toBeGreaterThan(190)
      expect(decoded.sample[1]).toBeLessThan(100)
      expect(decoded.sample[2]).toBeLessThan(100)
      expect(decoded.layer.slice(0, 3).every((channel) => channel > 200)).toBe(true)
      expect(errors).toEqual([])
      await testInfo.attach(`encoded-${format}`, {
        path,
        contentType: format === 'mp4' ? 'video/mp4' : 'video/webm',
      })
    } finally {
      const current = (await api('/motion/library')).projects.find((item) => item.id === project.id)
      if (current)
        await api(`/motion/projects/${project.id}`, { revision: current.revision }, 'DELETE')
      await api(`/motion/assets/${image.id}`, {}, 'DELETE')
      await api(`/motion/assets/${audio.id}`, {}, 'DELETE')
    }
  })
}
