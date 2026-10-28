import type { SlashArgSpec } from './slash-args'

const SERVER = ['reconnect', 'enable', 'disable']

/** `/mcp [list | reconnect <server> | enable <server|all> | disable <server|all>]`. */
export const MCP_ARGS: SlashArgSpec[] = [
  {
    name: 'action',
    type: 'choice',
    placeholder: 'Pick an action…',
    optional: true,
    options: [
      { value: 'list', label: 'list', description: 'Show servers grouped by where they come from' },
      {
        value: 'reconnect',
        label: 'reconnect',
        description: 'Close a server’s connection and connect again',
      },
      { value: 'enable', label: 'enable', description: 'Switch a server, or all, on' },
      { value: 'disable', label: 'disable', description: 'Switch a server, or all, off' },
    ],
  },
  {
    name: 'server',
    type: 'text',
    placeholder: 'Server name (a plugin’s is plugin:<plugin>:<server>)…',
    when: { arg: 'action', equals: SERVER },
  },
]
