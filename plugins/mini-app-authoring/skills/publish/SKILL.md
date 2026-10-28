---
name: publish
description:
  Share a Localix mini app with other people — its source in a GitHub repository whose workflow
  checks it and releases a catalog on each version tag — and ship updates to it. Use when the person
  wants to share, publish, release or update a mini app for others.
argument-hint: '[mini app folder]'
allowed-tools: Bash(mini-app:*)
---

# Publish a mini app

People install shared mini apps from a **catalog**: `mini-app-catalog.json` beside one archive per
app and its store media, in one HTTPS folder. Localix lists every catalog a person has added in its
mini app store.

The catalog is built by GitHub, not on this computer. The app's repository holds its source, and the
workflow `mini-app ci` writes checks every push. A tag `v<version>` (the version in `mini-app.json`)
makes it release the catalog, built with the toolchain and kit of the Localix the app was made with.
Its address never changes:
`https://github.com/<owner>/<repo>/releases/latest/download/mini-app-catalog.json`.

## Steps

The mini app is `$ARGUMENTS`, or the one in the current folder. Make each choice that has a default
yourself and name it at the end. Ask the person one thing only: the confirmation in step 4.

1. **Who and what.** The publisher is the GitHub login (`gh api user --jq .login`). Without `gh`, or
   signed out, skip to [Without GitHub](#without-github). For an update, raise `version` in
   `mini-app.json`: patch for fixes, minor for new things. Installed copies update by version alone,
   so new content under the same version reaches no one.
2. **Set it up and check it.** Run both before anything leaves the computer:

   ```bash
   mini-app ci <folder> --publisher "<login>"
   mini-app check <folder>
   ```

   `mini-app ci` writes `.github/workflows/mini-app.yml`, adds what the checks generate
   (`tsconfig.json`, `KIT.md`, `dist/`) to `.gitignore`, and keeps the publisher as `author`. Fix
   whatever the check reports. Before a **first** release, start the `mini-app-reviewer` agent in
   the background while you do this, and fix what it finds before step 5.

3. **Its own repository.** The app gets a repository of its own, never a commit in the project
   around it. Run `git -C <folder> rev-parse --show-toplevel`:
   - It fails: run `git -C <folder> init -b main`.
   - It prints the app folder itself: that is the app's repository.
   - It prints any other folder: the app sits inside another repository (often the person's
     project). Stop: committing there, or `gh repo create --source`, would publish that project. Say
     so, and offer to move the app to a folder of its own first.

   Then `git -C <folder> add -A` and commit with the message `Release v<version>`.

4. **Confirm, once.** Before the first push, ask: "Create the public repository `<login>/<name>`
   with Meal Log's source and release v0.1.0?" (use the real names). For an app whose repository
   already exists, ask only whether to release v<version>.
5. **Push and tag.**
   - First release:
     `gh repo create <name> --public --source <folder> --push --description "<description>"`
   - Later releases: `git -C <folder> push`.

   Then tag the version: `git -C <folder> tag v<version> && git -C <folder> push origin v<version>`.

6. **Watch the release.** Wait for the tag's run:

   ```bash
   gh run list --repo <owner>/<repo> --workflow mini-app.yml --event push --limit 1 --json databaseId --jq '.[0].databaseId'
   gh run watch <id> --repo <owner>/<repo> --exit-status
   ```

   If the run failed, read `gh run view <id> --repo <owner>/<repo> --log-failed` and fix the cause.
   Then move the tag to the fix with `git tag -f v<version>` and `git push -f origin v<version>`; no
   release exists yet, so nobody has that version.

7. **Give the address**, and the link that opens Localix's **Add catalog** dialog filled in:
   `localix://ui/work-item/mini-app-store/add-catalog?url=<encoded address>`. Others can also use
   the store's catalog menu → **Add catalog…**, or `/mini-app catalog add <address>`.

## Without GitHub

Run `mini-app pack <folder> --publisher "<name>"`. It checks and builds the app into
`<folder>/dist/catalog`. Say that every file there goes into one HTTPS folder, and that
`/mini-app-authoring:publish` with the GitHub CLI signed in (`gh auth login`) does all of this,
updates included.

## What to tell the person

- A catalog's publisher shows as unverified; only the hosted Localix catalog verifies publishers.
  Installing from an unverified publisher asks **Install anyway?**.
- Installed copies take a newer version within six hours, or at once with Update. The next release
  is a raised `version`, a commit, and a tag `v<version>`: GitHub builds the rest.
- After updating Localix, run `mini-app ci` again: the workflow then builds with the new release.
- Raising `apiVersion` in `mini-app.json` makes an older Localix list the app as needing an update.
