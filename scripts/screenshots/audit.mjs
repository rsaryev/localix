import { promises as fs } from 'node:fs'
import path from 'node:path'
import { captureRoot, repoRoot } from './runtime.mjs'
import { capturePlan, retainedShots, archiveOnly } from './plan.mjs'
import { pngDimensions } from '../../apps/landing/scripts/build-shots.mjs'

const shotsRoot = path.join(repoRoot, 'docs/assets/screenshots')
const files = (await fs.readdir(shotsRoot, { recursive: true })).filter((file) =>
  /--\d{4}-\d{2}-\d{2}\.png$/.test(file),
)
const current = new Map()
for (const file of files.sort().reverse()) {
  const key = file
    .replace(/--\d{4}-\d{2}-\d{2}\.png$/, '')
    .split(path.sep)
    .join('/')
  if (!current.has(key)) current.set(key, file)
}
const rows = []
for (const [key, file] of current) {
  const dimensions = pngDimensions(await fs.readFile(path.join(shotsRoot, file)))
  rows.push({
    key,
    file,
    ...dimensions,
    use: archiveOnly.includes(key)
      ? 'archive'
      : capturePlan[key]?.guide || retainedShots[key] || 'review placement',
  })
}
const escape = (text) =>
  String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
await fs.mkdir(captureRoot, { recursive: true })
const output = path.join(captureRoot, 'audit.html')
const cards = await Promise.all(
  rows.map(async (row) => {
    const bytes = await fs.readFile(path.join(shotsRoot, row.file))
    return `<figure><a href="data:image/png;base64,${bytes.toString('base64')}" target="_blank"><img src="data:image/png;base64,${bytes.toString('base64')}" alt="${escape(row.key)}"></a><figcaption>${escape(row.key)} · ${row.width}×${row.height}<br>${escape(row.use)}</figcaption></figure>`
  }),
)
await fs.writeFile(
  output,
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>Localix capture audit</title><style>body{background:#070707;color:#eee;font:14px system-ui;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:24px}figure{margin:0}img{width:100%;height:auto}figcaption{padding:8px 0;color:#aaa}</style><h1>Current captures and placement</h1><main>${cards.join('\n')}</main></html>`,
)
console.table(rows)
console.log(`Visual audit: ${output}`)
