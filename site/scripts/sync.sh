#!/bin/sh
# Brings the template's updates into a site made from it.
#
# A site at the root of its own repository merges the template's history. What is the site's own
# (content/, public/, README.md: see .gitattributes) is never overwritten: where both sides changed
# such a file, the site's version is kept.
#
# A site in a folder of a larger repository (site/ in a product's repository) cannot merge a history
# that is not its repository's. It takes the template's changes since the template commit its
# package.json names as sitekit.synced, to the template's half only, as a three-way patch on its own
# files, and moves sitekit.synced on. CHANGELOG.md is left out there: a site in a folder keeps the
# product's changelog under that name.
set -eu
cd "$(dirname "$0")/.."

url=$(node -p "require('./package.json').sitekit.template")
branch=$(node -p "require('./package.json').sitekit.branch")
prefix=$(git rev-parse --show-prefix)

if [ -n "$(git status --porcelain -- .)" ]; then
  echo "sync: commit or stash this site's changes first" >&2
  exit 1
fi
if ! git remote get-url template >/dev/null 2>&1; then
  git remote add template "$url"
fi
if [ "$(git remote get-url origin 2>/dev/null || true)" = "$(git remote get-url template)" ]; then
  echo "sync: this is the template itself; there is nothing to sync from" >&2
  exit 1
fi

install() {
  if [ -f bun.lock ] || [ -f bun.lockb ]; then bun install; else npm install; fi
}

git fetch template "$branch"
new=$(git rev-parse "template/$branch")

if [ -z "$prefix" ]; then
  # The driver .gitattributes names: "keep ours" for the site's own files.
  git config merge.ours.driver true
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
  install
  npm run check
  echo "sync: merged $(git rev-parse --short "$new"); CHANGELOG.md says what changed"
  exit 0
fi

base=$(node -p "require('./package.json').sitekit.synced || ''")
if [ -z "$base" ]; then
  echo "sync: this site is in ${prefix%/}/ of a larger repository, and its package.json names no" >&2
  echo "      sitekit.synced: the template commit it last took. Set it, then sync again." >&2
  exit 1
fi
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  echo "sync: sitekit.synced, $base, is not a commit of the template" >&2
  exit 1
fi
if [ "$(git rev-parse "$base^{commit}")" = "$new" ]; then
  echo "sync: already up to date"
  exit 0
fi

# Paths below are the template's, from its root, whatever folder this site sits in.
own=$(sed -n 's/^\([^#[:space:]][^[:space:]]*\)[[:space:]].*merge=ours.*/\1/p' .gitattributes)

# The site's own files, as the root merge treats them: one the template added, changed or removed
# follows the template where this site never changed it, and stays as it is where it did. First,
# so a stop on the patch below leaves only the patch to resolve.
set --
for path in $own; do set -- "$@" ":(top,glob)$path"; done
git diff --name-status --no-renames "$base" "$new" -- "$@" | while IFS="$(printf '\t')" read -r status path; do
  if [ "$status" = A ]; then
    if [ ! -e "$path" ]; then mkdir -p "$(dirname "$path")"; git show "$new:$path" > "$path"; fi
  elif [ -e "$path" ] && [ "$(git hash-object "$path")" = "$(git rev-parse "$base:$path")" ]; then
    if [ "$status" = D ]; then rm "$path"; else git show "$new:$path" > "$path"; fi
  fi
done

# The template's half: its changes as a three-way patch, so this site's own edits to those files
# stay, and a change both sides made to the same lines stops the sync with both marked. Left out:
# CHANGELOG.md, the template's workflows (GitHub reads only the repository's own, at its root) and
# a lockfile this site does not use.
set -- ':(top)' ':(top,exclude)CHANGELOG.md' ':(top,exclude).github'
[ -f package-lock.json ] || set -- "$@" ':(top,exclude)package-lock.json'
for path in $own; do set -- "$@" ":(top,exclude,glob)$path"; done
patch=$(mktemp)
trap 'rm -f "$patch"' EXIT
git diff --binary --full-index "$base" "$new" -- "$@" > "$patch"
top=$(git rev-parse --show-toplevel)
if [ -s "$patch" ] && ! (cd "$top" && git apply --3way --directory="${prefix%/}" "$patch"); then
  echo >&2
  echo "sync: the template changed lines this site changed too (marked above)." >&2
  echo "      Resolve them, set sitekit.synced to $new, then: git add, install, npm run check, git commit" >&2
  exit 1
fi
node -e "
  const fs = require('fs'); const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  p.sitekit.synced = process.argv[1];
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
" "$new"
install
npm run check
git add -A -- .
git commit -q -m "site: sync with the template ($(git rev-parse --short "$new"))" \
  -m "$(git log --format='- %s' "$base..$new")"
echo "sync: took the template's changes to $(git rev-parse --short "$new"):"
git log --format='  %h %s' "$base..$new"
