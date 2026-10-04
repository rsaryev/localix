/**
 * Pure detector for the semantic plugin boundary. The repository check supplies
 * identities discovered from real plugin registrations; this module knows only
 * categories and matching rules, so its complete pipeline can be mutation-tested.
 */

export function regexAlternation(values) {
  const escaped = [...new Set(values)]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .sort((left, right) => left.localeCompare(right))
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
  return escaped.length > 0 ? escaped.join('|') : '(?!)'
}

function exactIdentityReference(source, values, owners) {
  for (const value of new Set(values)) {
    const identity = regexAlternation([value])
    for (const owner of owners) {
      const pattern = new RegExp(
        `\\b${owner}\\b[^\\n]{0,100}(?:={1,3}|:|\\.includes\\()\\s*['"]${identity}['"]`,
        'iu',
      )
      if (pattern.test(source)) return value
    }
  }
  return undefined
}

export function createPluginIdentityGuard(catalog) {
  const toolPattern = new RegExp(`\\b(?:${regexAlternation(catalog.toolNames)})\\b`, 'u')
  const slashCommandPattern = new RegExp(
    `(["'\`])/(?:${regexAlternation(catalog.commandNames)})\\1`,
    'u',
  )
  const agentPattern = new RegExp(`\\b(?:${regexAlternation(catalog.agentNames)})\\b`, 'u')
  const backendPattern = new RegExp(`\\b(?:${regexAlternation(catalog.backendSubsystems)})\\b`, 'u')
  const uiPattern = new RegExp(`(['"])(?:${regexAlternation(catalog.uiContributionIds)})\\1`, 'u')
  const resourcePattern = new RegExp(
    `localix:\\/\\/resource\\/(?:${regexAlternation(catalog.resourceProviders)})(?:\\/|\\b)`,
    'u',
  )
  const contextProviderPattern = new RegExp(
    `\\b(?:${regexAlternation(catalog.contextProviders)})\\b`,
    'u',
  )
  const searchProviderPattern = new RegExp(
    `\\b(?:${regexAlternation(catalog.searchProviders)})\\b`,
    'u',
  )
  const routePattern = new RegExp(`(?:${regexAlternation(catalog.routeMounts)})(?:\\/|\\b)`, 'u')
  const websocketPattern = new RegExp(`\\b(?:${regexAlternation(catalog.wsCommands)})\\b`, 'u')
  const pluginOwnedNamespacePattern = new RegExp(
    `["'\`](?:${regexAlternation(catalog.pluginNames)}):`,
    'u',
  )

  const embeddedPluginIdentityPattern = new RegExp(
    `(?:plugin|channel):(?:${regexAlternation(catalog.pluginNames)})(?=[^A-Za-z0-9_-]|$)|` +
      `(?:plugin-|[?&]id=)(?:${regexAlternation(catalog.pluginNames)})(?=[^A-Za-z0-9_-]|$)|` +
      `mcp_(?:_plugin_)?(?:${regexAlternation(catalog.pluginNames)})_`,
    'u',
  )

  function inspect(path, source) {
    const findings = []
    const concreteTool = source.match(toolPattern)?.[0]
    if (concreteTool) {
      findings.push(
        `${path}: production core names concrete plugin tool "${concreteTool}"; ` +
          'consume descriptor metadata or a generic SDK result contract instead',
      )
    }
    const concreteCommand = source.match(slashCommandPattern)?.[0]
    if (concreteCommand) {
      findings.push(
        `${path}: core names concrete plugin command "${concreteCommand}"; ` +
          'consume the command descriptor supplied by plugin discovery',
      )
    }
    const concreteAgent = source.match(agentPattern)?.[0]
    if (concreteAgent) {
      findings.push(
        `${path}: core names concrete plugin agent "${concreteAgent}"; ` +
          'consume the namespaced agent descriptor supplied by plugin discovery',
      )
    }

    const rawChecks = [
      [backendPattern, 'backend subsystem', 'compose BackendSubsystem descriptors generically'],
      [resourcePattern, 'resource namespace', 'treat provider URIs as opaque SDK values'],
      [
        contextProviderPattern,
        'provider',
        'consume provider descriptors and opaque provider IDs instead',
      ],
      [searchProviderPattern, 'search provider', 'consume registered SearchProvider metadata'],
      [
        routePattern,
        'route',
        'mount and consume plugin routes through generic registration metadata instead',
      ],
      [
        websocketPattern,
        'websocket command',
        'dispatch contributed streams through the generic registry',
      ],
    ]
    for (const [pattern, kind, remedy] of rawChecks) {
      const identity = source.match(pattern)?.[0]
      if (identity) {
        findings.push(
          `${path}: production core names concrete plugin ${String(kind)} ` +
            `"${identity}"; ${String(remedy)}`,
        )
      }
    }

    const contextualChecks = [
      [
        catalog.channelNames,
        ['channel', 'channelName', 'channelId'],
        'channel',
        'consume registered channel descriptors',
      ],
      [
        catalog.pluginNames,
        ['plugin', 'pluginName', 'pluginId'],
        'bundled plugin',
        'use manifest metadata and generic plugin lifecycle APIs',
      ],
    ]
    for (const [values, owners, kind, remedy] of contextualChecks) {
      const identity = exactIdentityReference(source, values, owners)
      if (identity) {
        findings.push(
          `${path}: production core branches on ${String(kind)} "${identity}"; ${String(remedy)}`,
        )
      }
    }

    const concreteUi = source.match(uiPattern)?.[0]
    if (concreteUi) {
      findings.push(
        `${path}: production core branches on plugin UI contribution "${concreteUi}"; ` +
          'consume PluginUiHost registry metadata',
      )
    }
    const concreteNamespace = source.match(pluginOwnedNamespacePattern)?.[0]
    if (concreteNamespace) {
      findings.push(
        `${path}: production core names plugin-owned namespace "${concreteNamespace.slice(1)}"; ` +
          'treat contributed identities as opaque registry values',
      )
    }
    const embeddedIdentity = source.match(embeddedPluginIdentityPattern)?.[0]
    if (embeddedIdentity) {
      findings.push(
        `${path}: core embeds bundled plugin identity "${embeddedIdentity}" in a protocol value; ` +
          'use a synthetic fixture or consume the opaque value from plugin metadata',
      )
    }
    return findings
  }

  return { inspect }
}

export function pluginUiNamespaceProblems(contributions) {
  return contributions.flatMap(({ id, path, pluginName }) =>
    id.startsWith(`${pluginName}:`)
      ? []
      : [`${path}: plugin UI contribution "${id}" is not namespaced by owner "${pluginName}:"`],
  )
}
