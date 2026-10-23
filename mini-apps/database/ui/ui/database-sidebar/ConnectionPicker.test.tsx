import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DbConnectionInfo } from '../../dbClient'
import { ConnectionPicker } from './ConnectionPicker'

const connections: DbConnectionInfo[] = [
  {
    id: 'primary',
    name: 'Production',
    dialect: 'postgres',
    connected: true,
    readonly: true,
    createdAt: 1,
  },
  {
    id: 'local',
    name: 'Local cache',
    dialect: 'redis',
    connected: false,
    readonly: false,
    createdAt: 2,
  },
]

describe('ConnectionPicker', () => {
  test('shows the active connection, status, badges and an accessible switcher', () => {
    const html = renderToStaticMarkup(
      <ConnectionPicker
        connections={connections}
        selected={connections[0]!}
        reconnecting={{}}
        editing={null}
        setEditing={() => {}}
        commitRename={() => {}}
        onPick={() => {}}
        onEditConfig={() => {}}
        onRemove={() => {}}
      />,
    )

    expect(html).toContain('Production')
    expect(html).toContain('Connected')
    expect(html).toContain('RO')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('role="combobox"')
    expect(html).toContain('aria-label="Active database connection"')
    expect(html).toContain('aria-label="Connection actions"')
  })

  test('surfaces the connecting state without losing the current selection', () => {
    const html = renderToStaticMarkup(
      <ConnectionPicker
        connections={connections}
        selected={connections[1]!}
        reconnecting={{ local: true }}
        editing={null}
        setEditing={() => {}}
        commitRename={() => {}}
        onPick={() => {}}
        onEditConfig={() => {}}
        onRemove={() => {}}
      />,
    )

    expect(html).toContain('Local cache')
    expect(html).toContain('Connecting')
    expect(html).toContain('lx-activity-orb')
  })
})
