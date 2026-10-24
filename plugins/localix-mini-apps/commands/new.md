---
description: Start a new Localix mini app from the template
argument-hint: <what it should do>
---

Create a new Localix mini app that does this: $ARGUMENTS

Use the `build-mini-app` skill for the format. If no description was given, ask for one first.

## Inside Localix

When the `mini_app_build` tool is available, call it with a lower-kebab-case `name`, a `title`
people see, and `description`: one English sentence on what the app does. A `description` always
creates a new app; a taken name gets a free one, so use the name the result returns. The host forks
the template into `~/.localix/mini-apps/<name>`, enables it and builds it.

Then replace the template's System Overview domain with this one: the tools, the store under
`ctx.dataDir`, the routes, the screens in `ui/register.tsx`, tests and `guide.md`. Leave the
manifest's `backend` alone. Call `mini_app_build` again with only the `name` (never the
`description`, which would create another copy) and fix what it reports until every check passes.
When the `browser` tool is available, open `mini-app:<name>`, take a screenshot and use the
interface; otherwise say that visual and interaction checks were not run.

The person can start the same flow with `/mini-app create <what it should do>`.

## In a checkout of the Localix repository

1. Copy `mini-apps/template` to `mini-apps/<name>`.
2. In `mini-app.json`, set `name`, `displayName`, `description`, `category` and `author`, and start
   `version` at `0.1.0`.
3. Read `mini-apps/template/scaffold.json`. Apply its `renames` (with `{name}` as lower-kebab,
   `{snake}` as lower_snake and `{displayName}`), and rename the files it lists under `domain` and
   `domainNamedPaths`. Read each `patterns` entry at its anchor before replacing that file. Keep the
   frame files byte for byte, as `mini-apps/template/AGENTS.md` describes.
4. Replace the system domain with this one, keeping the shapes: a store under `ctx.dataDir`, routes
   that answer with the new state, tools for the agent, and a `guide.md` that tells the agent how to
   read what the app shows. Remove every `domainTokens` identifier left from the template.
5. Draw the app's own `icon.svg` on the same tile and replace `screenshots/`.
6. Check it with `/localix-mini-apps:check <name>`.
