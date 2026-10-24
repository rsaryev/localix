# Localix mini apps

A Claude Code plugin that teaches an agent to build Localix mini apps: Localix's own application
format, with screens, a native backend, agent tools, a guide and commands. The plugin is only
instructions; it contains no mini app and no Localix code.

## What it adds

| Part                         | What it does                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Skill `build-mini-app`       | The structure of a mini app, its manifest, backend, screens, store media, tests and packing |
| `/localix-mini-apps:new`     | Start a mini app from the template                                                          |
| `/localix-mini-apps:check`   | Run its tests and type checks                                                               |
| `/localix-mini-apps:build`   | Build it and pick up the change                                                             |
| `/localix-mini-apps:pack`    | Pack it into a catalog                                                                      |
| `/localix-mini-apps:publish` | Host the catalog and ship updates                                                           |

Each command works inside Localix, through its `mini_app_build` tool and `/mini-app` command, and in
plain Claude Code in a checkout of the Localix repository, through the repository's scripts.

## Install

In Localix it is built in and on by default.

In Claude Code:

```bash
claude plugin marketplace add rsaryev/localix
claude plugin install localix-mini-apps@localix
```

## Learn more

- [Build a mini app](https://github.com/rsaryev/localix/blob/main/docs/extending/mini-apps.md)
- [Build with the agent](https://github.com/rsaryev/localix/blob/main/docs/extending/build-with-the-agent.md)
- [Publish a mini app](https://github.com/rsaryev/localix/blob/main/docs/extending/mini-app-publishing.md)
