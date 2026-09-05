#!/usr/bin/env bash
#
# Which local checkouts can actually receive a push.
#
# Run this BEFORE any sweep that commits to more than one repository. The
# failure it exists to prevent is not subtle and has happened in three separate
# sessions: a fleet-wide change is written, committed in every checkout, and
# only then does `git push` reveal that some of those repositories are archived
# on GitHub and reject writes. The work is done, the commits are stranded, and
# the session reports a rollout short by however many repos it was — or, worse,
# reports the reason wrongly, because from inside a clone an archived repo and a
# deleted one look identical.
#
# Archived is invisible locally. `git remote -v` shows a normal URL,
# `git ls-remote` succeeds, `git fetch` succeeds. Only a push fails, and only
# after everything else has already happened.
#
#   scripts/fleet-repos.sh              # table of every checkout
#   scripts/fleet-repos.sh --pushable   # names only, one per line, for a loop
#   scripts/fleet-repos.sh --skipped    # what a sweep must leave alone, and why
#
# One `gh repo list` per owner rather than one `gh repo view` per repo: three
# API calls instead of thirty-nine, which is the difference between running it
# every time and not bothering.
#
# Written for bash 3.2, which is what macOS ships as /bin/bash — no associative
# arrays, hence the tab-separated temp files.

set -uo pipefail

ROOT="${FLEET_ROOT:-$HOME/Documents/GitHub}"
MODE="${1:-table}"

command -v gh >/dev/null || {
  echo "fleet-repos: gh is not installed" >&2
  exit 1
}
cd "$ROOT" 2>/dev/null || {
  echo "fleet-repos: no such directory: $ROOT" >&2
  exit 1
}

work=$(mktemp -d) || exit 1
trap 'rm -rf "$work"' EXIT
local_repos="$work/local"   # dir <TAB> owner/name ("" when there is no origin)
remote_repos="$work/remote" # owner/name <TAB> true|false

: >"$local_repos"
for d in */; do
  r="${d%/}"
  [ -d "$r/.git" ] || continue
  url=$(git -C "$r" remote get-url origin 2>/dev/null) || url=""
  # git@host:owner/name.git and https://host/owner/name(.git) both reduce here.
  slug=""
  [ -n "$url" ] && slug=$(printf '%s' "$url" | sed -E 's#\.git$##; s#.*[:/]([^/]+/[^/]+)$#\1#')
  printf '%s\t%s\n' "$r" "$slug" >>"$local_repos"
done

# One listing per distinct owner. `--limit 500` because a truncated listing
# would mark a real repo UNKNOWN, which is the same failure in a quieter
# costume.
: >"$remote_repos"
cut -f2 "$local_repos" | grep -v '^$' | cut -d/ -f1 | sort -u | while read -r owner; do
  gh repo list "$owner" --limit 500 --json nameWithOwner,isArchived \
    --jq '.[] | [.nameWithOwner, (.isArchived|tostring)] | @tsv' 2>/dev/null
done >>"$remote_repos"

state_of() {
  if [ -z "$1" ]; then
    echo "NO-REMOTE"
    return
  fi
  row=$(grep -F "$(printf '%s\t' "$1")" "$remote_repos" | head -1)
  case "$row" in
  # Not in the owner's listing: a fork, another account, or no access. Never
  # assumed pushable — a sweep should look before writing to it.
  "") echo "UNKNOWN" ;;
  *$'\t'true) echo "ARCHIVED" ;;
  *) echo "pushable" ;;
  esac
}

total=0
skipped=0
[ "$MODE" = "table" ] && printf '%-32s %-10s %s\n' REPO STATE REMOTE
while IFS=$'\t' read -r dir slug; do
  total=$((total + 1))
  state=$(state_of "$slug")
  [ "$state" != "pushable" ] && skipped=$((skipped + 1))
  case "$MODE" in
  --pushable) [ "$state" = "pushable" ] && echo "$dir" ;;
  --skipped) [ "$state" != "pushable" ] && printf '%s\t%s\t%s\n' "$dir" "$state" "${slug:--}" ;;
  --table | table) printf '%-32s %-10s %s\n' "$dir" "$state" "${slug:--}" ;;
  *)
    echo "usage: fleet-repos.sh [--table|--pushable|--skipped]" >&2
    exit 2
    ;;
  esac
done <"$local_repos"

if [ "$MODE" = "table" ] || [ "$MODE" = "--table" ]; then
  echo
  echo "$total checkouts, $skipped cannot receive a push."
  echo "A sweep iterates --pushable and REPORTS the rest; it does not discover them at push time."
fi
