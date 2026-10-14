import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * The kit stylesheet as ONE text, with every local `@import` inlined in place.
 *
 * `styles/index.css` is a list of imports, one file per layer (tokens, themes, materials, motion,
 * …). A test that pins a CSS rule must not care which layer the rule lives in: reading the index
 * alone would find nothing, and pointing each test at one layer file would break the test every
 * time a rule moved between layers without changing a single declaration. Inlining in import order
 * reproduces exactly the cascade the build sees, so a test that orders two rules ("the glass block
 * precedes the base layer") still reads them in shipped order.
 *
 * The app's stylesheet is `tailwindcss`, its fonts and this file, so an app test that pins a
 * design-system rule reads the same text here; the kit never reads a path of the app's.
 */
export function readKitStylesheet(): string {
  return inline(resolve(import.meta.dir, '../../styles/index.css'))
}

const LOCAL_IMPORT = /^@import\s+(['"])(\.[^'"]+)\1;$/gmu

function inline(file: string): string {
  const text = readFileSync(file, 'utf8')
  return text.replace(LOCAL_IMPORT, (_statement, _quote, specifier: string) =>
    inline(resolve(dirname(file), specifier)),
  )
}
