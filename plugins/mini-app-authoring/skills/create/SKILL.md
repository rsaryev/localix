---
name: create
description:
  Create a Localix mini app — a screen, a backend and agent tools that run inside Localix — from a
  description of what it should do, then build it, check it and install it. Use when the person asks
  for a new mini app, a Localix app, a tracker, a dashboard, a workbench panel or a tool for
  Localix.
argument-hint: <what the mini app should do>
allowed-tools: Bash(mini-app:*)
---

# Create a Localix mini app

A **mini app** is Localix's own application format: a screen for the person, a native backend and
tools the chat agent calls. It is not a Claude Code plugin; never put `.claude-plugin/`, `skills/`
or hooks in one.

The request: $ARGUMENTS

## Steps

1. Choose a lower-kebab-case name (`meal-log`), a title people see and a one-sentence description
   from the request. If the request is empty, ask what the app should do.
2. Create it in the current project unless the person named a folder:

   ```bash
   mini-app create <name> --title "<Title>" --description "<what it does>"
   ```

   Add `--dir <folder>` to put it elsewhere. The command copies the reference mini app (Daily Log:
   entries the agent logs, a goal, a chart) from the mini app kit of the person's Localix, checks
   the copy, and prints the instruction for turning it into the requested app, with the whole SDK
   contract.

3. Follow that printed instruction in its order: read the patterns, decide the data and the screen,
   write `shared/model.ts` first, then the rest in one batch, test, draw the icon with
   `mini-app icon`, then `mini-app check <folder>` until every check passes. After each edit this
   plugin's hook reports what in that file breaks Localix's rules: fix it right away.
4. Install it with `mini-app install <folder>`. When Localix is not installed, run
   `mini-app build <folder>` instead and say that `/mini-app-authoring:get-localix` installs
   Localix, after which `mini-app install <folder>` puts the app in.
5. Tell the person where it is (Localix's workspace overflow menu, under the app's title), what to
   say or attach in the chat to use it, and the defaults you chose. Offer the next steps, and to
   share it with `/mini-app-authoring:publish`.

## Rules

- Deliver a working, good-looking app in one turn: from `mini-app create` to an installed app you
  have looked at, without ending your turn in between. Build the smallest version that does what was
  asked, on real data; extras come after the person has it. Make the choices that have a sensible
  default and name them at the end; ask only what no default can answer.
- Do the work yourself. A subagent started before `shared/model.ts` exists builds against a contract
  that is not there, and steering it costs more than writing the files. The `mini-app-reviewer`
  agent is for before the app is shared — never a gate on installing it.
- Work only inside the mini app's folder. What `mini-app create` prints is everything you need:
  don't read `AGENTS.md` now (it repeats that message for later sessions), search `KIT.md` for the
  job of a control the printed digest lacks rather than reading it whole, and never search the disk
  for SDK or kit sources.
- A mini app's backend runs unsandboxed inside Localix, and an installed one starts enabled: keep
  each tool honest about what it changes.
- Never edit `dist/`, `tsconfig.json` or `KIT.md`: the checks rewrite them.
- Write and change files with the file tools (Write, Edit). A heredoc, `sed -i` or an inline script
  that writes a file can be refused by the permission checks, and each refusal costs a turn.
