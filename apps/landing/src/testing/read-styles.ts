import { readFileSync } from 'node:fs'

/** Read the landing CSS in cascade order for source-level layout contracts. */
export function readLandingStyles(): string {
  const entry = new URL('../styles.css', import.meta.url)
  const source = readFileSync(entry, 'utf8')
  const parts = [...source.matchAll(/@import '\.\/styles\/([^']+)';/g)].map((match) =>
    readFileSync(new URL(`../styles/${match[1]}`, import.meta.url), 'utf8'),
  )
  return [source, ...parts].join('\n')
}
