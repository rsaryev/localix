import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const here = resolve(import.meta.dir)
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')

/**
 * The one bundled UI plugin that had no titlebar item, and the reason it has one now.
 *
 * Documents owns no workspace — it is a set of FILE VIEWERS — so there is nothing here to launch,
 * and a launcher glyph would have been chrome with nothing behind it. What it does own is a fact
 * that is genuinely hard to see: which files are currently inside one of its viewers. A PDF opened
 * into a second grid group, or into a group whose tab strip is scrolled, is open and invisible.
 *
 * The rules below are what keep that from becoming a second file tree in the titlebar.
 */
describe('Documents contributes the one fact its viewers own', () => {
  const item = read('statusItem.ts')
  const register = read('register.tsx')

  test('it is declared, not drawn', () => {
    expect(register).toContain("id: 'documents:open'")
    expect(register).toContain("placement: 'titlebar'")
    expect(register).toContain('useItem: useDocumentsStatusItem')
    // A `.ts` file: there is no JSX to write, which is the cheapest possible proof.
    expect(item).not.toContain('className')
  })

  test('it reads the workspace snapshot and buys nothing', () => {
    // Open tabs are a subscription every contributed item already holds. A plugin that fetched,
    // cached or polled to answer "what is open" would be paying for something it was given.
    expect(item).toContain('usePluginWorkspace()')
    expect(item).not.toContain('setInterval')
    expect(item).not.toContain('setTimeout')
    expect(item).not.toContain('createSharedResource')
    expect(item).not.toContain('api')
  })

  test('the titlebar never pulls a lazy viewer chunk in behind it', () => {
    // `register.tsx` holds the three `lazy()` viewer imports. Importing it from here to share the
    // extension sets would put all three on the eager path the titlebar renders from.
    expect(item).not.toContain("from './register'")
    expect(item).not.toContain('lazy(')
  })

  test('nothing in a viewer means no control at all', () => {
    // The silence rule every bundled item follows: a session that is not reading a document hears
    // nothing from this plugin, rather than getting a glyph that opens an empty menu.
    // Nor without a session: a row opens its file in the item's chat, and there is no other one.
    expect(item).toContain('if (sessionId === null || documents.length === 0) return null')
  })

  test('a row reveals the tab rather than making a second one — in the item’s own chat', () => {
    // Named, not guessed: without `sessionId` the host placed the file in whichever chat was in
    // front, not the one whose titlebar the person clicked.
    expect(item).toContain('pluginWorkspace.openFile({ sessionId, path })')
  })

  test('the list is the shared one, so it cannot truncate silently', () => {
    expect(item).toContain('statusMenuList({')
  })
})
