---
name: create
description:
  Create a Localix mini app — screens, a backend and agent tools that run inside Localix — from a
  description of what it should do, then build it out, check it and install it. Use when the person
  asks for a new mini app, a Localix app, a workbench panel or tool for Localix.
argument-hint: <what the mini app should do>
allowed-tools: Bash(mini-app:*)
---

# Create a Localix mini app

A **mini app** is Localix's own application format: screens for the person, a native backend, agent
tools, a `guide.md` for the agent and commands. It is not a Claude Code plugin; never put
`.claude-plugin/`, `skills/` or hooks in one. The `reference` skill of this plugin describes the
format in full.

The request: $ARGUMENTS

## Steps

1. Choose a lower-kebab-case name (`gpu-monitor`), a title people see and a one-sentence description
   from the request. If the request is empty, ask what the app should do.
2. Create it in the current project unless the person named a folder:

   ```bash
   mini-app create <name> --title "<Title>" --description "<what it does>"
   ```

   Add `--dir <folder>` to put it elsewhere. The command forks the reference mini app from the mini
   app kit of the person's Localix (or of the latest Localix release when Localix is not installed),
   checks the fresh copy, and prints the instruction for turning it into the requested app.

3. Follow that printed instruction exactly, in its order: read the entries, replace the template's
   domain, write tests, then `mini-app check <folder>` until every check passes. After each edit
   this plugin's hook reports what in that file breaks Localix's rules: fix it right away.
4. Install it with `mini-app install <folder>`. When Localix is not installed, run
   `mini-app build <folder>` instead and tell the person that `/mini-app-authoring:get-localix`
   installs Localix, after which `mini-app install <folder>` puts the app in.
5. Tell the person where it is: Localix's workspace overflow menu, under the app's title, and the
   defaults you chose. Offer the next steps the printed instruction names, and to share it with
   `/mini-app-authoring:publish`.

## Rules

- Deliver a working prototype in one turn: from `mini-app create` to an installed app you have
  looked at, without ending your turn in between. Build the smallest version that does what was
  asked, on real data; extras come after the person has it. Make the choices that have a sensible
  default and name them at the end; ask only what no default can answer, then carry on. Never hold
  the install for a review: the `mini-app-reviewer` agent is for before the app is shared.
- Work only inside the mini app's folder. The kit's `KIT.md` and `AGENTS.md` there are written for
  you; read them instead of searching the disk for SDK or kit sources.
- A mini app's backend runs unsandboxed inside Localix, and an installed one starts enabled: keep
  each tool honest about what it changes.
- Never edit `dist/`: it is rebuilt by every `mini-app build`.
- Write and change files with the file tools (Write, Edit). A heredoc, `sed -i` or an inline script
  that writes a file can be refused by the permission checks, and each refusal costs a turn.
