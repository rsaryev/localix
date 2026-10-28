---
name: reference
description:
  The Localix mini app format and SDK — collections, agent tools, the screen, settings, tests,
  decisions, semantic search, waking the agent, store media. Load when writing or changing any part
  of a Localix mini app.
user-invocable: false
allowed-tools: Bash(mini-app contract) Bash(${CLAUDE_PLUGIN_ROOT}/bin/mini-app contract)
---

# The Localix mini app format

A **mini app** is Localix's own application format: screens for the person, a native backend, agent
tools over Localix's APIs, a guide for the agent and commands with pickers. It is not a Claude Code
plugin, and the two share nothing: never put `.claude-plugin/`, `skills/` or hooks in a mini app,
and never put `mini-app.json` in a plugin.

**Trust:** a mini app's backend runs unsandboxed in the Localix API process, and an installed one
starts enabled, so keep its tools honest about their effects.

The toolchain is the `mini-app` command: `create`, `check`, `build`, `install`, `pack`, `validate`,
`icon`, `ci` (release from GitHub), `contract`. Inside a mini app made by `mini-app create`,
`AGENTS.md` and `KIT.md` describe that app and every module of the host kit.

## The folder

```text
my-app/
  mini-app.json        name, version, apiVersion, category, backend, settings (config), commands
  guide.md             what the agent needs to know to use the app
  icon.svg             the app's icon in the store, the rail and its Mac app
  shared/model.ts      schemas and the logic the backend and the screen share
  backend/index.ts     register(ctx): createMiniApp, collections, routes, tools
  backend/<items>.ts   a collection: defineCollection({ … })
  backend/tools.ts     the agent's tools
  ui/register.tsx      the screen's registration: screenUi({ … })
  ui/App.tsx, ui/parts the screen
```

## The contract

This is the SDK contract every mini app is written against — the same text `mini-app create` prints.
If it does not appear below, run `mini-app contract` and read it before writing code.

!`${CLAUDE_PLUGIN_ROOT}/bin/mini-app contract`

## More

- [format.md](format.md) — `mini-app.json` field by field, `guide.md`, slash commands, store media.
- [recipes.md](recipes.md) — logging from a photo, a setting, tests, one state per chat, a button
  that wakes the agent, a choice the app makes itself, ordering by meaning.
- The contract of every call is the SDK's `.d.ts` files named by the `paths` of the app's generated
  `tsconfig.json`; read and search them before hand-rolling anything.
- Localix's guides: https://github.com/rsaryev/localix/tree/main/docs/extending — `mini-apps.md`,
  `mini-app-ui.md`, `mini-app-semantics.md` and `mini-app-publishing.md`.
