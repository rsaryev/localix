#!/bin/sh
# Brings the template's updates into a site made from it: fetches the template and merges it.
# What is the site's own (content/, public/, README.md: see .gitattributes) is never overwritten:
# where both sides changed such a file, the site's version is kept.
set -eu
cd "$(dirname "$0")/.."

url=$(node -p "require('./package.json').sitekit.template")
branch=$(node -p "require('./package.json').sitekit.branch")

if [ -n "$(git status --porcelain)" ]; then
  echo "sync: commit or stash your changes first" >&2
  exit 1
fi
if ! git remote get-url template >/dev/null 2>&1; then
  git remote add template "$url"
fi
if [ "$(git remote get-url origin 2>/dev/null || true)" = "$(git remote get-url template)" ]; then
  echo "sync: this is the template itself; there is nothing to sync from" >&2
  exit 1
fi

# The driver .gitattributes names: "keep ours" for the site's own files.
git config merge.ours.driver true
git fetch template "$branch"

before=$(git rev-parse HEAD)
if ! git merge --no-edit -m "Sync with the template" "template/$branch"; then
  echo >&2
  echo "sync: the template changed a file this site changed too (listed above)." >&2
  echo "      Resolve it, then: git commit, npm install, npm run check" >&2
  exit 1
fi
if [ "$before" = "$(git rev-parse HEAD)" ]; then
  echo "sync: already up to date"
  exit 0
fi
npm install
npm run check
echo "sync: merged $(git rev-parse --short "template/$branch"); CHANGELOG.md says what changed"
