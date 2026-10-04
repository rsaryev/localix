import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { PluginsSidebar } from './PluginsSidebar'
import type { RailEntry } from './shellTypes'

const source = readFileSync(new URL('./PluginsSidebar.tsx', import.meta.url), 'utf8')

const entry = (id: string, label = id): RailEntry => ({
  id,
  label,
  icon: <span />,
  active: false,
  onClick: () => {},
  plugin: true,
  pluginName: id,
})

describe('PluginsSidebar', () => {
  test('lists one openable row per plugin view', () => {
    const html = renderToStaticMarkup(
      <PluginsSidebar entries={[entry('rows', 'Rows'), entry('git', 'Git')]} />,
    )

    expect(html).toContain('Rows')
    expect(html).toContain('Git')
    expect(html).toContain('Plugins')
  })

  test('groups by manifest category and keeps older plugins under Other', () => {
    const html = renderToStaticMarkup(
      <PluginsSidebar
        entries={[
          entry('puzzle', 'Puzzle'),
          entry('rows', 'Rows'),
          entry('third-party', 'Custom View'),
          entry('git', 'Git'),
        ]}
        categories={
          new Map([
            ['puzzle', 'games'],
            ['rows', 'data'],
            ['git', 'development'],
          ])
        }
      />,
    )
    expect(html.indexOf('Development')).toBeLessThan(html.indexOf('Git'))
    expect(html.indexOf('Data')).toBeLessThan(html.indexOf('Rows'))
    expect(html.indexOf('Games')).toBeLessThan(html.indexOf('Puzzle'))
    expect(html.indexOf('Other')).toBeLessThan(html.indexOf('Custom View'))
    expect(html.indexOf('Development')).toBeLessThan(html.indexOf('Data'))
    expect(html.indexOf('Data')).toBeLessThan(html.indexOf('Games'))
  })

  test('a still-loading panel is distinguishable from an empty one', () => {
    // The registries fail closed, so a plugin view is invisible until the API publishes the
    // enabled set. Rendering "nothing here" during that window is a lie that settles itself.
    expect(renderToStaticMarkup(<PluginsSidebar pending entries={[]} />)).toContain(
      'Loading plugins',
    )
    expect(renderToStaticMarkup(<PluginsSidebar entries={[]} />)).toContain(
      'No plugin views are available',
    )
  })

  test('the filter appears only once the list is long enough to need it', () => {
    const short = renderToStaticMarkup(<PluginsSidebar entries={[entry('a')]} />)
    const long = renderToStaticMarkup(
      <PluginsSidebar
        entries={Array.from({ length: 9 }, (_, index) => entry(`plugin-${index}`))}
      />,
    )

    expect(short).not.toContain('Filter')
    expect(long).toContain('Filter')
  })

  test('it is a launcher, not a second Capabilities screen', () => {
    // This panel used to carry every plugin's switch, the whole built-in tool catalog and
    // flat Agents / MCP / Skills groups — Settings again, in a rail with no scope picker to
    // say WHICH scope was being switched. Availability is decided there; reaching a view is
    // decided here. A switch reappearing in this file is that duplication coming back.
    // Keyed on the JSX tag and the prop, not on the word: the doc comment above the
    // component explains why the switches left, and a bare substring test would read
    // that explanation as the offence it describes.
    expect(source).not.toContain('<Switch')
    expect(source).not.toContain('onToggle=')
    expect(source).not.toContain('<CollapsibleSection')
    // Manage stays: the one link from the launcher to the screen that does own the switches.
    expect(source).toContain('manageUri')
  })
})
