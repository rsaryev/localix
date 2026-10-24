# Store

The Store is where you find, install, update and remove what Localix can add: mini apps and Claude
Code plugins, from Localix's own sources and from Anthropic's official and community plugin
marketplaces. Use this page to see where its packages come from, how its search works, and what
happens before anything is installed.

## What you can do

| Outcome                            | How                                                                 | Boundary                                                                  |
| ---------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Open the Store                     | The rail's **+**, **Open the Store** in Settings, or the palette    | It opens in one tab of its own.                                           |
| Browse plugins                     | The **Plugins** shelf, or a capability shelf such as **Skills**     | Every plugin of every marketplace you have, one card per package.         |
| Search everything                  | The search field at the top of the Store                            | Finds by words and, once the built-in model is ready, by meaning.         |
| Find a package from anywhere       | Type in the search palette: a **Store** group follows what you have | At most five packages you have not installed; Enter opens its Store page. |
| See what a plugin adds and runs    | Open its card; **Permissions** shows its plan                       | A plugin from another repository is fetched once to read it.              |
| Install a plugin                   | **Install** on its card or page                                     | A community plugin, or one that runs programs, asks for your yes first.   |
| Add or remove a plugin marketplace | Store → **Sources**                                                 | One you remove from the defaults is not added back.                       |

## How it works

### Where packages come from

A fresh profile starts with these sources, registered for browsing only: nothing from them is
installed or switched on.

| Source                                | Trust     | Shown as                                                |
| ------------------------------------- | --------- | ------------------------------------------------------- |
| The Localix mini app catalog          | Localix   | Localix's mini apps; its picks reach **Discover**.      |
| The `localix` plugin marketplace      | Localix   | Localix's own plugins; its picks reach **Discover**.    |
| `anthropics/claude-plugins-official`  | Official  | Anthropic's reviewed plugins.                           |
| `anthropics/claude-plugins-community` | Community | Plugins by their authors; Localix does not review them. |

A marketplace you add yourself counts as community. One that is already registered, by you or by
your Claude Code settings, is reused rather than added twice. With
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set, none is fetched. The Store fetches its sources again
every six hours.

When two sources list the same package (the same repository and folder, or the same npm name), it
shows once, under the more trusted source, and its page says where else it is listed.

### Search

The Store's search and the palette ask the same search. Words are matched in each package's name,
tags, description and contents, and a name that says what you typed comes first. While the built-in
embedding model is ready, packages are found by meaning too, so "kubernetes" also finds a plugin
that deploys Helm charts. Among equally good matches, Localix's own come before official ones, and
official before community ones. The open project counts too: a TypeScript project sees its language
servers first.

### Before an install

A plugin's page lists what it adds (skills, commands, agents, hooks, servers) and its plan lists
what runs on your computer: hooks, a mod, a local MCP or language server, programs in `bin/`. A
plugin from a community marketplace, or one that runs programs, installs only after you say yes to
its plan. **User** installs it for you everywhere; **Project** for the open project only.

A plugin whose files live in another repository says "unknown" until its page is opened: Localix
fetches it then, reads what it contains, and the install that follows uses that fetch.

## Limits

- No ratings, reviews or install counts: Localix has no server to hold them.
- A community plugin's contents are unknown until its page has been opened once.
- Search by meaning needs the built-in embedding model; until it is ready, search is by words.

## Related guides

- [Mini apps](mini-apps.md)
- [Claude Code plugins](../extending/claude-code-plugins.md)
- [Built-in plugins and updates](../extending/plugin-updates.md)
- [Semantic search](semantic-search.md)

## Source of truth

- [Store feature](https://github.com/rsaryev/localix/tree/main/apps/api/src/features/store)
- [Default sources](https://github.com/rsaryev/localix/blob/main/packages/store/src/default-sources.ts)
- [Plugins in the Store](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/store-provider.ts)
