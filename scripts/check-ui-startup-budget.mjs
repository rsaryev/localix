#!/usr/bin/env bun
/**
 * Ratchet the bytes and request fan-out needed before the UI can paint.
 *
 * The generated index is authoritative: it names the entry module, every static
 * modulepreload, and the startup stylesheet after Rolldown has finished sharing
 * chunks. Dynamic imports are intentionally excluded because they load only when
 * their surface opens.
 *
 * NOTE on the file count. It measures REQUESTS, so it moves for two unrelated
 * reasons: work genuinely added to startup, and Rolldown splitting bytes startup
 * already paid for into more chunks. A leaf module shared between the shell and a
 * lazy chunk becomes its own chunk the startup document then preloads, which is
 * why ~100 sub-1 kB lucide icons once accounted for a third of this number (see
 * the `startup-icons` group in `apps/ui/vite.config.ts`). Read a regression here
 * against `measureUiStartup().assets`, not by assuming new work was added.
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, statSync } from 'node:fs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const UI_STARTUP_BUDGET = Object.freeze({
  maxFiles: 269,
  // The current UI build needs 2_005_896 startup bytes; retain a small margin for build variation.
  maxBytes: 2_050_000,
})

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'))?.[1] ?? null
}

/** Return the unique local files fetched by the generated startup document. */
export function startupAssetPaths(html) {
  const paths = new Set()
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const isScript = /^<script\b/i.test(tag)
    const rel = attribute(tag, 'rel')?.toLowerCase()
    const url = isScript ? attribute(tag, 'src') : attribute(tag, 'href')
    if (!url?.startsWith('/assets/')) continue
    if (!isScript && rel !== 'modulepreload' && rel !== 'stylesheet') continue
    paths.add(url.slice(1))
  }
  return [...paths]
}

const isExternalNetworkUrl = (url) => /^(?:https?:)?\/\//i.test(url)

/** External requests that would make the production shell depend on internet access. */
export function externalStartupUrls(html, stylesheetContents = []) {
  const urls = new Set()
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const isScript = /^<script\b/i.test(tag)
    const rel = attribute(tag, 'rel')?.toLowerCase()
    if (!isScript && rel !== 'modulepreload' && rel !== 'stylesheet') continue
    const url = isScript ? attribute(tag, 'src') : attribute(tag, 'href')
    if (url && isExternalNetworkUrl(url)) urls.add(url)
  }
  for (const css of stylesheetContents) {
    for (const match of css.matchAll(/url\(\s*['"]?((?:https?:)?\/\/[^)'"\s]+)[^)]*\)/gi)) {
      urls.add(match[1])
    }
    for (const match of css.matchAll(/@import\s+(?:url\(\s*)?['"]((?:https?:)?\/\/[^'"]+)/gi)) {
      urls.add(match[1])
    }
  }
  return [...urls]
}

export function measureUiStartup(distDir = join(repoRoot, 'apps/ui/dist')) {
  const indexPath = join(distDir, 'index.html')
  const html = readFileSync(indexPath, 'utf8')
  const assets = startupAssetPaths(html)
  const stylesheetContents = assets
    .filter((asset) => asset.endsWith('.css'))
    .map((asset) => readFileSync(join(distDir, asset), 'utf8'))
  const externalUrls = externalStartupUrls(html, stylesheetContents)
  const bytes =
    Buffer.byteLength(html) +
    assets.reduce((total, asset) => total + statSync(join(distDir, asset)).size, 0)
  return { files: assets.length + 1, bytes, assets, externalUrls }
}

export function checkUiStartupBudget(measurement, budget = UI_STARTUP_BUDGET) {
  const violations = []
  if (measurement.files > budget.maxFiles) {
    violations.push(`${measurement.files} startup files exceeds ${budget.maxFiles}`)
  }
  if (measurement.bytes > budget.maxBytes) {
    violations.push(`${measurement.bytes} startup bytes exceeds ${budget.maxBytes}`)
  }
  if (measurement.externalUrls?.length > 0) {
    violations.push(`startup requires external network: ${measurement.externalUrls.join(', ')}`)
  }
  return violations
}

if (import.meta.main) {
  const measurement = measureUiStartup()
  const violations = checkUiStartupBudget(measurement)
  if (violations.length > 0) {
    throw new Error(`[ui-startup-budget] ${violations.join('; ')}`)
  }
  console.log(
    `[ui-startup-budget] ${measurement.files}/${UI_STARTUP_BUDGET.maxFiles} files, ` +
      `${measurement.bytes}/${UI_STARTUP_BUDGET.maxBytes} bytes, ` +
      `${measurement.externalUrls.length} external startup URLs`,
  )
}
