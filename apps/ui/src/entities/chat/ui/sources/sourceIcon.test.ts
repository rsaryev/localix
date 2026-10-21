import { describe, expect, test } from 'bun:test'
import { Braces, Database, FileText, Globe2, MessagesSquare } from 'lucide-react'

import type { AgentSource } from '@localixai/agent/agents'
import { httpHref, sourceIcon } from './SourceRow'

/**
 * The evidence list groups rows by kind and used to render one identical link glyph for all of them,
 * throwing away the distinction the grouping is built on.
 */
const source = (kind: string, uri: string): AgentSource =>
  ({ id: 'x', kind, title: 't', uri, role: 'consulted', status: 'available' }) as AgentSource

const iconFor = (kind: string, uri: string) => sourceIcon(source(kind, uri), httpHref(uri))

describe('sourceIcon', () => {
  test('scheme wins: every web kind the research tool publishes is a globe', () => {
    // `ResearchSourceType` is web | academic | code | community | encyclopedia, and all five arrive
    // as http(s). Keying on kind alone would give `code` a braces glyph and call a web page a symbol.
    for (const kind of ['web', 'academic', 'code', 'community', 'encyclopedia']) {
      expect(iconFor(kind, 'https://example.com/a')).toBe(Globe2)
    }
  })

  test('application resources take their glyph from the shared ref registry', () => {
    expect(iconFor('session', 'localix://ui/work-item/chat?session=S1')).toBe(MessagesSquare)
    expect(iconFor('resource', 'localix://resource/plugin/thing')).toBe(Database)
  })

  test('the two kinds provenance has that context refs do not', () => {
    expect(iconFor('document', 'localix://ui/work-item/file?path=a.pdf')).toBe(FileText)
    expect(iconFor('symbol', 'localix://ui/work-item/file?path=a.ts&line=4')).toBe(Braces)
  })

  test('an unknown plugin kind still gets a glyph rather than nothing', () => {
    // The vocabulary is open — plugins and MCP servers mint their own — so the fallback has to be
    // total. `refKindIcon` answers for anything.
    expect(iconFor('fixture_record', 'localix://resource/fixture/1')).toBeDefined()
  })
})
