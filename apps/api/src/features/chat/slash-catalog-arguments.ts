import type { SlashArgSpec } from './slash-args'

export const LOOP_ARGS: SlashArgSpec[] = [
  {
    name: 'task',
    type: 'text',
    placeholder: 'What to do — state the cadence in the text, or omit it to self-pace…',
  },
]

export const PLUGIN_ARGS: SlashArgSpec[] = [
  {
    name: 'action',
    type: 'choice',
    placeholder: 'Pick an action…',
    options: [
      { value: 'list', label: 'list', description: 'Show installed plugins' },
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
        description: 'Reload every plugin in place — skills, agents, MCP, commands, hooks',
      },
      {
        value: 'marketplace',
        label: 'marketplace',
        description: 'Add / list / update / remove marketplaces',
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
      { value: 'update', label: 'update', description: 'Refresh a marketplace and its plugins' },
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
    placeholder: '<owner/repo> · git URL · marketplace.json URL · path',
  },
]

export const MINI_APP_ARGS: SlashArgSpec[] = [
  {
    name: 'action',
    type: 'choice',
    placeholder: 'Pick an action…',
    options: [
      { value: 'list', label: 'list', description: 'Show installed mini apps' },
      {
        value: 'create',
        label: 'create',
        description: 'Describe a mini app; the agent names, builds and enables it',
      },
      { value: 'enable', label: 'enable', description: 'Turn a mini app on by name' },
      { value: 'disable', label: 'disable', description: 'Turn a mini app off by name' },
      { value: 'remove', label: 'remove', description: 'Remove one of your own mini apps' },
      {
        value: 'reload',
        label: 'reload',
        description: 'Rebuild your own mini apps and reload every mini app in place',
      },
    ],
  },
  {
    name: 'app',
    type: 'choice',
    dynamic: true,
    when: { arg: 'action', equals: ['enable', 'disable', 'remove'] },
    placeholder: 'Pick an installed mini app…',
  },
  {
    name: 'description',
    type: 'text',
    when: { arg: 'action', equals: 'create' },
    placeholder: 'What should the mini app do?',
  },
]
