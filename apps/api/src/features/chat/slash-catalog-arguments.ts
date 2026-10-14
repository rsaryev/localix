import { REASONING_EFFORT_OPTIONS } from '@localixai/agent'
import type { SlashArgSpec } from './slash-args'

export const LOOP_ARGS: SlashArgSpec[] = [
  {
    name: 'task',
    type: 'text',
    placeholder: 'What to do — state the cadence in the text, or omit it to self-pace…',
  },
]

/**
 * `/reasoning [@handle] <effort> [task]`. The effort was free text, so the composer offered no
 * levels and a typo reached the handler only to come back as a usage line. The levels, their
 * labels and descriptions are the agent package's one list — the same rows the model picker's
 * reasoning menu draws — so the two surfaces cannot name the scale differently.
 */
export const REASONING_ARGS: SlashArgSpec[] = [
  // The addressee stays optional, as the handler always accepted it (`commandTarget`).
  { name: 'participant', type: 'token', pattern: /^@\S+$/ },
  {
    name: 'effort',
    type: 'choice',
    placeholder: 'Pick a reasoning effort…',
    options: REASONING_EFFORT_OPTIONS.map(({ value, label, description }) => ({
      value,
      label,
      description,
    })),
  },
  { name: 'task', type: 'text', placeholder: 'Optional task to run at this effort…' },
]

export const PLUGIN_ARGS: SlashArgSpec[] = [
  {
    name: 'action',
    type: 'choice',
    placeholder: 'Pick an action…',
    options: [
      { value: 'list', label: 'list', description: 'Show installed plugins' },
      {
        value: 'create',
        label: 'create',
        description: 'Describe a plugin; the agent names, builds and enables it',
      },
      {
        value: 'install',
        label: 'install',
        description: '<name>@<marketplace>, git URL, owner/repo, or local path',
      },
      { value: 'enable', label: 'enable', description: 'Enable a plugin by name' },
      { value: 'disable', label: 'disable', description: 'Disable a plugin by name' },
      { value: 'remove', label: 'remove', description: 'Uninstall a plugin by name' },
      {
        value: 'validate',
        label: 'validate',
        description: 'Check manifests for errors + compatibility warnings',
      },
      {
        value: 'update',
        label: 'update',
        description: 'Re-install a plugin from its original source',
      },
      {
        value: 'details',
        label: 'details',
        description: 'Show full details for one plugin — version, provides, validation',
      },
      {
        value: 'reload',
        label: 'reload',
        description: 'Reload every plugin in place — skills, agents, MCP, commands',
      },
      {
        value: 'marketplace',
        label: 'marketplace',
        description: 'Add / list / remove marketplaces',
      },
    ],
  },
  {
    name: 'msub',
    type: 'choice',
    when: { arg: 'action', equals: 'marketplace' },
    placeholder: 'Pick a marketplace action…',
    options: [
      { value: 'list', label: 'list', description: 'List registered marketplaces' },
      { value: 'add', label: 'add', description: 'Register a marketplace' },
      { value: 'remove', label: 'remove', description: 'Remove a marketplace' },
    ],
  },
  // Everything below is the SECOND argument, split per action instead of the one
  // free-text catch-all it used to be. That catch-all offered `<src> · <name> ·
  // <owner/repo>` under every action, so `/plugin disable` advertised a git URL it
  // cannot take and never offered the installed names it can — the user had to know
  // the exact spelling and type it blind. Each action now declares what it accepts,
  // and the three that name something already installed are `dynamic` combo boxes
  // the composer fills from the live catalog (free text still commits, so a name the
  // list has not loaded yet is never blocked).
  {
    name: 'plugin',
    type: 'choice',
    dynamic: true,
    when: { arg: 'action', equals: ['enable', 'disable', 'remove', 'update', 'details'] },
    placeholder: 'Pick an installed plugin…',
  },
  {
    name: 'target',
    type: 'choice',
    dynamic: true,
    when: { arg: 'action', equals: 'validate' },
    placeholder: 'A plugin, --strict, or Enter for all…',
  },
  {
    name: 'description',
    type: 'text',
    when: { arg: 'action', equals: 'create' },
    placeholder: 'What should the plugin do?',
  },
  {
    name: 'source',
    type: 'choice',
    dynamic: true,
    when: { arg: 'action', equals: 'install' },
    placeholder: 'Pick from a marketplace, or type a git URL / owner/repo / path…',
  },
  {
    name: 'market',
    type: 'choice',
    dynamic: true,
    when: { arg: 'msub', equals: 'remove' },
    placeholder: 'Pick a registered marketplace…',
  },
  // LAST on purpose: `parseCommandArgs` gives only the final spec the whole remainder,
  // and a marketplace source is the one value here that can legitimately contain a
  // space (an absolute path). A plugin name cannot — the manifest regex forbids it.
  {
    name: 'msource',
    type: 'text',
    when: { arg: 'msub', equals: 'add' },
    placeholder: '<owner/repo> · git URL · absolute path',
  },
]
