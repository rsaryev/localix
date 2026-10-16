import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Stage the visual-feedback browser probe beside a bundled API server.
 * The server consumes this file directly instead of resolving a workspace package
 * at runtime, so npm/Tauri artifacts remain offline and version-locked.
 */
export function buildVisualFeedbackProbe({ repoRoot, outFile, log = () => {} }) {
  mkdirSync(dirname(outFile), { recursive: true })
  log(`bundling visual-feedback probe → ${outFile}`)
  execFileSync(
    'bun',
    [
      'build',
      join(repoRoot, 'packages', 'visual-feedback', 'src', 'probe', 'entry.ts'),
      '--target=browser',
      '--format=iife',
      '--minify',
      '--outfile',
      outFile,
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  )
}

export function buildNativeBrowserProbe({ repoRoot, outFile, log = () => {} }) {
  mkdirSync(dirname(outFile), { recursive: true })
  log(`bundling native browser probe → ${outFile}`)
  execFileSync(
    'bun',
    [
      'build',
      join(repoRoot, 'packages', 'visual-feedback', 'src', 'probe', 'native-entry.ts'),
      '--target=browser',
      '--format=iife',
      '--minify',
      '--outfile',
      outFile,
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  )
}
