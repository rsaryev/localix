import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pngDimensions } from '../../apps/landing/scripts/build-shots.mjs'
import { capturePlan } from './plan.mjs'
import { captureRoot, repoRoot } from './runtime.mjs'

export async function publishCaptures(runRoot, { repository = repoRoot } = {}) {
  const files = await fs.readdir(runRoot, { recursive: true })
  const captures = []
  for (const file of files.filter((name) => name.endsWith('.png.json'))) {
    const record = JSON.parse(await fs.readFile(path.join(runRoot, file), 'utf8'))
    const spec = capturePlan[record.key]
    const name = `${record.key}--${record.date}.png`
    if (
      !spec ||
      record.passed !== true ||
      !/^\d{4}-\d{2}-\d{2}$/.test(record.date) ||
      file !== `${name}.json`
    ) {
      throw new Error(`Invalid capture evidence: ${file}`)
    }
    const source = path.join(runRoot, name)
    const dimensions = pngDimensions(await fs.readFile(source))
    if (dimensions.width !== 4800 || dimensions.height !== 3000) {
      throw new Error(`${name}: expected a native 4800×3000 capture`)
    }
    captures.push({ ...record, source, name })
  }
  if (!captures.length) throw new Error('No passing capture tests in this run.')
  const nav = JSON.parse(await fs.readFile(path.join(repository, 'docs/public-nav.json'), 'utf8'))
  const guides = nav.sections.flatMap((section) => [
    ...(section.pages ?? []),
    ...(section.categories ?? []).flatMap((category) => category.pages),
  ])
  for (const capture of captures) {
    const target = path.join(repository, 'docs/assets/screenshots', capture.name)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(capture.source, target)
    // Stable semantic names; update dated references only where an author already chose a figure.
    const escaped = capture.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const previous = new RegExp(
      `(assets/screenshots/${escaped})--(?:\\d{4}-\\d{2}-\\d{2}|placeholder)\\.png`,
      'g',
    )
    for (const guide of guides) {
      const file = path.join(repository, 'docs', guide)
      const original = await fs.readFile(file, 'utf8')
      const next = original.replace(previous, `$1--${capture.date}.png`)
      if (next !== original) await fs.writeFile(file, next)
    }
    console.log(`Published ${capture.name}`)
  }
  return captures.map(({ key, date }) => ({ key, date }))
}

if (import.meta.main) {
  let runRoot = process.argv[2]
  if (!runRoot) {
    const run = JSON.parse(await fs.readFile(path.join(captureRoot, 'latest-run.json'), 'utf8'))
    if (!run.passed) throw new Error('The latest test run failed; fix it before publishing.')
    runRoot = run.root
  }
  await publishCaptures(runRoot)
}
