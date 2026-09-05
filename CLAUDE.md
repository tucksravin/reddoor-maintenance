# CLAUDE.md

Session rules for AI agents working this repo. The autonomy and merge
contract lives in [AUTONOMY.md](AUTONOMY.md) — read it before merging
anything.

## Prove the instrument before you trust its verdict

**A new gate, alarm, check, or probe must be shown to PASS on a known-good
input before any FAIL it produces is reported as a finding.** Until it has
passed at least once, the instrument is the suspect, not the system. A check
that has only ever failed is not evidence — it is an untested assertion.

This is the single rule that would have caught every mistake made on
2026-08-12, and all three had the same shape:

- A CI gate asserting a report carried its ANALYTICS section reported "GA
  credentials did not resolve" twice, with total confidence. It was built on
  `report --preview`, which does no IO at all, so it _could never pass_ however
  good the credentials were. The credentials were fine. (Fixed in #523 — the
  preview path now takes `--enrich`.)
- 18 Renovate PRs sitting green, `CLEAN` and unmerged were called "stuck". 16
  of them contained `@reddoorla/maintenance`, whose packageRule sets
  `automerge: false` — the rule working exactly as designed. The overstated
  claim shipped into the fleet-wide preset before it was caught (.github#28,
  corrected by #29).
- A side-by-side probe answering "does setup-node v7 break npm publish" printed
  its own VERDICT line as "OK" for both versions. That line grepped the wrong
  command. The real answer came from reading the raw output.

Two corollaries, both cheap:

- **Before calling a PR stuck, name the rule that would have to permit the
  merge, and check it.** Under `group:allNonMajor` a single held package makes
  the _entire_ grouped branch non-automergeable. Green + unmerged is far more
  often a rule working than a rule broken.
- **Before building on a flag or mechanism, read its implementation.** Both
  failures above were one file-read away from being avoided.

When the operator asks for evidence rather than a conclusion, that is the
control working — the setup-node v7 probe exists because the question was
asked. Prefer producing a diff over asserting an inference.

## Concurrent sessions

Multiple Claude sessions can be active on this repo and the fleet at the same
time. Two real collisions have already happened (2026-07-08: a concurrent
`/loop` clobbered the main checkout's HEAD; 2026-07-09: a paused session's
checked-out branch received another session's commit, which rode into its
PR's squash). These rules keep separate sessions from corrupting each other's
work:

- **Never commit from the main checkout.** Before your first commit, move to
  your own git worktree (`git worktree add` / EnterWorktree) and work there.
  Treat the main checkout itself as read-only plus human editing.
- **Claim fleet signals before triaging them.** Red nightlies and cockpit
  alarms are visible to every session. Before starting, check the auto-filed
  tracking issue (e.g. "Nightly fleet smoke failing") for an existing claim
  and comment yours. A run that never started files no issue — absence of a
  tracking issue is not absence of a failure.
- **Check targets before dispatching fixes.** Before fixing a site repo, look
  for fresh `fix/*` branches and open or just-merged PRs there — another
  session may already be on it (this is exactly how six duplicate-fix PRs
  nearly double-merged on 2026-07-09).
- **Stay in your charter.** If the operator scoped the session to a problem,
  don't opportunistically pick up other fleet signals without the claim check
  above.
- **Re-verify after any pause.** After a session-limit pause, compaction, or
  long gap: `git log --oneline -3` and `git status` before committing, and
  re-confirm the PR head SHA before merging — the world may have changed
  underneath you.

Individual site repos generally get **one** agent session at a time; the
worktree rule is mandatory here in the central repo and best practice there.

## Before a fleet sweep, ask which repos can receive a push

```sh
scripts/fleet-repos.sh            # table: pushable / ARCHIVED / NO-REMOTE / UNKNOWN
scripts/fleet-repos.sh --pushable # names to iterate
scripts/fleet-repos.sh --skipped  # what to leave alone, and why
```

Three of the 39 checkouts on the operator's machine cannot take a commit:
`reddoor-mailer` and `the-pointe` are **archived** on GitHub, and `rfp-analyze`
has no `origin` at all. Iterate `--pushable` and **report** the rest in the
summary; do not discover them at push time.

**An archived repo is invisible from inside its clone.** `git remote -v` shows a
normal URL, `git ls-remote` succeeds, `git fetch` succeeds — only the push
fails, and only after every commit has already been written. Three separate
sessions have run a fleet-wide change to completion and then found the rollout
short, and at least one of them reported the cause wrongly ("dead remote"),
because from the inside an archived repo and a deleted one are the same picture.

Do not unarchive a repo to finish a sweep. If a change genuinely must land in
one, that is a decision for the operator, not a step in a rollout.

Also note the script maps by REMOTE, not by directory name: the checkout
`welcome-to-the-flower-court` is `tucksravin/invitations`. A sweep that assumes
the two match will address the wrong repository.

## The work journal

**Every working session appends a dated entry to `docs/workJournal.md`** — what
was done and **why**, newest at the bottom, never corrected in place. Write it
as the last act of the session, not the first act of the next one.

The journal is the history of executing the build. Code says what the system
does now; the journal says what it used to do, what it cost to change, and
which beliefs turned out to be wrong. Nearly everything expensive to rediscover
lives there and nowhere else.

An entry is headed with the date, a short title, and where it landed:

```markdown
## 2026-09-04 — Both runway stages render their final frame without JS (#51, `ce46ae0`)
```

Then prose — not a bullet list of file names, which the diff already tells you.
What to put in, in rough order of value:

- **Why, over what.** The reason a thing was done survives; the diff does not
  need restating.
- **Measured numbers, exactly.** "The comp's open mask is 2696×2352 on an 860px
  band — 2.735× the band's height, so a 390×664 phone needs ~534%" is worth
  keeping. "Fixed the hero on mobile" is not.
- **Defects, named.** What broke, what it looked like, and what made it
  invisible until it wasn't.
- **What was tried and abandoned**, and what it would take to revive it. A dead
  end nobody wrote down gets walked twice.
- **Beliefs corrected on contact.** The design assumption that turned out false
  is usually the most valuable line in the entry.
- **Honest accounting.** If a win came from somewhere other than the change
  that claimed it, say so — that is exactly what someone will otherwise
  over-invest in next.

**History is never edited to be right.** An entry that stops being true is not
rewritten; a later entry corrects it, and says which one it corrects. The
journal is a record of what was believed at the time, and that record is most
useful precisely where it was wrong. Fixing the past in place destroys the only
evidence of how the mistake was made.

The one edit an old entry may take is a **forward pointer**: one line directly
under its heading naming the entry that overturned it — `> Superseded in part by
2026-10-14 — <that entry's title>.` It asserts nothing new and retracts nothing,
so the record of what was believed survives whole; it only stops a reader who
lands on the old paragraph from leaving with the old answer. Without it the rule
above is half a mechanism: the correction exists at the bottom of the file, and
nothing points to it from where a reader actually arrives.

If a session produced nothing worth an entry, that is itself worth one line.

## Discord is the tone reference for client comms

When drafting anything client-facing, match how the operator actually writes in
Discord rather than defaulting to formal email register.

**`DISCORD_BOT_KEY` in the repo `.env` IS the bot token.** Use it directly as
`Authorization: Bot $DISCORD_BOT_KEY`. Proven 2026-08-17: `GET /users/@me`
returns 200 as "Message Reader" (`1536468462141055086`), and the same value
fails an OAuth2 `client_credentials` grant with `invalid_client` — so it is a
bot token, not a client secret.

An older memory claims `DISCORD_BOT_KEY` is the OAuth2 client secret and names
a `DISCORD_BOT_TOKEN` as the real one. That is WRONG — no `DISCORD_BOT_TOKEN`
exists in `.env`, the keychain, or the shell. Do not go hunting for it.

Note the creds live in the repo `.env`, NOT in
`~/.config/reddoor-maint/credentials.env` where every other credential lives.

- Guild: **reddoor creative**, `1199077765144662046` — 109 text channels, one
  per project (`#sonder`, `#hedloc-web`, `#beachfront-dentistry-website`, …).
- Plain REST at `https://discord.com/api/v10`; e.g.
  `GET /channels/{id}/messages?limit=N`. There is no MCP server and no script —
  curl it. `discord.com` is off the sandbox network allowlist, so run via
  `ctx_execute` or unsandboxed.
- Do NOT read Discord through the browser: `discord.com` in the local Chrome
  profile is logged out, and logging in as the operator is not yours to do.

**Know who is internal before drafting anything.** The project channels contain
Reddoor staff AND clients. In `#sonder`, `timholmes_62898` and `nicole_35266`
are internal and **Josh** is the client — a note "for Tim" is a colleague note,
not a client email. Read enough of the channel to place people before writing
in anyone's voice.

## Two starter templates (since 2026-08-31)

- `reddoorla/reddoor-starter` — the **native** template; default for
  `/new-site`. No Blux code.
- `reddoorla/reddoor-starter-blux` — the **Blux track**: a full-history
  snapshot of the native repo at `82d93b0` that keeps the Blux render layer.
  It is the render mirror `src/blux` targets and the template for
  `/new-site <slug> --track blux`. Forward-merge only (`git merge starter/main`
  in that repo); never merge it back.

Design: `docs/superpowers/specs/2026-08-31-starter-track-split-design.md`.

## In flight: the Airtable → Turso migration

Scheduled for the weekend of 2026-08-22. Pinned as issue #539. Design and plan
are on branch `docs/airtable-to-turso-spec` under `docs/superpowers/`.

Do not start it early or opportunistically. The Airtable quota was raised on
2026-08-17, so nothing about it is urgent, and the operator explicitly deferred
it to conserve tokens.
