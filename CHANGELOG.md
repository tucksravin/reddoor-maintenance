# @reddoorla/maintenance

## 0.94.0

### Minor Changes

- f8741db: `Turnstile widget` is now earned by a browser. The column moves from the `function-health` audit to `form-e2e`.

  `function-health` could only ever see whether `PUBLIC_TURNSTILE_SITE_KEY` was a non-empty string — `/health` never contacts Cloudflare — so it could not tell a working widget from one whose hostname is not on the widget's allowlist. That state throws `110200`, mints no token, and on a `Require Turnstile` site buckets 100% of real leads (#689).

  `form-e2e` can: it already drives Chromium against each site's live contact form, and — contrary to what the docs claimed until today — it does **not** swap the sitekey, so the site's real widget renders with its real key on every nightly run. It now watches for the rejection and writes the verdict:

  | observation                                       | verdict                 |
  | ------------------------------------------------- | ----------------------- |
  | `/health` reports no sitekey                      | `fail`                  |
  | uncaught `110200` on the live page                | `fail`                  |
  | mount point **and** a 2xx for Cloudflare's api.js | `pass`                  |
  | key set, no widget on the page                    | `null` (clears)         |
  | the sitekey is invalid, deleted or disabled       | `null` (clears)         |
  | the probe never opened a browser                  | `null` (clears)         |
  | the audit had no opinion at all                   | key omitted (preserves) |

  `pass` means "deployed and not mis-hostnamed", not "a human can solve it" — no driven browser can establish that, since Cloudflare answers automation with `600010` regardless of configuration. The matchers are anchored on Cloudflare's own `[Cloudflare Turnstile]` prefix so a page that merely prints those six digits cannot raise a red alarm.

  It is deliberately **positive evidence** on both halves. The mount point alone proves only that the env var is set — the starter server-renders that div from `{#if turnstileSiteKey}` — so `pass` also requires Cloudflare's script to have answered 2xx; and "no `110200`" alone is not enough, because a sitekey deleted or rotated at Cloudflare still serves api.js and still SSRs its mount point while minting nothing. Any other error Cloudflare raises against the sitekey therefore denies the green — the rest of `110xxx` by prefix, so a future code fails safe, plus `400020` and `400070`, because Cloudflare's table files "invalid sitekey" under both families and "sitekey disabled" only under the second. It does not raise a red: only `110200` has been measured verbatim here, and an alarm on the fleet's one gated site should not rest on an unmeasured string. That asymmetry is what makes matching a family by prefix safe: over-matching costs one empty cell for a night, under-matching costs leads.

  Two properties worth stating because both are load-bearing:

  - **The cron order forced the move.** `function-health` runs 08:00, the digest reads 09:23, `form-e2e` writes 10:15 — with both writing, `function-health`'s null would clear every browser verdict each morning before the red alarm ever saw one. Ownership is pinned from both sides by tests.
  - **Absent ≠ null.** A run with no opinion omits the key and preserves the prior verdict; only a run that looked and could not tell writes null and clears the cell. Collapsing them would let a probe that cannot see Turnstile erase a real verdict.

  The `testMode`-undeclared skip refreshes **no stamp** — `Form E2E OK` and `Form E2E checked at` are both left alone, because carrying a Turnstile verdict on a refreshed form stamp would make a stale form verdict look fresh to the report health gate (`auto-tick.ts` `formsEvidence`). It does write `Turnstile widget: null`, clearing the value `function-health` left in that column: the column has moved, so no other writer could ever correct it, and a legacy verdict nothing is measuring is exactly what this change exists to stop. Those sites are then honestly unverified, and `docs/runbooks/require-turnstile-rollout.md` gains the matching precondition — roll out testMode forwarding before checking `Require Turnstile`.

### Patch Changes

- a831939: A site's `url` is editable from the console. It was writable only at creation, and nowhere after.

  `url` is the target **every** deployed audit drives — the inventory exposes it as `Site.deployedUrl`, so function-health, lighthouse, browser, domain and form-e2e all resolve against it. It was set by `ensure-site` and never again: it is not in `EDITABLE_SITE_FIELDS`, and the #643 freeze retired Airtable hand-editing. A site that moved — a rename, a staging host, a custom domain at launch — could not be corrected anywhere.

  Found on `vida-legacy-foundation`, whose row points at a hostname that returns 404 while the real site is elsewhere. Any audit that ran against it was measuring nothing.

  `kind: "url"` applies the same scheme allowlist the audit target itself uses, so a `file://` or `javascript:` value is rejected before the read — this value is handed to Chrome/lhci and fetched server-side. The render's allowlist-drift guard required the control too, so it is rendered first in the editor, above the contact fields.

- 355ff8f: Correct two overstatements about what watches Cloudflare Turnstile. Both were written on 2026-09-04 and both claimed more coverage than exists.

  - **`form-e2e` does not swap the sitekey.** `CF_TEST_SITEKEY` reaches exactly one expression — `` `testmode-${testSitekey}` `` (`form-e2e.ts:444`) — injected at `:460` as the _value_ of a hidden `cf-turnstile-response` input. Nothing writes `data-sitekey`, calls `page.route`, or uses `addInitScript`. The site's real widget renders with its real key on every nightly run, against 6 sites' live contact forms. The probe is already generating the evidence and discarding it.
  - **The smoke suite's 110200 guard is inert in the fleet run.** `fleet-smoke` is clone-based and runs each site's own suite against a local dev server; `PUBLIC_TURNSTILE_SITE_KEY` is a Netlify variable that is not in the clone, so no widget initialises and no `TurnstileError` is thrown. The guard is right and defends a site's own CI where the key is present — it does not defend the fleet.

  Net: nothing automated currently observes a production Turnstile widget on its production hostname. `docs/runbooks/turnstile-widgets.md` now says so plainly instead of implying two layers of cover.

- 8ced67d: Correct the Turnstile runbook's browser check — as written it would condemn a working widget.

  Two claims in `docs/runbooks/turnstile-widgets.md` step 5 were wrong, and measurement on 2026-09-04 contradicts both:

  - **"`.cf-turnstile` has an `iframe` child"** — the fleet's widgets are `invisible` mode and solve without leaving one. A healthy VLF widget was measured with **zero** iframes and a valid 773-character token in the same instant. An operator following the old text would have declared a working widget broken.
  - **"the nightly `form-e2e` probe is the automated version of this"** — it is not, though not for the reason first given. No driven browser can do it: Cloudflare answers automation with error **600010** regardless of configuration (the known-good `reddoorla.com` canary and Playwright's Chromium, headed and headless, all reported it while an ordinary Chrome window minted an accepted token).

  Step 5 is now a single check — a non-empty `cf-turnstile-response` — done in an ordinary browser, with the automation limits stated. The division of labour is made explicit: **110200** does not depend on the browser being human, so the smoke suite rules out the wrong-hostname state; only the manual check establishes that the widget solves.

- 141a09f: Turnstile: stop reporting a widget healthy on the strength of an env var, and add widget 3.

  `Turnstile widget` in Websites was written from `/health`'s `forms.turnstile`, which is `!!PUBLIC_TURNSTILE_SITE_KEY?.trim()` — a truthiness check on a string that never contacts Cloudflare. A site deployed with the sitekey of a widget already full at Cloudflare's 10-hostname cap therefore reported `pass` while the live widget threw `110200` and minted no token; under `Require Turnstile` that buckets 100% of real leads, and the false `pass` satisfied **both** halves of the guardrail meant to catch it (the red digest item needs `"fail"`, the amber cockpit watch needs `!== "pass"`).

  The mapping is now asymmetric: `false → "fail"` (no key IS proof the widget can't work), `true → null` (a key is NOT proof that it does). `null` is the cockpit's existing accept-able "can't verify" watch, so nothing new had to be built; a real `pass` has to be earned by a browser.

  Two more places the same failure hid, plus capacity:

  - The generated smoke suite allowlisted `/turnstile|challenges\.cloudflare/i` against `pageerror` as well as console output, so the uncaught `TurnstileError` was discarded by name. The allowlist is split: console telemetry stays allowed, an uncaught throw does not.
  - `form-ingest.mts` now reads `TURNSTILE_SECRET_KEY_3` alongside `_KEY`/`_KEY_2`, for the new "Site Forms 3" widget — "Forms 1" is full and "Site Forms 2" had one slot left fleet-wide.
  - New runbook `docs/runbooks/turnstile-widgets.md` covers hostname allowlisting, the two-slots-per-site rule, the launch-time custom-domain cutover, and the browser check that is the only real proof. `require-turnstile-rollout.md`'s preconditions and guardrail section are corrected to match.

## 0.93.1

### Patch Changes

- 9cf7a6c: `createIngestAction`'s `buildPayload` may now be async, matching
  `createIngestEndpoint`.

  Without this, CMS-authored auto-replies were reachable only from sites using the
  JSON endpoint. Every site on a SvelteKit form action — which is what
  `reddoor-starter` generates, so most of the fleet — had no way to await a CMS
  read and could not adopt the feature at all.

  Also closes the same gap the endpoint had: a promise-returning `buildPayload`
  previously escaped the try/catch as an unhandled rejection instead of the
  documented failure result.

## 0.93.0

### Minor Changes

- 1aaf782: Confirmation emails get rich text and real per-form-type defaults.

  **Rich text.** The reply body is now a block/span AST rather than flat strings —
  bold, italic, links, bulleted and numbered lists, and two heading levels — and
  `@reddoorla/maintenance/forms/prismic` maps a Prismic Rich Text field straight
  onto it. Deliberately an AST and NOT an HTML string: the envelope crosses an
  untrusted boundary twice, and a renderer that can only emit a fixed set of tags
  keeps "no attacker-authored text reaches an outbound email" true by
  construction. Links are restricted to `https:` and `mailto:`; anything else
  renders as plain text. Spans are applied by offset BEFORE escaping, so copy
  containing an `&` or `<` formats correctly.

  **Per-form-type defaults.** A site that has authored nothing no longer sends
  "We got your message / Thanks for reaching out to {site}" for every form. Each
  form type now has its own subject and two-paragraph body — a newsletter signup
  reads like a subscription confirmation, an inquiry like an inquiry. A site's
  legacy per-site copy columns still win where they are set, and CMS-authored copy
  still wins over everything.

  BREAKING for anyone who built a `_reply` envelope by hand: `paragraphs: string[]`
  is replaced by `body: ReplyBlock[]`. The only consumer is gallerysonder, updated
  alongside.

### Patch Changes

- 1a98fef: Pick the reply entry that has copy, not merely the first one matching the form
  type.

  A repeatable group hands an editor a new row with its Select unset or defaulted,
  so a settings document part-way through being filled genuinely contains several
  blank rows all claiming the same form type — that is the state a real client
  document was found in. Taking the first match outright meant one stray blank row
  above the real copy silently discarded it: the reply fell back to the built-in
  default and looked, from the client's side, exactly like the feature not
  working.

## 0.92.0

### Minor Changes

- 0005dc1: Form auto-replies can now be authored in a site's CMS.

  A site may forward a `_reply` envelope with a submission — subject, body
  paragraphs, signature, and calendar details — and the autoresponder renders it,
  attaching an RFC 5545 invite and a Google Calendar link when the envelope
  carries an event. Sites that send nothing keep today's email exactly, and an
  RSVP now names its event in the subject even with no copy authored at all.

  `@reddoorla/maintenance/forms/prismic` resolves that envelope from a Prismic
  repository: per-form-type defaults from a `form_replies` singleton, overridden
  per event. Its client is structurally typed, so the package still depends on no
  CMS SDK and `./forms` stays importable by a site that uses none.

  Two fixes ride along. `buildPayload` may now be async, and a rejected one is the
  documented 400 rather than an unhandled rejection. And reserved underscore keys
  can no longer be smuggled into `extraFields` from a request — previously any
  unrecognized `_`-prefixed key was folded in, which would have let a bot dictate
  the text of an email sent from `forms@reddoorla.com`.

### Patch Changes

- 9295548: Add a "Prospect audits" button to the fleet cockpit.

  The `/audits` page is the one Tim and Erik are expected to use directly, and
  until now it was reachable only by typing the URL — the cockpit linked to the
  fleet table and nothing else. A pill-styled link under the header row gets them
  there in one click. Stopgap for the dashboard rework tracked separately; a
  shared shell with real navigation is that issue's job, not this one's.

## 0.91.0

### Minor Changes

- 6876004: prospect-audit: measure the answer space, the visitor journey and what is broken

  New in the report, all stored on `result_json`: `goalFit` (the site's primary
  goal, inferred by the model or set with the new `--goal` flag, and the concrete
  things a site with that goal needs), `basics` (reachability, redirects, mixed
  content, duplicate titles, and what each named AI crawler is served),
  `assets` (broken links and images), `journey` (click distance from every crawled
  page to a way of making contact) and `consistency` (copyright currency, pages
  off the site template, and an inventory of the contact details published).

  Findability is reweighted: `llms.txt` no longer scores, because nothing we can
  observe reads it. Reports stored before this release carry none of the new
  fields, and a reader must treat their absence as "not measured" — not as a
  finding.

  Two rules the new checks are held to, both of which cost checks that were
  already written: a check reports an ANSWER, never a topic that happens to be
  mentioned; and our own missing data — a refused fetch, a rate limit, a render
  that timed out, a link into CDN infrastructure — is never reported as the
  prospect's defect.

### Patch Changes

- 19d5b1c: Capture `block-subbody` text in the Blux grid parser, which was silently dropped

  The grid parser recognized `block-title`, `block-body` and `block-subtitle`, but
  not `block-subbody`. A `block-subbody` element therefore parsed as an
  unrecognized `raw` node and its text never reached the emitted content, with no
  error — the failure mode was a paragraph quietly missing from the migrated page.

  `block-subbody` appears on 4+ sites in the export set (mediaStudios, thePinnacle,
  theTower, strategyAdvantage). Where it carries a unique body paragraph rather
  than link text — williamsonHomes' about-page lead, for instance — that paragraph
  was lost.

  It is now treated as a body leaf, the same text role as `block-body`.

  This fix was originally written in July (#451) and merged into
  `feat/blux-catalog-emit`, but did not survive that branch's squash to main in
  #452, so it never actually shipped.

- 38865a4: Add `pnpm verify` and bind the CI workflow to it, so the local gate and the Actions gate cannot drift

  CI listed its steps inline while contributors ran some ad-hoc subset locally, and
  the two drifted in the expensive direction: a local `lint && build && test` could
  pass while CI failed on `typecheck` — the only step that typechecks `tests/**` —
  and nothing local ran `test:dist` at all. `pnpm test` is also not `test:coverage`,
  so the coverage floor in vitest.config.ts was never enforced outside CI.

  `pnpm verify` is now typecheck → lint → build → test:coverage → test:dist. CI still
  lists those steps individually, so a failure stays attributable at a glance in the
  Actions UI — but `tests/ci-gate.test.ts` derives the expected commands from the
  `verify` script and asserts the workflow matches it exactly, in order. The
  workflow cannot gain, lose, or reorder a gate without the suite failing.

## 0.90.1

### Patch Changes

- 4c79cfa: sync-configs: merge `.prettierignore` instead of overwriting it, and absorb the last of reddoor-starter's local config overrides

  `.prettierignore` was byte-matched, so a sync deleted whatever a site had added.
  reddoor-starter ignores the Slice Machine-generated `src/prismicio-types.d.ts`
  there — a prettier version bump reformats that file and reds `prettier --check`
  on otherwise-fine dependency PRs — so the overwrite silently re-armed the very
  failure the entry prevents. It is now merged exactly like `.gitignore`: canonical
  entries are backfilled, the site's own are preserved.

  Two bits that lived only in reddoor-starter's local configs are now in the shared
  ones, so sites no longer need to fork them: `reducedMotion: "reduce"` in the
  playwright base (every site gates scroll-behavior on prefers-reduced-motion, so a
  smooth-scrolling run is a fleet-wide flake source) and the `docs/superpowers/` /
  `scratchpad/` eslint ignores.

  Also drops `.vercel/` from the canonical `.gitignore` entries. It arrived with the
  list's first commit and was never justified — the whole fleet deploys to Netlify,
  and nothing in the tooling references Vercel.

## 0.90.0

### Minor Changes

- a352df9: Add `@reddoorla/maintenance/images` with `cappedWidths()` for Prismic srcsets.

  `<PrismicImage>` advertises every default width (up to `3840w`) regardless of
  how big the source asset actually is, so browsers on wide or retina screens ask
  Prismic to upscale on demand. Those variants are always a cache MISS, are
  expensive to generate, and are the ones that surface as slow or failed images in
  production while the same asset's smaller variants serve fine. A fleet audit
  found this in 14 of 15 Prismic sites — 158 call sites — including both starters,
  so every new clone inherits it. Worst observed: a 40px source offered at `3840w`
  (96x), and the 558px photo that surfaced the bug on revogen (6.9x).

  `cappedWidths(field)` trims the candidate list to the image's own pixel width.
  Upscaling adds no detail, so the rendered result is identical while the
  expensive transforms disappear. Sources already at or above the widest candidate
  keep the default list untouched, so no image is ever offered a _wider_ candidate
  than before.

  ```svelte
  <PrismicImage
    field={slice.primary.image}
    widths={cappedWidths(slice.primary.image)}
    sizes="(min-width: 768px) 50vw, 100vw"
  />
  ```

  The entry is dependency-free — the image field is accepted structurally rather
  than as `@prismicio/client`'s `ImageField`, so consuming sites pull in no new
  dependency. Note that `widths` is the mechanical half of the fix: `sizes` still
  needs a per-slot value, since only the site knows its layout.

### Patch Changes

- 82e0bc3: Close the comment-blind and quoting gaps in the renovate.yml compliance check (#651 follow-up).

  The predicate that replaced byte-matching for `.github/workflows/renovate.yml`
  took the FIRST regex hit anywhere in the file — comments included. A canonical
  pin, cron, or job body sitting in a `#` comment above the real (wrong) line
  read as compliant, and `withRenovatePinsFrom` would scrape a sha out of a
  comment like `# old: uses: actions/checkout@1111…1111 # v4` and carry it into
  the healed file — a pin downgrade delivered by the exact recipe that exists to
  prevent pin downgrades. Every check now runs against a comment-stripped copy,
  and `uses:` matching is anchored to the start of a line (only leading
  indentation and an optional `- ` marker allowed before it).

  Also: `RENOVATE_REPOSITORIES` and `contents: read` now tolerate quoting like
  the cron check already did; the permissions check no longer requires
  `contents: read` to be the first key under `permissions:`; the pin check
  widened from three hardcoded actions to every `uses:` line in the file (a
  local `uses: ./.github/actions/x` path ref is correctly never flagged); the
  `RENOVATE_USERNAME`/`RENOVATE_GIT_AUTHOR` gap now reports which field failed
  instead of folding both into one message; `withRenovatePinsFrom`'s doc comment
  now says plainly that the heal is pin-neutral (never orders digests, so it can
  heal a site onto its own OLDER pin) rather than implying it prevents
  downgrades; `self-updating`'s write loop now writes only the paths that
  actually drifted, so a stale `renovate.json` no longer drags an
  already-compliant `renovate.yml` into the same PR; and `RENOVATE_ACTION_CONFIG`
  is now exported once from `renovate-action.ts` instead of being declared
  separately in `sync-configs.ts` and `self-updating/index.ts`.

  Re-verified against all 22 fleet `renovate.yml` checkouts: verdicts unchanged
  (12 compliant, 10 healed, zero false positives/negatives).

- 466d18d: sync-configs: stop treating hand-authored `svelte.config.js` as drift, and make `--dry` tell the truth

  `isSvelteConfigCompliant` required the literal string `createSvelteConfig`, so any
  site that hand-authors its config read as off-pattern and would be replaced by the
  8-line canonical template. That was four live sites — the-pointe-burbank (151
  lines), beachfront-dentistry (241), 1836dig, data-dynamiq — plus reddoor-starter,
  whose placeholder-repo prerender tolerance is the only reason a freshly cloned
  site builds green. A config on the canonical adapter with its own `kit` block is
  now compliant; a missing file, the wrong adapter, or a stub with no `kit` config
  still gets the template.

  `--dry` re-implemented drift detection as a raw byte comparison and never applied
  the compliance predicates, so it reported files the real run leaves alone. It now
  calls the recipe's own `planTemplateDiffs`, so preview and apply cannot disagree.

## 0.89.0

### Minor Changes

- 5b4befc: Add `db usage` — a nightly alarm on Turso plan-quota headroom (#539 HIGH-10).

  The org runs on the starter plan with `"overages": false`, which means crossing
  a quota BLOCKS reads and writes rather than billing for them. Once the Airtable
  cutover lands, Turso is the only store the fleet has, so quota exhaustion is a
  total outage with no warning shot.

  `db usage` reads the Turso platform API and emits one greppable line:

  ```
  FLEET_DB_USAGE plan=starter elapsed=82.78% rows_read=0.04% rows_read_proj=0.04% … worst=rows_written_proj:0.36% verdict=ok
  ```

  Three properties are load-bearing:

  - **Quotas come from the API's own `/plans` response**, matched to the
    subscribed plan — never hardcoded. A plan upgrade must not leave the alarm
    measuring against a ceiling that stopped being true.
  - **Cumulative metrics are projected to the end of the billing cycle.** Rows
    read/written reset monthly, so a raw percentage is not comparable across the
    month: 30% on day 3 is a fire, 30% on day 28 is fine. Storage is a level and
    is deliberately not projected.
  - **An unconfigured alarm fails.** No token yields `verdict=no-token` and a
    non-zero exit, and the workflow gates on the marker line rather than the exit
    code alone — an absent success marker is not a passing check.

  Capacity metrics (databases/locations/groups) are reported but never alarm: the
  fleet sits at its group ceiling by design on the starter plan, so alarming there
  would fire nightly about a standing constraint. Those ceilings also fail loudly
  at creation time, unlike quota exhaustion.

  Wired into `fleet-db-backup` as a separate job, so a quota alarm can never stop
  the backup being taken, and it files its own tracking issue. Requires a new
  `TURSO_FLEET_USAGE` secret — a platform API token, distinct from the
  database-level `TURSO_AUTH_TOKEN`.

  Baseline at the time of writing: the worst metric is 0.36% of its ceiling.

- dadb073: feat(db): THE FLIP — Turso is authoritative (#612, #539 Phase 5 → 6)

  `TURSO_IS_AUTHORITATIVE` is now `true`: every mirror runs strict (a Turso
  failure is fatal, missing creds refuse to build, `missed` is a bug), and the
  Airtable write is the swallowed best-effort shadow for the one-week rollback
  window. The hourly `fleet-db-sync` workflow is retired in the same change —
  the import and the inversion must move together, and do.

  Go/no-go recorded immediately before the flip:
  `FLEET_PARITY sites=44 health=44 schedule=44 reports=17 mismatches=0`.

  Airtable is now a frozen archive: no hand-edits (the console replaces them),
  no imports, no parity. Phase 6 (~a week out) deletes the shadow writes and
  the Airtable client layer.

  The pre-merge deep review closed three regressions the flip would have
  exposed: the send batch now mirrors its own `Sent at` / `Resend message ID`
  stamp into Turso (the retired hourly sync was the only thing converging
  those, and an unmirrored stamp disarms the console's already-sent guards);
  `fleet-prismic-drift` and `fleet-security`'s renovate-dispatch steps get the
  Turso creds their now-strict mirrors refuse to build without; and
  `db import-airtable` / `db sync` refuse under the freeze unless `--force`,
  because a habitual import would overwrite authoritative rows from the frozen
  archive. A failed Launch flip or sent-stamp mirror now reds the send run
  instead of hiding in a green one.

### Patch Changes

- 3ffa6bd: fix(form-e2e): survive client re-renders, and make a failure name its cause

  The probe filled the form right after `domcontentloaded` and never looked
  again. Anything that re-rendered the form during the settle — seen live on
  2026-08-31, when a hydration mismatch on reddoor's /contact made Svelte
  recreate the subtree — silently discarded the filled values AND the injected
  `testMode`/`cf-turnstile-response` fields, so the click hit empty `required`
  fields, native validation blocked the submit, and the night's warn said only
  "no success banner — POST 200" (a Turnstile telemetry POST; beachfront's
  "POST 204" the same night was Google Analytics' beacon).

  Three changes, one per lesson:

  - Verify the fills just before the click and refill once if they were wiped;
    a pass that needed the refill says so in its summary, so production keeps
    proving (or retiring) the race.
  - Scope the observed POST to the site's own host (`isSameSitePost`), so the
    reported status is the action's — and BUDGET_THIN can no longer time a
    third-party beacon.
  - On failure, report why nothing happened (`noBannerDetail`): same-site POST
    or "the submission never left the page", empty required fields, validity,
    alert text, and whether a hydration-mismatch warning was seen.

- ac99ac2: Fix `db restore` against a hosted Turso database — it could only ever restore
  into a target that required no authentication.

  The command built its libSQL client from a url alone, with no auth token. That
  works against `:memory:` and a local `turso dev`, which is exactly what the
  nightly rehearsal and the 2026-08-26 manual rehearsal used — and 401s against
  every target an actual recovery would have.

  Found by pointing the shipped command at a real hosted database for the first
  time. It returned a bare `SERVER_ERROR: Server returned HTTP status 401`.

  The target token now comes from `TURSO_RESTORE_AUTH_TOKEN`, and a hosted target
  with no token is refused as `RESTORE refused=auth-token-absent` **before** the
  network and before the dump is even read — so the failure names the missing
  token rather than surfacing an opaque 401 or an ENOENT that sends you hunting
  for the dump file.

  It deliberately does not fall back to the ambient `TURSO_AUTH_TOKEN`: that one
  belongs to production, and inheriting it would undo the reason `--url` is
  required in the first place.

  Now proven end-to-end against a real hosted Turso database: `RESTORE
loaded=true tables=11 rows=766 blob_bytes=7777769 mismatches=0` in 10.4s, with
  both refusals (`auth-token-absent`, `target-not-empty`) also confirmed against
  that same hosted target.

## 0.88.3

### Patch Changes

- 085b587: Move the cockpit's two fleet-wide aggregates to the nightly digest (MED-16).

  The fleet homepage recomputed both of its "since a window" numbers on **every page
  load** — the 30-day spam roll-up and the 14-day notify-bounce counts. Both are
  aggregates over the whole `submissions` table, which is the one unbounded-growth
  table in the schema (append-only, one row per fleet lead forever), on the
  operator's most-loaded page, against a store that meters **row scans**.

  They now come from one row read by primary key, computed once by the nightly
  digest and stored beside the digest snapshot under its own key.

  **The trade is that the figures are up to 24h old, and the design pays for that
  twice.** The strip is labelled with when it was taken (`· as of 2026-08-26 03:00
UTC`), because a stale number rendered as though it were live is worse than the
  per-request cost it replaced. And an absent roll-up reads as **null, not zeros**:
  every one of these numbers has a legitimate zero, so a reader handed
  `{honeypot: 0, …}` cannot tell "nothing was screened out" from "the digest has
  never run". The cockpit renders the strip as absent instead, the same distinction
  `FLEET_SMOKE_UNMEASURED` exists to preserve. A malformed or older-shaped payload
  reads as null too, since a different process writes it on a different schedule.

  `DIGEST_STATE_WRITE` gains a **three-state** `rollup=1|0|absent` counter rather
  than a boolean. `absent` means no Turso is configured, which is what every unit
  test looks like — reporting that as `rollup=0` would train the eye to ignore the
  one number that is supposed to catch a dead writer, which is exactly how #585 hid
  for weeks. The writer is injectable for the same reason `digestState` is: without
  a seam it would report `rollup=absent` forever in tests while looking healthy.

  The two query-plan allowlist entries for these aggregates are re-justified rather
  than removed — the functions still exist and still scan, they are simply **batch
  only** now.

- 02d7220: Register `db restore --url`, which was never wired — and rehearse the rollback.

  **`db restore` shipped unrunnable.** `DbCommandOptions` declared `url?`,
  `runDbCommand` read `opts.url` to pick the restore target, and `bin.ts` registered
  only `--file`. So `--url` was a cac hard-error at parse time and the command's only
  reachable outcome was its own usage message. Every unit test passed, because they
  call `runDbCommand` directly and never go through the CLI.

  It was found the only way it could be: by trying to use it. A restore path that
  cannot be invoked is the worst thing to discover during a recovery, and after the
  freeze that dump is the entire rollback story.

  **The rollback has now been rehearsed end to end**, against a real libSQL server
  rather than the nightly `:memory:` load:

  ```
  dump    17 MB, 11 tables, manifest on line 1
  target  turso dev (sqld, Hrana over HTTP) — a real server, empty
  RESTORE loaded=true tables=11 rows=755 blob_bytes=7777769 mismatches=0
  ```

  Row counts and total blob bytes were compared against the dump's **origin
  manifest**, not against the dump text. Then content was compared directly between
  production and the restored copy — the newest submission, the largest header image
  (808,289 bytes, JPEG magic intact), the largest rendered report body, the
  `digest_state` row and the full migration list all matched exactly.

  All three refusals were exercised and each exits non-zero: `target-not-empty`,
  `manifest-absent`, and a missing `--url` (which must never default, or a restore is
  one keystroke from overwriting production).

  **What this does NOT prove:** the target was a local sqld, not a hosted Turso
  database, because creating one needs a browser-OAuth platform login. The dump path,
  the statement set, the client, the manifest verification and the guards are all
  proven; Turso's hosted control plane is not.

  A registration test now derives the required flags **from the source** — every
  `opts.foo` read in `db.ts` must have a `--foo` on the db command — plus a
  behavioural check that spawns the CLI and asserts cac accepts both flags. The
  lookup is scoped to the db command's own block, so a `--url` belonging to another
  command cannot satisfy it.

- bb7ee2c: Divide the AI-visibility score by the probes we sent, not by the ones that came
  back.

  Every failure path in the probe loop was a bare `return`: a probe that errored,
  or that errored again after its rate-limit retry, was dropped without a trace.
  The score then divided by `categoryAnswers.length` — the survivors. So the
  denominator shrank silently whenever the network did, and **a flakier run scored
  higher**. Ask five buyer questions, have three fail, and have one of the two
  survivors name the business, and the report read "named in 1 of 2 searches" and
  scored 50. The truth was 1 of 5, which is 20. Nothing anywhere recorded that
  three probes had died, and no two runs were comparable — neither between dates
  for one prospect nor between prospects.

  `attempted` is now the divisor, so a probe that never came back counts as "not
  found". That is the conservative reading and it can understate, which is the
  right direction for a number handed to a stranger — but only if they are told,
  so the report now says how many searches failed and that the figure is a floor.

  **A wholly dead engine is excluded rather than counted as silent refusals.** The
  two ways a probe goes missing are not the same claim about the prospect: an
  engine that answers nothing at all is a missing API key or a dead vendor — our
  outage, no evidence either way — while an engine that answers some queries and
  fails others is demonstrably alive, so those failures are real gaps in the
  measurement. Attempts are tracked per engine and only live engines contribute to
  the denominator. Without this split an unset environment variable would have
  halved somebody's score.

  **Nothing answering at all is now null, not zero.** "The engines were asked and
  did not know you" and "we learned nothing" are different claims about someone
  else's business, and only one of them is ours to make. That case takes the same
  "not measured" path a missing stage already does.

  `ProbesResult.categoryProbes` reports `{ attempted, answered }`. It is optional
  because the type also describes runs deserialized from
  `prospect_audits.result_json`, and reports stored before this field lack it.

## 0.88.2

### Patch Changes

- 5c682c2: The backup now verifies against the origin, not against itself (2026-08-26 review).

  The restore rehearsal parsed its expected row counts **out of the dump text**, and
  got its actual counts from **loading that same text**. Both sides derived from one
  artifact, so a dump that collected 5 of 44 sites shrank both numbers together and
  verified clean. With the freeze making Turso the only store, that dump is the
  entire rollback story.

  Every dump now carries an **origin manifest** on its first line — per-table row
  counts and total `header_image` bytes, read from the live database before any row
  is serialised. `verify-dump` compares against that. A dump with no manifest is
  refused rather than falling back to self-comparison, which would silently
  re-enable the blind spot on the one artifact nobody watches.

  **Table coverage is asserted.** `tables=N` was printed and never checked, so a
  table a migration failed to create rode green forever — `digest_state` and
  `prospect_audits` were in no artifact at all the night this was found. A runtime
  `DATABASE_TABLES` list, with a compile-time check that names any table missing
  from it, is now compared against what restored.

  **The encrypted artifact is verified.** Everything used to check `dump.sql`,
  which is then deleted — nothing ever decrypted the `.gpg` that actually gets
  uploaded, so a corrupt encryption would have shipped green. The workflow now
  decrypts it back and re-runs the same gate on the round-tripped copy.

  **New `db restore --url <target> --file <dump>`.** The nightly rehearsal loads
  into `:memory:`, which proves the SQL parses — not that you can get the data back
  into a real libSQL target, the operation an actual recovery needs and one that
  had never been performed. It refuses a non-empty target and a manifest-less dump,
  and verifies the restored result against the origin manifest.

  **NUL bytes round-trip instead of being silently stripped.** The old justification
  was that they cannot appear in this schema's TEXT columns — but `submissions`
  free text is attacker-supplied and SQLite stores NUL happily, so the backup would
  have quietly differed from the origin with no signal.

  `countInsertsInDump` is removed. Its line-anchored regex was also inflatable by a
  submitted message containing a line starting `INSERT INTO sites `, which would
  have redded the backup; the manifest removes that class entirely.

- 745975a: Fix four defects in the dashboard's browser script (2026-08-26 review).

  All four live in code no test had ever executed — the page's interactivity ships
  as one inline `<script>` built from a template literal, and the suite runs
  `environment: "node"`. That is the same blind spot that shipped #595 (a checkbox
  and a multi-select that rendered perfectly and could not save).

  **A saved field re-POSTed on every later blur, forever.** The blur listener fires
  on `value !== defaultValue`, and `saveDetail` never touched `defaultValue` — so
  after one successful edit the two stayed different until the page was reloaded,
  and every subsequent focus+blur wrote to Airtable again. The commentary handler 40
  lines below always did resync, which is what marks this as an oversight. The worst
  case was the `secret` kind: it deliberately emits no `value` attribute so a
  credential is never echoed into the HTML, pinning `defaultValue` at `""` — so
  every blur after typing re-sent the credential. One Airtable quota exhaustion has
  already reddened six workflows fleet-wide, so tabbing through this form was a
  cheap way to burn the write budget. `saveDetail` is now exported as source and
  executed against stubs, including a control proving a FAILED save stays dirty so
  the next blur retries.

  **Approve state reached only one of two buttons.** The same pending report renders
  twice — pending list and reports history — so one report id owns two Approve
  buttons. The click handler updated the clicked one; the override handler used
  `document.querySelector`, singular. After Approve or Override the twin still read
  "Approve" and, with the gate clear, was still enabled. All four state paths
  (initial disable, success, `!res.ok`, network rejection) now map over every twin —
  including the failure paths, since leaving a twin disabled strands it unusable.

  **A datetime in a date cell could silently clear the schedule with no user edit.**
  `<input type="date">` accepts only `YYYY-MM-DD`; handed an ISO datetime the
  browser sanitizes `.value` to `""` while `.defaultValue` keeps the raw string, so
  the blur guard fires on an untouched tab-through and the server accepts `""` as a
  deliberate clear. `maintenanceDay` / `testingDay` drive the code-owned next-due
  schedule. Dormant while those Airtable columns stay date-only — it goes live the
  instant anyone ticks "include time". Closed at both ends: the renderer truncates
  to the date part, and a save now requires a real `input` gesture as well as a
  changed value, which kills the whole class rather than this one instance.

  **`rfPhase` was dead on both ends.** It mapped a GitHub step name onto a human
  phase line, carefully ordered and commented, and `summarizeFleetRunStatus`
  returned `step: null` unconditionally — so the line never rendered once. Removed
  rather than wired: the step name only comes from the per-run _jobs_ endpoint, so
  filling it would add a GitHub call per workflow per 10-second poll on a request
  path, for one line the elapsed/ETA line already covers. Its test asserted the dead
  string was _present_, and another claimed "endpoint fills it for in-progress runs";
  both now pin the absence.

  Also: the cockpit's one `innerHTML` sink escapes its interpolations and gates the
  run link on an `https://github.com/` prefix. The values are server enums and
  GitHub `html_url`s, but it builds markup from a remote response, and everywhere
  else on these pages the rule is that no server string becomes HTML.

  And the prospect-audits page joins the inline-script parse gate. Its 50-line
  `RUN_SCRIPT` cites the exact build-time-`\n` incident the gate exists to catch,
  and it was the one dashboard page the gate never covered.

  Four smaller items in the same area:

  - The **parse gate had two blind spots**. It matched only `<script>` with no
    attributes, so a future `<script type="module">` or a nonce would be skipped in
    silence — a gate that stops looking still reports green. And it could not see
    inline handler attributes (`onsubmit=`), which are JavaScript too and fail more
    quietly, for one control rather than the page. Both are covered now, with
    self-tests that fail a broken attributed tag and a broken handler, and a positive
    control so the gate is not merely throwing on everything.
  - **`scriptLiteral`** joins `escapeHtml` in `src/util/html.ts`. A `<script>`
    element's content is raw text — the HTML parser does not decode entities inside
    it — so `escapeHtml` reaching a script body corrupts the JavaScript instead of
    escaping it, while looking like the house style. There was no correct tool to
    reach for; now there is, and its test compiles the emitted literal to prove
    `</script>` and `<!--` round-trip as data.
  - **The multi-select comma invariant is asserted.** The value is comma-joined
    client-side and split on `/[,\n]/` server-side, which round-trips only while no
    option contains a comma. An option like "Deploy failed, retried" would have
    silently arrived as two conditions.
  - **The override toggle no longer depends on `nextElementSibling`.** Adjacency is a
    markup accident; anything inserted between the toggle and its form would kill
    "Send anyway…" silently. It uses the `.override` wrapper the markup already
    provides — the same `closest()` contract the submit handler six lines below uses.

- e6cf00d: Make the request-path mirrors freeze-aware, and gate that they stay so
  (2026-08-26 review, MED-9 / MED-13 / LOW-1).

  The review asked whether anything enforces that a new mirror factory honours the
  freeze switch. Answering it turned up something better: **four writers had already
  skipped it, and none of them was a factory.**

  `approve-report`, `report-commentary`, `resend-webhook` and `site-details` do not
  use the mirror factories at all. Each calls `mirrorReportPatch` / `mirrorSiteField`
  directly, inside its own hand-rolled `try { … } catch { console.error }` — four
  independent copies of the swallow, each carrying a comment saying the hourly sync
  converges it. Searching for `TURSO_IS_AUTHORITATIVE` could never find them,
  because the defect is precisely that they never mention it.

  **That comment stops being true at the freeze.** With the import stopped, a
  swallowed mirror failure on an approve, a commentary edit, a delivery-status
  webhook or a site-detail edit is permanent divergence: the Airtable write it
  shadows has already succeeded, and the only trace is a log line nobody greps.

  `mirrorWrite(label, run, strict = TURSO_IS_AUTHORITATIVE)` now owns that decision
  in one place, and all four route through it. Under `strict` the failure is raised
  with the label of the write that was lost, rather than logged and forgotten.

  **The lockstep gate** discovers every file calling a `mirror*` writer and requires
  it to use `mirrorWrite` or be listed as exempt with a reason — the same shape as
  the query-plan classification gate. Exemptions are checked for staleness (a dead
  entry silently re-excuses a future writer) and the discovery itself has a vacuity
  guard, so the gate cannot pass by finding nothing.

  **Ingest rate limiting: measured, not changed.** Three consecutive reviews flagged
  that `aggregateBy: ["ip"]` cannot throttle an abusive visitor, and none recorded a
  number. Traffic is server-to-server, so per-IP genuinely buys nothing against a
  visitor — but the standing worry was the other direction, that a legitimate burst
  trips 120/min and a real lead 429s. Against live data that is not close: across
  the whole fleet since ingest went live (356 submissions, 2026-06-15 → 08-26) the
  **busiest single minute ever is 4**, and the busiest day is 25. Netlify's
  `rateLimit` still cannot key on a path param, so per-slug means an
  application-level counter — a read on the one path where latency and failure modes
  cost actual leads. Not worth it for a bound nothing has approached. The
  measurement and an explicit revisit trigger (~40/min) are now in the code, so the
  fourth review does not re-derive it.

  **`.worktrees/` is gitignored.** The concurrent-session rule makes a worktree per
  branch the norm here, so it is permanent furniture — and while untracked it was
  the only entry in `git status`, which trains the eye to ignore a dirty tree.

- 2c217e0: Harden the prospect audit's entry point and cap its spend (2026-08-26 review).

  #619 closed the nested-sitemap SSRF while this was in flight. Two things it did
  not cover remain, and both are here.

  **A hostile index can no longer starve out the real children.** The guard was
  applied inside the loop, after `.slice(0, 3)` — so three hostile entries at the
  top of a sitemap index consumed the whole budget and the site's genuine child
  sitemaps were never fetched. The crawl then silently sees fewer pages, which is a
  quieter failure than the SSRF itself. Filtering now happens before the cap.

  **The entry host is checked before the first fetch.** The redirect guard has
  always covered where a hostile site can send us _second_; nothing covered a
  caller pointing the crawler at an internal address to begin with, and the CLI
  validated only `isHttpUrl` — so one fetch of `169.254.169.254` happened before
  the throw. Both `crawlSite` and the CLI now refuse.

  **A 24-hour cap on dispatches.** The duplicate window stopped the same URL being
  re-run; nothing stopped distinct URLs, so one session could dispatch ~30/minute
  against 30 hostnames indefinitely — and one audit is structurally an Opus call
  plus up to 28 Sonnet calls with up to 112 billed web searches, a 20-page double
  crawl, a 3-pass Lighthouse and a PDF render in a billed Actions job. It is a
  runaway brake, not a quota: far above real use, answering 429 with both numbers.
  A repeat of the same URL still reports `duplicate`, so it neither consumes the
  budget nor gives a confusing answer.

  **The private runner no longer takes a `ref` input.** `reddoor-maintenance` is
  public, so `refs/pull/N/merge` exists for any PR anyone opens; a dispatch naming
  one would run a stranger's build in a job holding Turso, Resend and Anthropic
  secrets.

  **The health check is behind the operator gate.** It leaked no values, but
  `DASHBOARD_PASSWORD: true` is the reconnaissance step for using that fallback.

  Also closes the deprecated `::a.b.c.d` IPv6 form in `isPrivateOrLoopbackHost`.

- d05bdd7: Close the query-plan gate's blind spot, and stop shipping report bodies to
  compute booleans (2026-08-26 review).

  **The gate tested function names, not predicate shapes.** It reported
  `raw_scans=0` while three request-path raw scans of `submissions` shipped, because
  `countSubmissionsFiltered` had exactly two hand-written scenarios — `{}` and
  `{siteId}` — and both happen to land on an index. Its `formType`, `search` and
  `reason` shapes were never planned at all. The `listSubmissionsFiltered` sibling —
  same filter, same request — did get an "every WHERE shape" scenario; the count
  running beside it never did, and the export-completeness check was satisfied
  because it matches names.

  Both functions are now driven off one `FILTER_CASES` record, `satisfies
Record<keyof SubmissionFilter, …>`, so a new filter key fails to compile until it
  is added and then gets planned against every filtered function automatically. That
  took the gate from 52 scenarios to 64 and immediately turned it red on exactly the
  three predicted scans — which is the point of adding the scenarios before the fix.

  **`form_type` had no index at all** (migration `0012`), so
  `countSubmissionsFiltered({formType})` scanned the whole table twice per load of
  the submissions page. `submissions` is the one unbounded-growth table in the schema
  and Turso meters row scans, so that cost rises forever. Adding the index took the
  count 3 → 2, measured as a delta rather than asserted.

  **`search` and `reason` are genuinely unindexable** — leading-wildcard `LIKE`, one
  of them over a concatenation expression — so they are now named allowlist entries
  with the reason they are accepted (operator-only page, bounded by one person's
  typing) and the condition to revisit (~10k rows, or the page becoming client-facing).

  **Allowlist entries can no longer go stale.** An entry that no longer matches a
  real scan is dead permission: it keeps a name exempted after a rename or a new
  index, and silently re-permits a regression that reuses the name. Every entry must
  still describe an observed scan. This caught one immediately — an entry added in
  this very change that turned out not to be needed.

  **The cockpit shipped 1.17 MB of report HTML per page load to compute 16
  booleans.** `listAllReports` used `.selectAll()`, and `fleet-homepage.mts` owns
  `path: ["/"]`. The column was read only to be tested for null. The identical
  hazard was already solved for `sites` 320 lines up in the same file —
  `SITE_COLUMNS` omits the header-image BLOB with a comment about Turso billing the
  bytes, and a lockstep test keeps it honest — so `reports.rendered_html` now has
  `REPORT_LIST_COLUMNS` and the same test. `listReportsForSite` had it too.

  `reportRowFromDb` takes the body's presence as an argument now rather than reading
  the column, so a list row and a full row are both honest inputs and nothing can
  start depending on body _content_ without the type saying so.

  **Hourly parity pulled the same 1.17 MB, 24×/day, to discard it** —
  `rendered_html` was already a parity `SKIP_COLUMN`, but the read was still
  `selectAll()`. It shares the projection now.

  **The detector's "`USING` ⇒ fine" rule was wrong for a row-scan-metered store.**
  It skipped any plan line containing `USING`, justified as "an index-ordered
  traversal under a LIMIT stops early". True — but only when there IS a limit. An
  aggregate has none and reads every row through the index, which costs exactly what
  a raw scan does when the store bills rows rather than pages. `SCAN t USING
[COVERING] INDEX` now counts unless the statement carries a LIMIT.

  That made **four** full traversals visible that the gate had never reported (the
  review predicted three): `countSubmissionsFiltered({})`, `countNotifyBouncedBySite`
  and `listScreenOutsSince`'s group-by on the cockpit request path, plus the digest
  cron's `countSubmissionsSinceBySite`. Each is now a named allowlist entry with its
  justification, not an invisible pass.

  Three of them are **accepted, not fixed**. The real answer is to fold those
  slow-moving "since a window" numbers into the nightly `digest_state` singleton the
  homepage already reads by primary key — but that makes the figures up to 24 hours
  stale, which is an operator's call rather than mine, so it is flagged rather than
  taken.

  One known gap is left explicit rather than guessed at: a LIMITed statement whose
  filter carries a residual predicate the index cannot serve still scans the whole
  table when few rows match, and EXPLAIN's output does not distinguish that from a
  clean early stop.

- 0c4a822: Add a blocked-sender-domain tier to the spam classifier.

  `jmailservice.com` sent 17 submissions across four unrelated client sites between
  2026-06-17 and 2026-08-25. Every one was spam. **Ten of them were emailed to the
  operator**, including the two most recent, which scored 30 and 0.

  They dodged all three existing defences at once. The content scorer sees varying
  bodies that mostly sum under 60. The cross-site `repeat-sender` signal is keyed on
  the exact email address, and the sender rotates a plausible `firstname.lastname@`
  local part — 11 distinct addresses over those 17 sends — so it almost never saw a
  repeat. And the existing disposable-domain list scores +45, which needs
  corroboration: even with the domain listed there it would have bucketed only the
  five sends that already carried another signal, and **none of the ten that reached
  the inbox**. The identity changes every time; the domain does not.

  `BLOCKED_EMAIL_DOMAINS` is a second, stricter tier for domains where every
  submission the fleet has ever received was spam, so it buckets alone. It is scored
  as `SPAM_THRESHOLD` rather than a literal, because the signal is defined as "enough
  on its own" rather than as a number that a later threshold change could strand.
  Matching covers subdomains (`mail.<domain>`) but stops at a label boundary, so a
  look-alike registration like `notjmailservice.com` is unaffected. Nothing is
  dropped: a blocked submission is still stored, still visible in the cockpit, and
  still recoverable — it just lands `spam_auto`, which suppresses the notification.

  **Auditing the rest of the live traffic added seven more.** The MAVIS
  virtual-assistant flood — whose body invariants are already in `SPAM_KEYWORDS` —
  turns out to run from seven sender domains sharing the same rotate-the-first-name
  pattern: 35 submissions, all pitches, 12 of them emailed to the operator.

  The tier ships with a deliberately high entry bar, because it is the only signal
  with no corroboration requirement, and two entries were **rejected** while applying
  it — both of which a naive "100% of its submissions are spam" query would have
  added:

  - `lemos.com`, 10 for 10 "spam", is the operator's own landing-page test traffic
    from `tucker@lemos.com`. Listing it would have bucketed his own testing.
  - `melottogroup.com`, 3 for 3 genuine cold outreach, uses one fixed address with no
    rotation, which `repeat-sender` already catches.

  Hence rule 1 of the entry bar: read every row, not the ratio. A regression test
  pins the rule that matters most — no shared mailbox provider (gmail, outlook,
  icloud, the ISP domains) may ever appear on this list, since a single such entry
  would silently bucket every real lead using it and no other signal would be needed
  to do it.

## 0.88.1

### Patch Changes

- 6114168: Close the audit's correctness gaps found in the 2026-08-26 review.

  **A hostile sitemap index was an SSRF.** A `<loc>` inside a sitemap index reached
  `fetch()` with no origin or scheme check — and that value comes from the site
  being audited, which is by definition a stranger's. A hostile index could make
  the runner request `169.254.169.254`, `127.0.0.1` or any internal host, from a
  GitHub Actions job holding `TURSO_AUTH_TOKEN`, `RESEND_API_KEY` and
  `ANTHROPIC_API_KEY`. Nested sitemaps are now same-origin only, behind the
  private-host guard the redirect check already used.

  **A positive verdict could contradict its own evidence.** Evidence verification
  was written to catch a model inventing quotes and never asked the opposite
  question, so a `yes`/`partial` with no evidence at all passed through and scored.
  Observed in production: the same site, the same question, the same null evidence
  — graded `no` on 25 Aug and `partial` on 26 Aug, moving the Answers score 10
  points and producing a report that scored pricing as answered while its own fix
  list told the prospect to publish pricing. An unsupported positive verdict is now
  downgraded to `no`; the question stays visible, it just stops scoring.

  **AI Visibility was zero by construction.** The query prompt asked for searches
  the company "deserves to appear" in, which yields head terms, which return
  directories — where small firms are aggregated rather than surfaced. It now asks
  for a spread: at most one head term, at least three long-tail. `buildQueries`
  also took only 3 of the up-to-5 queries the schema asks for, pinning the
  denominator at 3 and making the score four-valued; it now takes all five, and
  `MAX_QUERIES` rose to 9 so a competitor query isn't silently dropped in its place.

  **Abbreviations are names, not prose.** `resolveBusinessName`'s `". "` test threw
  away "St. Louis Roofing", "Dr. Patel Orthodontics", "Mt. Vernon Dental" and
  "Smith & Co. Design" — every practice fronted by a doctor's name, every `St.`/
  `Mt.` place name. They degraded to the bare domain, which sent branded probes to
  search for "stlouisroofing.com", killed the brand-mention path, and made the
  report claim the engines were handed the name when they were handed the domain.
  Abbreviations and initials are now stripped before the sentence-break test, and
  the report's claim is gated on the resolved name rather than the raw one.

  **Brand matching missed how engines actually write a name** — a dropped legal
  suffix, `&` written as "and", a hyphen as a space, a line break mid-name, or
  markdown emphasis. Both sides are now normalised before matching. In the other
  direction, any two-word name counted as distinctive, so a business called
  Creative Studio or The Agency scored "visible" off prose referencing nobody; a
  name built only from category words no longer counts on a mention alone.

  **The receipt cards could disagree with the score beside them.** They re-derived
  visibility with a looser rule than the scorer used, printing "You were named in
  this answer" above a card contributing zero. The scorer's decision is now
  recorded on the answer and read by both. Cited domains are relabelled "sources
  the engine retrieved", which is what they are.

  **The PDF could be a 404 page.** `page.goto` resolves for any status and its
  result was dropped, so a missing print route rendered the "Page not found" page
  as a valid PDF and emailed it — with no warning, because nothing threw. The
  status is now checked.

## 0.88.0

### Minor Changes

- 445dd23: Attach a print-designed PDF to the audit email.

  The audit now renders `reddoorla.com/audit/{token}/print` to a PDF and attaches
  it alongside the HTML sheet. That route is a document built for paper — flat,
  with every section visible — rather than the interactive report, whose evidence
  sits behind disclosures. Printing the interactive page would have produced a
  leave-behind with half its content folded away, which is worse on paper than the
  long version it replaced.

  It waits for the network to settle before printing, so webfonts are loaded: a
  fallback face baked into a client-facing PDF cannot be corrected after the fact,
  because the file is already in somebody's inbox. Page geometry comes from the
  document's own `@page` rule via `preferCSSPageSize`, so the stylesheet stays the
  one place that decides it.

  Best-effort by design. Rendering needs a live page and a headless browser, and
  an attachment is not worth losing a delivered report over — every other stage in
  this pipeline degrades rather than throwing, and this one matches. If the render
  fails the email still goes with the link, and a warning records why. It also
  needs a persisted token: with no stored report there is no page to print. The
  browser is closed in a `finally`, so a wedged render cannot strand a chromium
  process on the runner.

  No new toolchain: the runner already installs Playwright's chromium for the
  crawl, and this uses the same `@playwright/test` the crawl imports.

- 916ca37: Point the prospect audit's link at reddoorla.com, and redirect the old one.

  The report now lives at `reddoorla.com/audit/{token}` — a real, branded page on
  our own domain rather than generated HTML on the ops app's. The audit email
  links there.

  `/r/:token` stays as a permanent redirect and is deliberately not deleted.
  Links already sent are sitting in prospects' inboxes and will be opened months
  from now; keeping them working is the entire point of a 301. The redirect is
  built from the same token, so the destination is the same document and nobody
  following an old link can tell anything moved.

  It validates the token shape before redirecting. Without that check the route
  would happily bounce an arbitrary path segment onto reddoorla.com — an open
  redirect wearing our own domain.

  The redirect no longer opens the database, and no longer resolves whether the
  report exists. That is deliberate: the destination is the source of truth for
  that, and checking in both places would let the two disagree. A dead token now
  redirects and 404s at the website.

  The report origin is its own `REPORT_BASE_URL` rather than reusing
  `DASHBOARD_BASE_URL`. The dashboard addresses operators on the ops app; this
  addresses a prospect on the marketing site. They are different audiences on
  different domains, and sharing one variable would mean either silently moving
  the day the other is repointed. Unset, it defaults to `https://reddoorla.com`.

### Patch Changes

- ad6f55b: Digest state moves to Turso, and the fleet homepage stops touching Airtable (#609).

  Unlike the rest of #539 Phase 5 this is a migration, not a mirror — there was no
  Turso table to dual-write into. New `digest_state` table (migration 0011), one
  row holding the whole snapshot as JSON: both readers need the entire map, so a
  keyed table would buy nothing on reads and its "give me every key" query would be
  a raw scan needing a justified entry in the EXPLAIN gate's allowlist.

  **The fleet homepage no longer touches Airtable at all.** Its digest NEW-badge
  read was the last call, and it was an Airtable call on a request path — a Phase 2
  leftover, since digest state was never in that phase's scope. The
  `AIRTABLE_PAT`/`AIRTABLE_BASE_ID` gate that guarded the handler is gone with it,
  so an Airtable outage can no longer degrade the page.

  `runDigest` reads from Turso and writes to **both** stores, so the move stays
  reversible while Phase 5 is in flight. It emits
  `DIGEST_STATE_WRITE turso=<0|1> airtable=<0|1>` — one line, always, naming both
  halves, because a dual-write that silently stopped running looked identical to a
  healthy one for weeks in #585.

  The snapshot read is deliberately **not** defensive: swallowing a failure would
  badge every item NEW, which lands in the operator's inbox reading as "the whole
  fleet degraded overnight". That makes Turso a hard requirement of the digest
  step, which is now pinned by a workflow test.

  `diffAttention` — the pure core — is untouched.

  New `db backfill-digest-state` copies the existing Airtable row across, refusing
  to overwrite a snapshot Turso already holds and reading back what it wrote.

- 1515884: The freeze switch, and the inverted mirror semantics behind it (#612).

  Ships **off**: no behaviour changes today. `TURSO_IS_AUTHORITATIVE` in
  `src/db/freeze.ts` is `false`, and flipping it to `true` is the freeze.

  Through Phase 5 the mirrors are best-effort by design — Airtable is
  authoritative, so a Turso write that fails is caught, logged and swallowed, and
  the hourly import converges whatever it missed. That is correct right up until
  the freeze stops the import. After that nothing converges anything, and the same
  swallowed failure is permanent data loss announced only by a log line nobody
  greps. Three outcomes change meaning at the flip:

  | outcome           | before                          | after                       |
  | ----------------- | ------------------------------- | --------------------------- |
  | `mirrored=0`      | the sync will fix it            | that write is gone          |
  | `mirrored=missed` | the site isn't imported yet     | impossible, therefore a bug |
  | `mirrored=absent` | no creds; Airtable still has it | every write was discarded   |

  So the freeze is not a config change: it inverts which store is allowed to fail.
  `makeSiteMirror`, `makeReportMirror`, `makeHealthMirrorBestEffort` and
  `makeScheduleMirrorBestEffort` all gain a `strict` mode that throws where they
  used to swallow, and refuses to build at all without credentials rather than
  handing back a working-looking mirror that discards every write.

  A code constant rather than an env var, deliberately: the same artifact runs in
  Netlify functions and Actions runners, and an env var set in one but missed in
  the other would give a _partial_ freeze — worse than either end.

  Consumers take it as a default parameter rather than reading it inline, so tests
  exercise both sides as fixtures with exactly one assertion on the shipped value.
  Several older tests that read the shipped constant now pin `false` explicitly,
  and the composition roots' suites mock the mirror factories.

  Verified by flipping the constant and running the whole suite: **exactly one test
  fails, the one that asserts its value.** The freeze is a one-line change.

- af748d6: Three more freeze pre-flight gaps, all gated off the same switch (#612).

  **The fleet sweep's mirror outcomes now reach the exit code.**
  `writeFleetAuditsToAirtable` catches a per-site mirror failure and counts it —
  right, since one bad site must not abort a 44-site sweep — but the counts only
  reached the `FLEET_WRITE_SUMMARY` line and no workflow gated on them. Post-freeze
  a sweep that wrote the fleet's health into nothing would have finished green on a
  line reading `wrote=44 failed=0`. New `fleetWriteFailed` makes a mirror failure,
  a missed row, and an absent mirror each fatal once frozen. It gates the run, not
  the loop: per-site isolation is unchanged.

  **Form ingest stops consulting Airtable.** `makeSiteLookup`'s fallback existed
  for a site created in the Airtable UI before the next hourly import. Nothing
  hand-creates rows after the freeze and `ensure-site` inserts straight into Turso,
  so the window is gone — and consulting a frozen base would resolve a lead against
  a row the system no longer believes in.

  **The console can clear a secret.** It could replace one but never erase one:
  empty means "leave unchanged", deliberately, so an unrelated save cannot destroy
  a key that is blank on every page load. Airtable was the escape hatch and the
  freeze removes it. Typing `__clear__` now erases the cell and reports `cleared`.

  A sentinel rather than a new control, deliberately: the secret input is the one
  field whose save listener already fires on any keystroke, so this needs no change
  to the inline dashboard script — the part of the page no test executes, and the
  part that shipped broken once already.

  All three ship inert. Flipping the constant and running the whole suite still
  fails exactly one test: the one that asserts its value.

- 421d165: Fix the shared Playwright config handing every worker a different port.

  Since the free-port allocation landed, `playwright-a11y` resolved its port at
  module scope with `smokePort || allocateFreePortSync() || "5173"`. Playwright
  re-evaluates the config file in **every worker process**, not only the main one,
  so each evaluation allocated a _different_ free port. The main process started
  the dev server on one; every worker aimed `baseURL` at another. The run then
  died with `ERR_CONNECTION_REFUSED` against a handful of ports nothing was ever
  serving, and the site's route warmup reported `fetch failed` for every route
  before a single test ran.

  The allocation is now pinned back into `REDDOOR_SMOKE_PORT`. Workers are forked
  and inherit the environment, so every later evaluation agrees on the port the
  server is actually bound to. An externally supplied port still wins, unchanged.

  This reached every fleet site consuming the base without `REDDOOR_SMOKE_PORT`
  already set — which is why `reddoor-website` could not take 0.84 or later. It
  did **not** reach `audit --only a11y`, which writes its own config and never
  loads this file, so the package's own suite passed throughout and nothing here
  caught it. There are tests now, and they fail without the fix.

## 0.87.0

### Minor Changes

- eeb76f8: Serve the audit report's data, so the report itself can become a page on reddoorla.com.

  Two additions, both read-only and both in service of moving the prospect-facing
  report off this app's domain and onto the marketing site, where it can be
  rendered in Reddoor's own design language.

  `GET /api/audit-report/:token` returns the stored `result_json` for a valid
  token. It mirrors `prospect-report.mts` exactly on token handling — same
  shape-check before the database, same 404 for anything else, same `private`
  cache directive — and differs only in returning JSON rather than rendered HTML.
  Like that route it is deliberately not operator-gated: the 128-bit token is the
  credential. Keeping the two routes identical on token handling matters, because
  a divergence there is a security difference rather than a stylistic one.

  A new `./audit` package subpath exports `ProspectAuditResult` so a consuming
  site can type the payload it fetches instead of hand-maintaining a copy of the
  shape. The subpath is named for what a consumer receives; the source path keeps
  this repo's own domain word, which is why `./audit` resolves to
  `dist/prospect/types.js`.

  That export is only safe because `src/prospect/types.ts` contains a single
  `import type` and no runtime import — a runtime import there would pull the
  Anthropic SDK and Playwright into a consuming site's bundle, which is exactly
  what tsup's config comment warns about. Nothing enforced it before; a test does
  now. The built entry is 33 bytes of JavaScript and 10.7 KB of types.

  Turso credentials stay in this repo. The website only ever sees the JSON.

### Patch Changes

- 6132ac7: Fix: don't offer a commentary box on report types that ignore it.

  #596 added a commentary editor to every unsent report. Only Maintenance and
  Testing render commentary — `buildAnnouncementMjml` and `buildLaunchMjml` never
  reference the field — so on those two types an operator could write commentary,
  see it save, preview it, and find nothing, with no explanation.

  `rendersCommentary(type)` now lives beside the template dispatch it mirrors, and
  a test renders EVERY report type through the real MJML pipeline with a marker in
  the commentary, asserting presence matches the predicate. A template that starts
  or stops using commentary fails that test rather than quietly disagreeing.

- 7378b0f: D5: read stored header images back out of Turso.

  `storeHeaderImage` has been dual-writing since the header-image CLI landed, and
  the one-shot backfill copied the rest — production carries a BLOB for 12 of the
  13 maintained sites. But nothing could read the bytes back, so every consumer
  still fetched Airtable's signed attachment URL and the columns were write-only in
  practice.

  `loadHeaderImage(db, siteId)` closes that. It is a separate query from the site
  read on purpose: `getSiteBySlug` excludes the BLOB because it is 0.6–0.8 MB per
  site, so reading the bytes has to be an explicit per-site act rather than a field
  that arrives for free on every dashboard GET.

  Also corrects two module comments that claimed these columns were empty
  fleet-wide. That was true when written and has not been since.

- 6184177: `ensure-site` now dual-writes a new site into Turso (#539 Phase 5).

  Bootstrapping is the only path that CREATES a Websites row, and every site
  mirror built so far is an UPDATE — which does nothing at all for a row that does
  not exist yet. So a site bootstrapped at 09:05 stayed invisible to Turso until
  the 09:20 sync, and every mirror the rest of the bootstrap fired afterwards
  reported `mirrored=missed` because there was no row to update.

  `mirrorSiteInsert` maps with the importer's own `mapWebsiteRecord` — the same
  function parity diffs against — so the rows are parity-clean by construction
  rather than by a column list someone has to remember to extend. Its test asserts
  that directly: mirror one record, import the same record, demand identical rows.

  All three rows go in, not just `sites`. Parity reverse-checks `site_health` and
  `site_schedule` per site and reports a missing one as `(row) ABSENT`, and a later
  `mirrorHealthFields` would return `missed` forever with no row to hit.

  It upserts rather than inserts, because `ensure-site` is re-run to resume a
  bootstrap. A stored header image survives that by construction:
  `mapWebsiteRecord` does not carry the `header_image*` columns (Airtable stopped
  being their source, design D5), so the conflict branch cannot blank a plate whose
  bytes live in no other store.

  The fill-blanks path is mirrored too — a resumed bootstrap that only filled a
  blank `url` would otherwise leave Turso stale until the next sync.

  Airtable stays authoritative; this is a dual-write, not a cutover.

- f445f3d: Fix: the site editor's checkbox and multi-select could not save.

  #591 added `Require Turnstile` (a checkbox) and `Accepted Watch Conditions` (a
  multi-select) to the dashboard site editor. Both rendered correctly and neither
  could actually save, because the inline script posted `el.value`:

  - a checkbox's `.value` is its `value` content attribute (`"on"` by default),
    never the checked state — and its listener was the text-input one, guarded by
    `value !== defaultValue`, which for a checkbox compares `"on"` to `"on"`, so it
    never fired at all;
  - a `multiple` select's `.value` is the first selected option only, so all but
    one accepted condition would have been silently dropped.

  The serializer is now a named function exported as source, so tests execute the
  exact text the page serves — the inline script is a template string and the suite
  runs without a DOM, which is why nothing caught this. Checkboxes bind on `change`
  and are excluded from the blur path.

- b741af0: Fix: report preview links pointed at expiring Airtable URLs.

  `/api/reports/:id/preview` was built in Phase 2 to serve a report's rendered body
  from Turso, precisely because Airtable attachment URLs are signed and expire — a
  dashboard tab left open 404s. Nothing ever linked to it, so the expiring URL
  stayed in front of the operator.

  Both the pending-approval "draft preview" link and the history table's "view"
  link now point at the dashboard's own route. The attachment's presence still
  gates whether a link renders at all; it just no longer supplies the destination.

- 1e98a3d: Report review: edit commentary from the console (#539 Phase 4).

  Commentary is the one part of a client report an operator writes by hand, and it
  was editable only in Airtable. The dashboard now offers it inline on any report
  that has not been sent.

  The lock is `sentAt`, not approval: approving schedules the send for the next
  09:23 UTC run, so a typo spotted in that window is still fixable, but once the
  email is out the stored row must keep matching what the client actually read.
  The editor renders for the whole unsent window — in the pending list, and as a
  sub-row in the history table for approved-awaiting-send.

  Writes go to Airtable and mirror into Turso (`ReportMirrorPatch` gains
  `commentary`), so the page re-render right after a save shows the new text rather
  than the old one until the next hourly sync.

- 2131264: Dashboard site editor: the Mailchimp API key, as a write-only field (#539 Phase 4).

  The last of the design's eight uncovered fields, and the only live credential
  among them. A new `secret` kind makes it editable without ever sending the stored
  value to the browser: the control renders with no `value` attribute, and its
  placeholder reports only whether a key is set.

  An empty submission means "leave unchanged", not "clear". Every other kind clears
  on empty, but this input is blank on every page load by construction, so
  clear-on-empty would let any unrelated save destroy a working key. `setSiteDetail`
  returns a new `unchanged` status and never touches the record.

  Known limitation: the console therefore cannot CLEAR a key, only replace it —
  clearing is an Airtable action today. That needs revisiting at the Phase 5 freeze,
  when Airtable stops being available as the fallback path.

  This completes editor coverage for all eight fields the design named.

- 00a63ec: Dashboard site editor: the two non-text fields (#539 Phase 4).

  `Require Turnstile` (a checkbox) and `Accepted Watch Conditions` (a
  multipleSelects) cannot be written as strings, so `updateSiteField` and
  `mirrorSiteField` now take `AirtableCellValue` (`string | boolean | string[]`)
  and the values travel as themselves.

  The coercion to Turso's `1/0` and JSON-array storage is NOT repeated in the
  mirror — it is delegated to the importer's own `siteValueFor`, newly extracted
  and now used by both. Parity compares raw-to-raw, so a mirror storing `"true"`
  where the importer stores `1` would red every hourly run; a test asserts the two
  paths agree byte-for-byte.

  An unknown watch condition is refused rather than sent. The records API would
  create a missing select option as a `typecast` side effect — the
  silent-option-creation hazard this codebase refuses everywhere.

  Known gap, operator-owned: the cockpit supports a `turnstile-unverified` accept
  key and the Airtable field has no option for it, so that one condition still
  cannot be accepted from the console. Adding the option is a UI action; the API
  cannot create select choices.

- 2b81283: Prospect audit: ask the visibility engines a search, not a question about the site.

  The first production audit scored its subject 0 on AI Visibility, and two of the
  three category probes explain why. The probe stage was seeded with
  `AnalyzeResult.buyerQuestions` verbatim — questions the analyze pass writes _about
  the prospect's site_, where "What services does this agency actually offer?" and
  "Where are they located?" read perfectly well beside it. Sent to a live engine on
  their own, with no other context, they have no antecedent. One came back "I don't
  have any context about who 'they' refers to"; the other opened by looking for an
  uploaded file. Neither measured the prospect. The score measured our own prompt.

  `AnalyzeResult` now carries a separate `categoryQueries`: 3-5 standalone searches
  a buyer types _before_ they have heard of the company, which must never refer to
  it — not by name (the engine just echoes the name back, measuring nothing) and not
  by pronoun. `buyerQuestions` keeps its conversational phrasing, which is correct
  for the report's Answers section and was never the problem.

  The two uses had been sharing one field since the stage was written; the schema
  comment noted the dual purpose but the prompt only ever described the first one.

  `ProbeInput.buyerQuestions` is now `ProbeInput.categoryQueries`. `buildQueries`
  passes these through untouched, so nothing downstream can repair a query that
  arrives malformed — a test pins that guarantee at the boundary, and the schema
  rejects a thin array rather than letting it silently starve the probe stage and
  read out as a prospect who never surfaces.

  Also tightens how a brand mention is detected, which had the mirror-image flaw.
  `brandMentioned` was a bare `includes()`, so a prospect called Ace scored on every
  "surface", "placement" and "spacer" in an engine's prose. It now matches on word
  boundaries.

  Word boundaries alone don't settle it, though: a prospect called Summit, Apex or
  Bloom is a common noun, and "the summit of the roofline" is a clean word match. A
  single-token name is therefore no longer scored on an unprompted mention alone —
  it needs the domain citation to corroborate. Multi-word names and domain fallbacks
  still count on their own, since prose can't produce those by accident. The mention
  is recorded truthfully either way; this governs only what the score counts.

  That under-credits a genuinely distinctive one-word brand, which is the error worth
  making. The number goes in front of the prospect, and "you were mentioned here" has
  to survive them reading the snippet underneath it.

- 784d2a8: The drafting path now dual-writes its report state into Turso (#539 Phase 5).

  Before this, the only report mirrors were UPDATEs on the request path (approve,
  override, delivery status, commentary). Everything the DRAFTING path writes
  reached Turso only via the hourly sync — and two of those gaps are visible to the
  operator today: a fresh draft's row does not exist, and its preview route answers
  "No rendered body stored for this report." for up to an hour.

  `makeReportMirror` covers all four writes as one injected object:

  - **created** — `mirrorReportInsert`, the first INSERT-capable report mirror. It
    maps with the importer's own `mapReportRecord`, which is also what parity diffs
    against, so the row is parity-clean by construction rather than by a column
    list someone has to remember to extend.
  - **body** — the rendered HTML, stored where the console preview reads it.
  - **patch** — the queue flag, for the new draft AND every row it supersedes;
    mirroring only the new one would show a site with two queued reports.
  - **patch** — a re-run's refreshed scores on the announce/launch reuse paths.

  Wired at the composition roots (the nightly `--due` batch, `announce`, `launch`)
  rather than defaulted inside the recipes: a default would open a real libSQL
  handle from inside `draftReportForSite`, which every unit test calls, and on a
  machine with `TURSO_*` exported that means tests writing into production.

  Unlike the Phase 3 mirrors this one never returns null. #585 is why: that helper
  returned null without creds and the dual-write silently no-opped for weeks,
  because a dead mirror and a healthy one produced identical output. Here
  creds-absent is a state the mirror reports, so every write emits one
  `REPORT_MIRROR` line and an absent line means the wiring is gone.

- c9d44d7: `report --rerender <id>`: regenerate an unsent report's stored HTML.

  The console preview serves the body stored at draft time, so commentary edited
  afterwards never appeared. This regenerates it through the same renderer the send
  uses, so the preview is what the client will actually receive.

  The assembly that built `ReportData` inline inside `sendOne` is lifted into
  `renderReportFromRow`, which both now go through — a preview whose only job is
  fidelity is worthless if it renders through a second path that agrees with the
  sender by coincidence.

  Header bytes come from Turso (design D5) when stored, falling back to the
  Airtable attachment. A SENT report is refused before any work: its stored body is
  the record of what the client received.

  Runs as a CLI rather than in a Netlify function because rendering needs sharp, a
  native module no function bundles — and approximating the header geometry to
  avoid it would trade away the exact fidelity a preview exists to provide.

- 591f944: "Refresh preview" for a report, from the console.

  Adds `report-rerender.yml` (dispatch-only) and a button beside the preview link
  on any unsent report. Clicking it dispatches the workflow, which runs
  `report --rerender` where sharp already works and stores the fresh body where the
  preview route reads it.

  `dispatchWorkflow` gains optional `workflow_dispatch` inputs, omitted from the
  request body entirely when absent — a workflow that declares none rejects an
  `inputs` key it did not ask for.

  The sent-report guard is duplicated in the handler rather than left to the
  workflow, so an operator gets an immediate refusal instead of a red run two
  minutes later saying the same thing.

- 22000ed: The one-off Websites writers now dual-write into Turso (#539 Phase 5).

  Phase 3 mirrored the nightly sweep — the fleet audit write-back, github-signals
  and the next-due dates. It did not touch the writers that run on their own
  schedule or on demand, so each of these reached Turso only via the hourly sync,
  which stops existing at the freeze:

  - `updateAnalyticsHealth` (drafting and announce) — the per-site
    analytics-failure signal the cockpit reads
  - `updateAutoFixAttempts` (nightly Renovate dispatch) — the "auto-fix exhausted"
    chip's counter
  - `updatePrismicModels` — the model-drift verdict, checked-at and detail
  - `updateLaunched` (a Launch send) — Status **and** `Launched at`
  - `updateSiteField` (forms-notify-target) — the verify-mode Status flip
  - the **single-site** audit write-back, from `audit --write-airtable` and
    `launch`; only the fleet path ever passed a mirror

  `makeSiteMirror` covers them with two ops, because a Websites row is split across
  two Turso tables: `health` for `site_health` columns and `site` for `sites`. Each
  takes the exact FieldSet the Airtable writer returned — the four writers that did
  not return theirs now do — so the mirror cannot carry a different payload than
  the write it shadows.

  `mirrorSiteFields` is the new multi-column form of `mirrorSiteField`.
  `updateLaunched` is why: it flips `Status` and stamps `Launched at` in one
  Airtable update, and mirroring those separately would open a window where Turso
  says a site is maintained but never launched.

  Like `makeReportMirror` and unlike the Phase 3 factories, it never returns null.
  Every write emits `SITE_MIRROR site=X op=health|site mirrored=1|missed|0|absent`,
  so an absent line means the wiring is gone. `missed` is its own outcome: the
  UPDATE matched no row because the sync has not imported that site yet, which is
  neither a success nor a failure.

## 0.86.0

### Minor Changes

- d6093a5: Announcement and Launch reports get their own header headlines ("Your website is
  set up for ongoing care." / "Your website is live."), closing the blank band
  those types have shown since headlines moved off the plate. All four report
  types now stamp a headline.

  Also generalises the alpha recovery for Figma MCP exports, which are always
  flattened onto whatever sits behind the node — a white frame for
  Maintenance/Testing, Figma's canvas grey for the two new ones. The backdrop is
  now detected instead of assumed white, and the channel with the most ink/backdrop
  separation is used (green separates the brand red from white by 221 levels but
  from canvas grey by only 4). Re-verified against the known-good Maintenance
  asset: unchanged at mean abs alpha diff 0.022.

- 0d4454c: feat(db): header images land in Turso — design D5 completed (#539 Phase 2)

  New `db backfill-header-images` copies every site's current Airtable "Header
  image" attachment into `sites.header_image*` (idempotent — a populated BLOB is
  never overwritten, so a re-run can't clobber a freshly generated image), and
  the header-image CLI's `--write-airtable` now dual-writes: every upload also
  lands the bytes in Turso, stamped with the generation time. This makes the
  read layer's `headerImage` real, unblocking the cockpit and approve-report
  repoints whose preflight reads it.

- d59b525: feat(db): hourly Airtable → Turso sync — the Phase 2 backbone (#539)

  New `db sync` action: one pass = import (attachment fetches only where the
  stored report row lacks a body) + the parity check, with one internal retry to
  absorb a write landing between the import's read and the parity check's read.
  Emits `FLEET_SYNC … mismatches=0` on every clean run; exits 1 on persistent
  mismatch. The new `fleet-db-sync` workflow runs it hourly at :20 with the
  fleet-smoke-style tracking-issue alarm, keeping Turso fresh while Phase 2
  readers move over and writers still write Airtable.

- c1013f2: Phase 0 of the Airtable → Turso migration (#539): a lead whose site lookup fails
  is dead-lettered, not lost.

  `ingestSubmission` awaited `getWebsiteBySlug` — an Airtable read — before
  anything was persisted, so a thrown lookup 502'd the visitor with the lead
  recorded nowhere. The 2026-08-17 quota outage did exactly that, while the
  submissions store (Turso) was healthy the whole time; it is why that outage's
  lead loss was unmeasurable after the fact.

  With the new `deadLetter` dep wired (the production handler wires it to the new
  `submission_deadletter` table, migration 0006), a thrown lookup now writes the
  raw payload, slug, error, and the Turnstile verification computed at receipt —
  tokens expire in 300s, so replay reuses that answer — and the visitor gets an
  honest "accepted". `reddoor-maint db replay-deadletters` then runs each captured
  lead back through the normal ingest pipeline once the lookup recovers: real spam
  classification, notify, and fan-out, oldest first. Replay outcomes that the
  store actually answered (accepted, rejected, unknown-site) are terminal; a
  lookup that throws again leaves the row for the next run — and the replay
  strips any smuggled `deadLetter` dep so a retry can never mint a duplicate. A
  stored `fail` verdict still escalates on a `requireTurnstile` site: replay does
  not launder spam.

  Three boundaries hold: a lookup that _resolves_ null is still `unknown-site`
  (the store answered); a testMode probe still throws (the form-e2e audit must red
  when central ingest is degraded, and a probe persists nothing worth saving); and
  a failing dead-letter write propagates (both stores down — the 502 is honest).
  Callers that never wired `deadLetter` are byte-for-byte unchanged.

- 2b1f16e: feat(forms): form ingest's site lookup is now Turso-primary (#539 Phase 2)

  The lead hot path no longer touches Airtable: `makeSiteLookup` reads the site
  row from Turso's `sites` (kept fresh by the hourly sync), consulting Airtable
  only for a slug Turso doesn't know — the new-site window between a launch and
  the next sync. This retires the 2026-08-17 outage class where an Airtable
  quota outage broke the site lookup while the lead store itself was healthy. An
  Airtable failure during the rare fallback still lands the lead in the
  dead-letter for replay.

- 843543a: Skip all spam handling for sites whose status is `in development`.

  Building a site means testing its form — from one address, across several
  unrelated sites, minutes apart. That is exactly the cross-site repeat-sender
  signature `ingestSubmission` is built to catch, so a site under construction
  reliably auto-spammed its own builder's test submissions: the row landed
  `spam_auto`, notify was skipped and the cockpit hid it, which is indistinguishable
  from a broken form.

  An `in development` site has no real visitors, so spam handling there protects
  nothing. Content scoring, the required-Turnstile escalation, the cross-site
  repeat-sender scan and the duplicate/spray scan are now all skipped for those
  sites — including their retroactive re-bucketing of rows belonging to _other_
  sites, which a test submission has no business triggering. Behaviour on every
  other status is unchanged.

- fbea2e3: feat(dashboard): the cockpit, site page, and approve gate read from Turso
  (#539 Phase 2 — the last request-path repoints)

  fleet-homepage and site-dashboard now read sites, health, and reports from
  Turso as their core data (a Turso failure 502s cleanly rather than rendering a
  misleading empty page); Airtable remains only for the digest NEW-badges.
  approve-report's gate reads (report by id, site by id) come from Turso — kept
  current within the same request by the #563 write mirrors — while its writes
  stay on Airtable + mirror. With this, every dashboard and forms request path
  reads fleet state from Turso; Airtable requests on the hot paths are down to
  the editor's write, the approve/override write, the webhook's delivery-status
  write, and the digest state.

- 604d3c2: Add `prospect-audit <url>`: a three-tier AEO/SEO audit of an external prospect's
  site (crawler access + JS-dependence checks, a Claude answerability pass, and
  live AI-visibility probes across Perplexity and Claude web search), rendered as
  a branded report and published at a public tokened link (`/r/:token`).
- f32089b: feat(db): report-write mirrors + BLOB-free site reads (#539 Phase 2)

  Approve/override and the resend-webhook's delivery status now mirror their
  Airtable writes into Turso `reports` (same pattern as the editor's
  write-through), so the page re-render after an action shows the new state
  immediately instead of after the next hourly sync — the prerequisite for the
  site-dashboard/cockpit repoints. And the fleet-state read layer now selects
  explicit sites columns instead of selectAll: since the header-image backfill,
  the BLOB column holds multi-MB JPEGs that would otherwise ride along on every
  ingest lookup and 44× per fleet list. A schema-lockstep test keeps the column
  list complete as migrations add columns.

- 2d37c0b: Header images no longer bake "Your website maintenance is complete." into every
  report type. The generator now composes on a CLEAN plate (no headline), and the
  send path stamps the report type's headline onto the stored image: Maintenance
  gets its headline overlay; Announcement, Launch, and (for now) Testing go out
  clean. Testing's overlay is absent because its 2026-08-20 Figma export shipped
  flattened onto an opaque red rectangle — re-export it transparent and register
  it in HEADLINE_FILES to enable it. Stored pre-switch headers keep their baked
  headline until the site's next draft regenerates them; drafting refreshes the
  header, so this self-heals within one report cycle (or run
  `header-image --all --force`).
- 119a431: feat(db): the reports read layer + Turso-served report previews (#539 Phase 2)

  `listAllReports` / `listReportsForSite` / `getReportHtml` read reports from
  Turso in the exact `ReportRow` shape the Airtable module returns, pinned by the
  same reader-equivalence instrument as sites. The stored stable-key checklist is
  re-keyed back to the Airtable column names consumers expect. `renderedHtml`
  links now point at the dashboard's own `/api/reports/:id/preview` route
  (serving `rendered_html` straight from Turso, behind operator Basic auth)
  instead of Airtable's expiring signed URLs — stale dashboard tabs no longer
  404 their preview links. Also fixes the importer double-encoding the
  `Checklist auto-evidence` long-text cell (a string of JSON was
  JSON.stringify-ed again, which would have read back as null evidence); the
  hourly sync converges existing rows on its first post-deploy pass.

- c9a2575: feat(dashboard): submissions page, trigger-renovate, and the site-detail
  editor read from Turso (#539 Phase 2)

  Three more request-path surfaces repoint to the fleet-state read layer. The
  submissions page and trigger-renovate no longer touch Airtable at all. The
  site-detail editor reads from Turso, still writes Airtable (the Phase 2 source
  of truth), and now MIRRORS each saved cell into `sites` immediately — so a
  Turso-reading page shows the edit at once instead of after the next hourly
  sync. The mirror reuses the importer's own column map (one truth), with a
  lockstep test making an unmapped editor field a build failure.

- 4506fda: Phase 1.5 of the Airtable → Turso migration (#539): nightly encrypted backups
  with the restore rehearsed on every run — closing the no-backup gap open since
  the 2026-08-02 architecture review.

  `db dump` emits the whole database as plain SQL through the DATABASE-level
  url+token the workflows already hold — `turso db dump` needs a browser-OAuth
  platform login a workflow cannot do. Deterministic (stable table and row
  order, so unchanged data dumps byte-identically), BLOB-safe (X'hex'), and
  loadable by stock `sqlite3` — the engine a real disaster would replay it into.

  `db verify-dump` is the rehearsal: load the dump into a fresh scratch engine
  and compare restored row counts against the INSERT counts in the dump text
  itself, emitting `DUMP_VERIFY … mismatches=N` on every run, clean included.
  A dump that cannot restore is not a backup.

  `fleet-db-backup.yml` runs both nightly, refuses a dump with no sites rows
  (a broken dump path, not an empty fleet), refuses to upload plaintext when
  BACKUP_PASSPHRASE is unset, gpg-encrypts, uploads with 30-day retention, and
  files/auto-closes a tracking issue on failure — the fleet-smoke alarm plumbing.
  The gate script is extracted from the YAML and executed under `bash -e` in
  tests, clean case first.

  Proven live before merge: a production dump (749 rows, 9 tables) verified
  mismatch-free in the scratch engine AND restored into stock sqlite3 with all
  44 sites, 337 submissions, and 13 reports intact.

- 9dd6dbe: Phases 1.1–1.4 of the Airtable → Turso migration (#539): the writer map, the
  fleet-state schema, the importer, and the parity harness.

  The writer map (docs/superpowers/specs/2026-08-23-websites-writer-map.md) is
  derived from the LIVE Airtable schema — the design's table split is no longer
  provisional: every code-written column has exactly one writer, partitioning
  exactly on the design's `sites` / `site_health` / `site_schedule` lines.

  Migration 0007 creates those tables plus `reports`, PKs = Airtable rec ids
  (design D1). Airtable's misspellings die at the boundary; the report checklist
  re-keys from Airtable column names to the stable keys in checklist.ts;
  `site_health.analytics_soft_fail_at` gives code the column no operator ever
  created in Airtable. The 33 populated-but-unreferenced columns land in one
  `sites.legacy` JSON object; the plaintext DNS/cms credential cells never
  migrate at all (operator ruling 2026-08-23 — they live on only in the frozen
  base), and the mapped output is tested to contain the secrets nowhere.

  `db import-airtable` upserts idempotently: a re-run converges, never wipes a
  regenerated header image (Airtable stopped being its source, D5), and keeps a
  captured `rendered_html` when the attachment's signed URL has expired — misses
  are named in the summary, never silent.

  `db parity` diffs both stores field-by-field using the importer's own mapping
  functions, so what parity expects is definitionally what the importer writes.
  It emits `FLEET_PARITY … mismatches=N` on every run, count=0 included (an
  absent line means "never ran", not "ran clean"), and its known-good pass —
  green immediately after an import — is the first test in the file, per the
  repo's prove-the-instrument rule.

- 133ef64: feat(db): the Turso fleet-state read layer (#539 Phase 2)

  `src/db/fleet-state.ts` — `getSiteBySlug` / `getSiteById` / `listSites` return
  the exact `WebsiteRow` the Airtable module returns, so each Phase 2 repoint is
  an import-only swap. Coercion reuses the Airtable module's own exported
  coercers (one truth per field), pinned by a reader-equivalence instrument that
  deep-equals `mapRow(record)` against the Turso read-back across rich, sparse,
  and adversarial fixtures. `headerImage` deliberately reads from Turso's own
  columns (design D5) — null until the Phase 3 header-image writer lands, so
  approve-report keeps its Airtable reader until then. Also aligns the importer's
  Accepted Watch Conditions array trimming with `mapRow` (whitespace-only entries
  now dropped on both sides).

### Patch Changes

- 13c0602: Fix two client-facing strings in the announcement email.

  The inbox preview line was hard-coded to "Your monthly report from Reddoor" —
  wrong twice over: this email is the announcement, not a report, and it asserted
  a monthly cadence that the body contradicts for every client on a quarterly or
  yearly pace. It is now `Your ongoing site care for <site>`, interpolated like
  the launch ("<site> is live") and maintenance ("Checked up on <site>")
  templates already were.

  The framework improvement callout now reads "our latest framework" rather than
  "the latest framework".

- 1d2ebd0: fix(airtable): make the attachment prune actually prune

  `uploadAttachment`'s `replace` option never removed anything against the live API. Two
  independent faults: the post-upload response keys `fields` by **field ID**, not field
  name, so the lookup returned `undefined` and the empty list hit the `length <= 1` guard
  and returned silently; and the prune PATCHed `/v0/{baseId}/{recordId}`, omitting the
  table segment Airtable's update endpoint requires, which 403s.

  `replace: true` is now `replaceIn: "<table>"` so the table cannot be omitted, an
  unresolvable attachment list warns instead of returning quietly, and the PATCH path
  shape is pinned by a test.

- f8950b8: `db sync` / `db import-airtable`: mirror Airtable deletions into Turso.

  The importer was upsert-only, so a record deleted in Airtable stayed in Turso
  forever. Parity flags that (correctly — a Turso row Airtable no longer has is a
  real divergence), which meant one routine operator deletion wedged the hourly
  `fleet-db-sync` red permanently, with no self-healing path and a retry that
  re-read Airtable only to reach the same verdict.

  The import now reaps rows whose Airtable record is gone, including a deleted
  site's `site_health` and `site_schedule` rows (no foreign keys are declared, and
  parity only reverse-checks `sites`, so those would otherwise linger unnoticed).

  Reaping is the only destructive thing the importer does, so it refuses to act on
  a read it cannot trust: never when Airtable returns zero rows while rows are
  stored, and never more than `max(5, 10%)` of a table in one pass. A refusal
  deletes nothing and leaves the run red — a wedged sync is recoverable, an
  emptied Turso is not. Every removal is named and every refusal quoted on the new
  always-emitted `FLEET_REAP sites=N reports=N refused=N` line.

- efb385a: Key the form-e2e `BUDGET_THIN` warning on the span the budget actually governs.

  `INGEST_TIMEOUT_MS` aborts the site→central fetch — which lives inside the form
  action's POST — and nothing else. The warning compared it against click→banner,
  a span that also contains Turnstile's token round-trip and the browser's render
  of the success banner. On 2026-08-17 vineyard-custom-homes warned at 16.9s
  click→banner while its own function answered in 0.25s warm / 2.0s cold: the
  check was reporting page-render time as abort risk.

  The runner now stamps `postElapsedMs` (click → the action's POST response) as a
  side-effect of the response capture it already performs, and the thin check
  compares that. No POST observed → no claim: the check does not fall back to
  click→banner, which would quietly reintroduce the over-warn for exactly the runs
  where attribution is least knowable. A pre-click POST (an analytics beacon
  matching the capture before the submit) leaves the timing unstamped rather than
  computing an epoch-sized "elapsed" that would trip the warning it exists to fix.

  A genuinely slow POST still warns — the 1836dig failure mode is unchanged.

- 5a97866: Hide the report ANALYTICS box when the previous GA period is a literal 0: a zero
  last period means the tag wasn't collecting for a full window (new property or
  mid-window install), so the count/trend is partial-window noise. A search body
  line still keeps the block alive (count suppressed); `previous === undefined`
  (GA gave no prior window) is unchanged and still shows the count.
- 417c1e2: fix(reports): read the newest header attachment, and refresh it in `announce`

  Both header readers took `attachments[0]`, but Airtable's `uploadAttachment` appends, so
  the newest file is the tail — a field that ever stacked served its oldest image forever.
  `reports/airtable/websites.ts` and `db/header-images.ts` now take the tail, keeping the
  send path and the Turso mirror in step.

  `announce` never refreshed the header, so a site whose stored header predated a plate
  change kept announcing with the old one until an unrelated Maintenance/Testing draft
  healed it. It now refreshes like `draftReportForSite`, with the same `refreshHeader: false`
  opt-out for unit suites.

- 15aa9f2: `report --due`: say so when the `site_schedule` dual-write has no mirror.

  `writeNextDueDates` mirrors each next-due write into `site_schedule` through a
  best-effort mirror that resolves from `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.
  Absent those, it returns null and the dual-write silently never runs — no
  warning, no nonzero exit, only a missing `mirrored=` suffix that reads exactly
  like a healthy run.

  The `NEXT_DUE_WRITE` line now ends in `mirror=absent` in that case. Counters stay
  off deliberately: `mirrored=0` would claim a write that returned nothing rather
  than one that was never attempted.

- 82a69fe: Never stamp a headline onto a header that already has one. A header built on the
  old baked plate is canvas-sized, so nothing stopped it being stamped — the new
  headline printed directly over the baked one and the two overprinted into
  unreadable text, which shipped in a real announcement. The headline band is now
  measured first: it is empty on a clean-plate header and holds ~62k red px on a
  baked one, so such headers are sent as stored and self-heal on the next draft.

  Also stops Airtable attachment fields from silently serving a stale file.
  Airtable's uploadAttachment endpoint APPENDS, while readers take attachment [0]
  — the oldest — so repeated header regeneration stacked four images and kept
  sending the first. `uploadAttachment` takes `{ replace: true }`, used for the
  site header, which prunes back to the file just uploaded.

- 783d65f: Dashboard site editor: cover the fields nothing rendered (#539 Phase 4).

  Seven of the eight fields the migration design lists as uncovered are now
  editable and rendered — `Netlify ID`, `Search Console property`,
  `Newsletter Webhook`, `Mailchimp Audience ID`, `maintenance day`, `testing day`
  and `Notify Routing` — with three new field kinds: `url` (the same http(s)
  allowlist the deployed-audit target uses), `date` (a real calendar day, so a
  rolled-over `2026-02-31` cannot silently reschedule a site), and `notifyRouting`
  (validated by `parseNotifyRouting` itself, so the editor cannot store a value the
  reader would drop).

  `WebsiteRow` gains `notifyRoutingRaw`, the verbatim cell behind the parsed
  routing — the same reason `statusRaw` exists. Rendering the re-serialized object
  would drop keys the parser ignores and reformat what the operator typed.

  The eighth field, `Mailchimp API Key`, is deliberately still absent: it is a live
  credential, and every editable field is rendered back into the page carrying its
  stored value. It needs a write-only kind first, and a test now fails if it is
  added without one.

- 0f01895: Give the smoke audit a budget that fits the suites it runs, and make a timed-out
  site impossible to mistake for a healthy one.

  `reddoor` and `beachfront-dentistry` had been failing the nightly fleet smoke for
  four consecutive nights while the workflow reported success every morning and
  Airtable kept showing both green.

  Three separate things had to line up for that:

  1. The budget was 5m00s. reddoor-website's own `Smoke test` step takes **4m57s** on
     a 2-core GitHub runner with chromium already installed and `node_modules` warm
     (run 32413378638). The fleet path is strictly heavier — the site's `test:smoke`
     is `playwright install chromium && playwright test`, so the browser install lands
     _inside_ that budget, on a fresh clone. Three seconds of headroom in the best
     case; the medtech release pushed both sites over. They were killed at 5m03s and
     5m04s — the wall, not their suites. The budget is now 15 minutes, ~3x the
     measured cost and still far inside the workflow's 90-minute step backstop.

  2. A timeout rethrew into `runOneAudit`'s catch-all and became
     `smoke: unexpected error — Error: spawn timeout…`: nominally a `fail`, carrying
     no `details`. The Airtable writer keys on `details.checkedAt`, so it correctly
     preserved the prior verdict rather than record a false fail — which is right, and
     is also exactly why the row kept serving a stale green tick. Timeouts are now a
     distinct outcome, `smoke: NOT MEASURED`, still detail-free so write-back behavior
     is unchanged. `SpawnTimeoutError` makes the case identifiable instead of matched
     by message text.

  3. `fleet-smoke.yml` gated only on `FLEET_WRITE_SUMMARY`, which counts rows
     **written**, not rows passing — and an unmeasured site still writes, because it
     writes nothing new. The gate was structurally incapable of firing. The CLI now
     emits `FLEET_SMOKE_UNMEASURED count=N sites=…` on every fleet smoke sweep,
     count=0 included, and the workflow reds the run when N > 0 or the line is absent.

  A suite that RAN and failed is still data, not an outage, and still exits 0 — only a
  measurement that never happened reds the nightly.

  The gate is executed, not asserted: `tests/build/fleet-smoke-workflow.test.ts`
  extracts the step's shell out of the YAML and runs it under `bash -e` against a
  stubbed CLI, with the clean-sweep case first so the alarm is proven to pass before
  any failure it reports is believed.

- 308fe87: perf(db): indexes for every hot-path query, enforced by an EXPLAIN-query-plan gate

  Migration `0008_query_plan_indexes` adds the indexes the request-path queries
  actually need — `submissions(submitted_at DESC)` (windowed reads and the
  /submissions default page), a partial covering index on `spam_reason` (the facet
  tally the gate caught full-scanning), `resend_message_id` (webhook bounce
  lookup), `submission_id` (O(1) display numbers), and `spam_screenouts(date)`.

  The new gate (tests/db/query-plans.test.ts) captures every statement the db
  modules execute at the driver, runs each through EXPLAIN QUERY PLAN, and fails
  the build on any raw full-table scan — with module- and export-completeness
  checks so a new Phase 2 reader module or query function cannot dodge it, and a
  vacuity check so a scenario that executed no SQL fails instead of passing.

- 005d315: Testing reports now get their own header headline ("Your website maintenance &
  testing is complete.") instead of shipping on the clean plate. The 2026-08-20
  asset was unusable because a Figma MCP export arrives flattened onto opaque
  white; the alpha is recovered arithmetically from the ink colour rather than
  re-exported by hand, verified against the known-good Maintenance asset at mean
  abs alpha diff 0.02. Announcement and Launch still ship clean — their copy has
  to be typed in Figma desktop, where the licensed headline font lives.
- d66b807: fix(selftest): apply the report-type headline to the preview header

  `selftest email` downscaled the stored header directly, skipping the
  `applyReportTypeHeadline` step `orchestrate.ts` performs. Since the stored header is
  the clean plate, every preview shipped a header with an empty headline band — the
  artifact meant to catch a bad header was itself wrong, and matched no real send.

- 31b4ce8: Site-status vocabulary stage 3: the old Airtable names are gone from the code.

  The operator deleted the seven retired options from the Airtable `Status`
  single-select, so an old value can no longer be entered — which was always the
  gate, rather than merely "none is stored". `AIRTABLE_STATUS_ALIASES`,
  `AIRTABLE_OLD_NAMES` and `AIRTABLE_USES_NEW_VOCABULARY` are deleted, and both
  `canonicalizeStatus` and `toAirtableStatus` reduce to the identity.

  One behaviour changes, and it is intended: an old name is no longer translated.
  `canonicalizeStatus("maintenance")` used to yield `maintained`; it now yields
  `"maintenance"` verbatim, which `isUnrecognizedStatus` flags and the cockpit
  surfaces as a watch row. A stored old value would now mean something went wrong
  — a restored backup, a scripted write, a caller with a stale constant — and the
  fleet should say so rather than absorb it into a status nobody chose.

  Selection is unchanged: no fleet operation gains or loses a site.

## 0.85.2

### Patch Changes

- 40005b3: The baseline CSP now allows Svelte's SSR event-replay stub, by pinned hash.

  Svelte's server renderer emits `onload`/`onerror="this.__e=event"` on any
  load/error element carrying a spread attribute or a `use:` directive — which is
  every `<img {...getImageProps(field)} />` the Prismic helpers produce. The stub
  stashes an event that fires before hydration so the component can replay it once
  it is alive.

  Hashes do not apply to inline event handlers unless `'unsafe-hashes'` is
  present, so the baseline refused to run it. Two consequences, both permanent:
  the pre-hydration `load`/`error` was silently dropped, so anything keyed on it
  (a fade-in, a fallback swap) could strand; and a `script-src-attr` violation was
  reported per image on every page view, which buried real violations, hammered
  the report endpoint, and kept Playwright's `networkidle` from settling. Measured
  on beachfront-dentistry: 12 violations on `/` alone, ~40 across nine routes.

  `script-src` now carries `'unsafe-hashes'` plus the SHA-256 of that exact
  one-liner, exported as `SVELTE_EVENT_REPLAY_HASH`.

  On the security tradeoff: `'unsafe-hashes'` widens hash matching to event
  handlers, it does not permit arbitrary inline handlers — only this exact text is
  allowed, and the stub does nothing but assign the event to a property. The test
  asserts `'unsafe-inline'` is never present alongside it, since that would let
  any handler run and make the hash meaningless. The hash is recomputed from the
  handler text inside the test rather than copy-pasted, so a wrong literal in the
  source cannot be confirmed by an equally wrong literal in the test.

  Verified in Chrome against a page served with this policy: the handler runs and
  `img.__e.type === "error"`. Under the previous baseline, on the same page, it
  did not run at all.

  A site that overrides `script-src` replaces the baseline entry wholesale, so it
  must carry both tokens itself or it reintroduces the violation.

- 2c7660b: Playwright runs get their own port and never reuse a server they didn't start.

  `reuseExistingServer` was `!process.env.CI`, so a local run reused anything that
  answered the readiness probe. The probe only asks "does this URL respond?" — it
  never asks "is this server serving the code I am about to test?" So a vite left
  open from earlier, or one whose working tree changed underneath it after a
  checkout, silently became the system under test.

  That fails in both directions, and the second one is the expensive one. A false
  red gets blamed on the code: on beachfront-dentistry two `qa-expand` tests failed
  deterministically while CI was green on the same commit, which read convincingly
  as a macOS-vs-Linux platform difference, was investigated as one, and reached a
  PR description before anyone noticed the tests were correct. A false green is
  worse and quieter — you change code, the suite passes against the old build, and
  nothing ever prompts you to look twice. CI was immune because `CI` flipped the
  flag to `false`, and that asymmetry is exactly what made the whole thing look
  like a platform bug instead of a config one.

  Local runs now allocate their own free port instead of falling back to the fixed
  5173, so your dev server keeps running untouched and a collision is no longer
  possible. `REDDOOR_SMOKE_PORT` still wins when the central smoke audit supplies
  one. The cost is a fresh vite boot per run, roughly 10-20s against a ~2 minute
  suite.

  The port is allocated through a short synchronous subprocess rather than by
  making the config an async export, because sites consume this base by
  **spreading** it (`{ ...base, use: { ...base.use } }`). Spreading a Promise
  yields none of its properties, which would have handed every site a silently
  empty config — the same false-green class this change exists to remove.

## 0.85.1

### Patch Changes

- ca9a208: Internal fleet mail falls back to the operator inbox, not the client inbox.

  When `OPERATOR_EMAIL` is unset, the daily digest, the fleet analytics-failure
  alert, and `selftest-email` all addressed `info@reddoorla.com` — the shared
  client-facing inbox other staff read and reply to clients from. They now fall
  back to the operator's own monitored address, which is what the pre-launch lead
  guard in `forms/notify` had been doing correctly all along.

  The split was not a decision anyone would defend written down; it was four call
  sites each spelling out their own default, and one of them disagreeing. They now
  share a single definition in `src/util/operator.ts`, so there is one place to be
  right and no way for the next caller to pick the wrong inbox by copying its
  neighbour.

  This surfaced on 2026-08-17. The scheduled `daily-reports` run failed before it
  reached its digest step, so the digest was re-run by hand from a laptop — where
  `OPERATOR_EMAIL` was unset, because it had only ever been set as a GitHub
  Actions repo variable. CI was correct and every local run silently was not. The
  fleet digest arrived in the client inbox, and a colleague forwarded it back
  asking what it was.

  The failure mode worth naming is that nothing broke. A fallback that resolves to
  a real, deliverable address cannot fail loudly — it just quietly picks the wrong
  audience, and the only reason this was caught is that a human happened to read
  it and ask. Degrading toward the inbox the operator actually watches is the
  difference between a missed email and a misdirected one.

  Client-facing `Reply-To` and the forced ops CC on client report sends still use
  `info@reddoorla.com`, which is correct — a client replying to a report should
  reach the shared inbox. Only the operator-recipient fallbacks moved.

## 0.85.0

### Minor Changes

- f397ec2: An expected Prismic divergence can be accepted — until a date, and no longer.

  A `fail` is sometimes correct and already known: the operator is modelling in
  Prismic on a branch that has not landed, so Prismic is legitimately AHEAD of
  `main` and the nightly is faithfully reporting a divergence nobody needs to act
  on. Until now the only options were to leave a permanent red item in the
  needs-you feed or to stop believing the feed — and the second one happens on its
  own, which is how a fleet stops reading its own alarms.

  The new `Prismic Ack Until` column (dateTime) accepts one site's `fail` until a
  moment the operator picks. While it is in the future the drift item is not
  raised, and the cockpit carries a muted `Prismic drift accepted until
2026-08-30` chip instead — an accepted finding is still a finding, and the site
  must not read as plainly healthy.

  **It expires, and nothing renews it.** A permanent ack would reproduce this
  column's own failure mode one step later: once the branch lands, the same acked
  cell would silently swallow real drift, and "nobody is looking at this" would
  render as "this is fine" — the exact collapse the drift sweep exists to prevent.
  An expiry means the worst case is a silence that ends by itself.

  It is deliberately narrow, and the placement in `collectPrismicDriftAlerts`
  enforces the narrowness rather than documenting it — the check sits after the
  `unknown` and staleness branches have already returned, so it is unreachable for
  either:

  - **never mutes `unknown`** — the check could not run at all, usually a dead
    write token. Accepting "Prismic is ahead of main" says nothing about a broken
    secret, and muting it would send the operator to fix a model when the job is
    to fix a credential.
  - **never mutes the staleness escalation** — a verdict nobody has re-established
    is not a verdict. If an ack also suppressed staleness, a site whose nightly
    had quietly died would look accepted-and-fine indefinitely.
  - **never mutes `pass`** — there is nothing to accept.

  Every uncertain reading resolves to "not acked": blank, whitespace, an
  unparseable date, or an expiry exactly equal to now. A mistyped cell costing one
  noisy item is recoverable; a mistyped cell silently muting a live finding is not.

  Ships dark until the column exists — absent, it reads null and nothing is acked.

## 0.84.0

### Minor Changes

- 9cd4a17: `prismic-ci` now refuses a site whose installed CLI cannot run the workflow it
  would install.

  The reusable workflow does not install this package. It runs `pnpm install
--frozen-lockfile` and then the site's **own** `reddoor-maint` bin, so the
  version that executes in a client repo is whatever that repo's lockfile pins.
  `prismic-models` first ships in **0.83.0** — verified by installing it from the
  registry and running `reddoor-maint prismic-models --help`, not by reading a
  changelog. Installing the caller next to an older binary yields a workflow that
  fails on its first model PR, in a client repo, with an error naming an unknown
  command rather than a rollout that ran too early.

  Measured across the twelve delivery candidates at the moment 0.83.0 published,
  every one of them pinned something older — 0.28.0, 0.65.0, 0.67.0, 0.69.0,
  0.75.1, 0.80.0, 0.81.0, 0.82.0. A rollout that day would have broken all twelve.

  The gate reads the **lockfile**, never the `package.json` range: espada declares
  `^0.81.0` while its lockfile resolves 0.69.0, and CI installs frozen, so the
  range is not what executes. It parses only the `importers:` section — the
  `packages:`/`snapshots:` sections list every transitively resolvable version and
  would happily report one nobody installed.

  Three refusals, deliberately distinct, because a gate that cannot tell "too old"
  from "could not read" reports one as the other:

  - **too old** — names both versions and says to bump the dependency and commit
    the lockfile
  - **cannot establish** — no lockfile, an unreadable one, an unrecognised shape,
    or the package absent
  - **ambiguous** — two importers resolving different versions, named, rather than
    a coin flip deciding whether a client repo gets a workflow it cannot run

  "Could not establish" REFUSES rather than proceeding. The asymmetry is
  deliberate: the cost of waiting is a re-run, and the cost of being wrong is
  broken CI on someone else's repository.

  The version comparison is numeric, position by position. As strings `"0.9.0" >
"0.83.0"`, so a lexicographic gate would wave through a site pinned seventy-four
  releases before the command existed — that specific inversion is covered by a
  test, and confirmed to fail against a string-comparison implementation.

## 0.83.0

### Minor Changes

- a1fe31b: Deliver Prismic content-model changes headlessly, from a reviewed PR.

  A custom-type or slice-model edit now rides normal code review: CI comments the
  delta on the pull request, and merging pushes the models to Prismic through the
  Custom Types API. Nobody opens Slice Machine to deliver a schema change, and the
  same comparison runs nightly across the fleet so an out-of-band cloud edit —
  Type Builder, a dashboard hand-edit, a stray Slice Machine push — surfaces as
  drift on the site's row rather than as a surprise months later.

  The reason this is worth building rather than tolerating: the Migration API
  silently drops any document field the registered model does not declare. HTTP
  200, no warning, content gone. A unit test cannot catch it, because the local
  model is correct and the binding constraint is the remote one.

  New: `prismic-models [site]` (dry by default; `--apply`, `--pull`, `--tokens`,
  `--fleet`, `--comment-file`, `--write-airtable`), a `prismic-ci` recipe and
  fleet command that roll the delivery workflow out as a per-repo pull request,
  a nightly `fleet-prismic-drift` sweep, and three Airtable verdict columns wired
  through to the cockpit and the morning digest.

  Two properties the design is built around, both enforced rather than documented:

  - **Nothing deletes.** The models module exports no delete path, and a
    module-wide capability guard fails the suite if any file in it acquires one
    through a channel the guard can see. Models present only in Prismic are
    reported, never removed. The guard is a tripwire against accidental
    introduction and explicitly not a security boundary — its header names the
    escape classes that remain open.
  - **"I could not read it" never renders as "it is not there."** Every probe in
    this feature separates whether a check ran from what it found, because
    collapsing the two is how a fleet check reports a clean run it never
    performed.

  Two operator steps are required before any of it does anything: add `unknown`
  as a third option to the Airtable `Prismic Models` single-select, and mint the
  `PRISMIC_TOKEN_*` secrets — `prismic-models --fleet airtable --tokens` prints
  the exact name per site and is the only authority on them, because four of the
  fifteen derive from a Prismic repository name that differs from the repo's.

### Patch Changes

- 6af67e4: Say which side a Prismic model difference is on, and stop two digest tests from
  depending on the day they run.

  **The `-` lines said the opposite of what they meant.** A model difference the
  repo lacked rendered as `- variation rail (REMOVED remotely)`, which reads as
  "the remote removed it". The truth is the reverse: Prismic is the side that
  still HAS it, the repo is the side missing it, and **pushing is what deletes
  it** — taking the document data with it at HTTP 200 and no warning. Read the old
  way, an operator goes hunting for who deleted something in Prismic when nobody
  did, and merges the push that actually does the deleting.

  They now read `- variation rail (only in Prismic — pushing DELETES it)`, naming
  the side and the consequence. This is not hypothetical: the line was misread
  once on live `reddoor-la` drift, and only settled by reading `compareZone` to
  see which argument was local and which was remote. A report line that needs its
  source read to be understood is not a report. The `⚠ DESTRUCTIVE` header was
  always correct; only the per-line wording was wrong.

  **`runDigest` now accepts an optional `now`**, like `collectAttention` already
  did. Several collectors it feeds are age-sensitive — `collectPrismicDriftAlerts`
  changes an item's key _and_ its wording once a verdict crosses
  `PRISMIC_DRIFT_STALE_DAYS` — so a digest test that cannot fix the clock is
  asserting on the day it happens to run. Two such tests were written against a
  fixture stamped `2026-08-12` and went red four days later, reporting the
  staleness wording as though the drift wiring had broken. Production behaviour is
  unchanged: omit `now` and the run captures `new Date()` before any await,
  exactly as before.

- 1e80078: Treat `reddoor-wireframer` as a placeholder repository name, like the starter's
  `your-prismic-repo-name`, so the Prismic model sweep skips the one repo that
  names it instead of demanding a credential for it forever.

  `data-dynamiq` points at Reddoor's shared wireframe repository rather than a
  content model of its own (operator ruling). It needs encoding rather than
  discovering, because it differs from the starter sentinel in the way that
  matters: **it resolves.** The Prismic repository genuinely exists — HTTP 200,
  two starter documents last published 2024-03-12 — so no failed lookup will ever
  reveal it as a placeholder the way a 404 would. Left unlisted it is a permanent
  `unknown` verdict on the site's row and a nightly `prismic-unknown:` cockpit
  warning that no credential can clear, because the correct number of tokens to
  mint for it is zero. The fleet token doctor goes from `1 missing` to `0 missing`.

  The check stays a `continue` rather than a `return null`, for every placeholder
  and not just the starter's: a half-migrated repo can hold a stale placeholder in
  `slicemachine.config.json` and its real configuration in `prismic.config.json`,
  and short-circuiting would drop a live site from the sweep on the strength of a
  file nobody reads any more.

  Note for anyone extending the list: a name added here is dropped from every
  sweep, so a real client repository added by mistake stops being checked and
  reports as "no Prismic here" rather than as an error. That is an operator
  decision, not a housekeeping one.

## 0.82.0

### Minor Changes

- ebd108c: Update prettier-plugin-svelte to v4 (resolves 4.1.1). v4 changes Svelte
  formatting output — notably it now preserves whitespace inside `<textarea>`
  (like `<pre>`) — so any formatting this package's tooling performs on Svelte
  files now emits v4 style. This aligns the tool's own plugin with the fleet
  baseline in `baseline-versions.ts`, which has advertised `^4.0.1` since #456;
  until now the tool itself ran v3 and could fight sites already on v4. This
  repo's only .svelte files are prettier-ignored test fixtures, so no source
  reformat was needed here.

### Patch Changes

- c5766b4: Update @google-analytics/data to v7. Its google-gax@6 pins google-auth-library
  to exactly 10.5.0 while our direct dep floats at ^10.6.2, which split the
  install in two and made the JWT we hand to BetaAnalyticsDataClient nominally
  incompatible with gax's AnyAuthClient (TS2322). A pnpm override now pairs every
  copy to the direct dep's spec, so one install serves both and the types agree.
- 7e73089: alerts: stop calling a transitive-only vuln episode "auto-fix failed"

  Sonder's digest said "2 critical/high vulns — auto-fix failed (5×)" (2026-08-10)
  when both HIGHs (brace-expansion, nanoid) were TRANSITIVE — Renovate's vuln
  alerts had no direct dep to bump, every nightly dispatch was a green no-op, and
  the real fix was Monday's lockfile-maintenance window. Two honesty fixes, both
  driven by the Dependabot `dependency.relationship` field now threaded through
  DependabotAlert → security audit → the persisted `Security advisories` JSON
  (no new Airtable field): the auto-fix-attempts counter no longer increments when
  every open critical/high advisory is proven transitive (a known no-op dispatch
  is not a failed attempt), and collectVulnAlerts titles such sites
  "transitive-only, fix rides the weekly lockfile window" instead of escalating a
  stale counter to "auto-fix failed" (no forced-critical, no digest-email
  inclusion — the amber cockpit Watch still shows them). Missing/unknown
  relationship data never mutes: those sites keep the old increment + escalation.

## 0.81.0

### Minor Changes

- fb2cee8: blux freeze: record the box every image is painted into, as `frozen/<uid>.image-boxes.json`

  A frozen page inherits whatever CDN variant the Blux export happened to use, and
  that bears no relation to the size the browser paints it at. On the-pointe: a
  5774px file (1.34MB) into an 823px box, 5341px into a 1425px band, 3960px
  carousel slides into 1425x760 — 4.03MB of 5.06MB in images larger than their
  box. That is page weight, and it is also what makes a cross-fade flash: waiting
  for `decode()` is a race against a download seven times longer than it needs to
  be.

  The render can only ask a CDN for the right size if it knows that size, and the
  size cannot be derived from the markup — Blux sets it in CSS, so an element
  carrying `width:5774px` renders at 823. `settle` is the one point in the
  pipeline holding a laid-out page, so it measures each media element there and
  stamps `data-rd-box`; `bakeImages` reads it back where slot keys are assigned,
  records `{w, h, source}` per slot, and strips the attribute again.

  `source` is `data-size`, the widest render that actually exists. It travels with
  the box because image CDNs upscale past it rather than refusing: asking a 123px
  badge for 900px takes it from 4.9KB to 30KB. A consumer must treat it as a
  ceiling.

  Emitted as a sidecar rather than a field on each slot: the slots manifest is
  what `migrate-frozen` PUTs into Prismic, and a painted box is a property of the
  layout, not of content an editor owns.

  Templates are unaffected — a freeze with measurements emits byte-identical html
  to one without, asserted directly.

### Patch Changes

- 75fbc9b: forms: suppress the autoresponder when the submitter's email is on the site's own domain

  A spam bot filled the MSOT contact form using the site's own info@ address as
  its email (2026-08-08, spamScore 55 — under the 60 auto-spam threshold). The
  "We got your message" autoresponder backscattered into the client's inbox as an
  unexplained confirmation. A submitter address on the site's own domain is never
  a real outside lead needing a confirmation, so buildAutoresponder now returns
  null for it (hostsMatch semantics: exact host or subdomain, case-insensitive,
  label-boundary safe; blank/unparseable site url fails open). The POC
  notification is unchanged — a human still sees and judges the submission.

## 0.80.0

### Minor Changes

- 6e536e6: New `forms-notify-target <site>` command: show who a form submission would email before sending one, and optionally flip the pre-launch guard with a read-back confirmation.

  The guard is a single Airtable `Status` cell. Nothing reported its state while testing — not the site, not `/health`, nothing between "I intended to flip it" and "the client received a test lead" — so on 2026-08-03 a flip that never landed sent a real client a test submission, which email cannot undo.

  Read-only by default. `--set on` routes notifications to the operator and then RE-READS the row to confirm; an unconfirmed flip prints `NOT CONFIRMED`, says not to test-submit, and exits non-zero, because a write call returning is not evidence the field changed. `--set off` requires an explicit `--restore <status>` and the command refuses to flip a site that is not `maintenance`, so it can never invent a status for a site that was `hosting` or `legacy`.

  Every address it reports comes back out of `resolveRecipients` itself — for a routed site each branch is probed and the results unioned — so the answer cannot drift from the real send path.

- 3640bec: protection-audit now checks that Renovate is allowed to act, not just that it ran. A fourth posture surface reads each repo's Dependency Dashboard and reports branches Renovate has filed under "PR Edited (Blocked)" — the state that froze dependency updates on nine fleet repos for a week in August 2026 while every workflow run stayed green.

  A blocked branch is reported only when nothing will clear it on its own: pushing a commit onto an open Renovate PR puts it in the same section, and that is routine practice rather than a fault, so a branch counts as a gap only when its tip was authored by a machine or it has sat untouched past `BLOCKED_STALE_DAYS`. The surface also reports dashboard sections it does not recognise, so a future heading rename cannot turn the fleet green in silence — Renovate already renamed this one once, in 43.0.0.

  Adds `GitHub.dependencyDashboard`, `GitHub.branchTip`, and the pure `parseBlockedBranches` / `parseUnknownSections` / `isMachineAuthor` helpers.

### Patch Changes

- 0bcf67d: Pin the a11y/smoke webServer to the port its readiness probe polls, always.

  `configs/playwright-a11y` applied `--port ... --strictPort` only when
  `REDDOOR_SMOKE_PORT` allocated one, on the reasoning that we should "fail loudly
  rather than let vite drift to a free port the baseURL doesn't point at". That
  argument covers the unset case too, and the unset case did not get it: 5173 is
  equally a fixed port that `baseURL` and the probe URL are pinned to, while vite
  was left free to drift off it.

  So when anything else holds 5173, vite starts on 5174, the probe keeps polling
  5173, and the suite dies on `Timed out waiting 120000ms from config.webServer` —
  two minutes of silence naming neither the port nor the squatter. Observed on
  the-pointe-burbank, where it read as an environment problem and got written off;
  it was hiding a genuinely failing gate test for two rounds of work. With
  `--strictPort` the same situation fails in a second with `Port 5173 is already
in use`.

  No overlap with `reuseExistingServer`: that check runs before the command, so a
  dev server already serving the probe URL is still reused and vite is never
  started. `--strictPort` bites only when the port is held by something that is
  not the server under test — the case worth failing on.

  `configs/lighthouse` had the same gap and it fails worse — silently rather than
  loudly. Its `url` is pinned to 5173 while `startServerReadyPattern` matches
  vite's "ready in" line whatever port it settled on, so a squatter on 5173 means
  vite comes up on 5174, announces itself, and lighthouse collects from 5173:
  auditing the squatter and reporting its scores as the site's. Same two flags
  applied. (Both audits already did this for themselves — `src/audits/a11y.ts` and
  `src/audits/lighthouse.ts` allocate a free port and pass `--strictPort`; it was
  only the shared configs sites consume directly that were left behind.)

  Sites inherit both on their next package bump; no per-site change needed.

## 0.79.0

### Minor Changes

- 2c13217: Make the `form-e2e` probe report budget headroom, not just pass/fail.

  The probe submits with the `testMode` marker, which short-circuits in
  `ingestSubmission` right after site resolution — before the spam classifier,
  the repeat-sender/duplicate scans, the row insert, the Resend notify and the
  stamp. Its elapsed time is therefore a LOWER BOUND on what a real submission
  costs, and a green verdict said nothing about the rest of the path.

  That is how 1836dig recorded `Form E2E OK: pass` at 13:24 on 2026-08-03 while
  real submissions at 18:23 were being reported to visitors as failures: the
  probe never paid the ~2s of sink work that pushed the real call past the
  site's abort budget. The one signal watching the fleet's conversion path
  structurally could not see the failure.

  The probe now times the submit itself (click → success banner), projects what
  a real submission would have cost (`+ TESTMODE_SKIPPED_WORK_MS`, estimated
  rather than measured — making testMode do the real work would persist
  bot-triggerable rows or send real email), and warns when that projection
  exceeds half of `INGEST_TIMEOUT_MS`.

  A thin budget warns on the RUN while the persisted verdict stays `pass` — the
  form does work, and flipping the cockpit to `fail` would report a working form
  as broken. The nightly `fleet-form-e2e` workflow raises the `BUDGET_THIN` line
  as a GitHub warning so the signal is not buried in the log.

  A runner that reports no timing (injected fakes, anything predating this)
  never manufactures a warn.

- 2c13217: Take the best-effort tail off the visitor's critical path.

  `ingestSubmission` awaited notify → stamp → newsletter fan-out before
  returning, so the submitting site — which waits on that response under an abort
  budget (`INGEST_TIMEOUT_MS`) — was made to wait on Resend, Mailchimp and site
  webhooks. None of that work can cost the lead: the row is already durable and
  every step is swallowed+logged. It was pure latency in front of the visitor's
  only signal, which is how a captured 1836dig lead was reported as a failed
  submission on 2026-08-03 while the operator email was already delivered.

  `IngestDeps` gains an optional `defer`, and the `form-ingest` handler passes
  Netlify's `context.waitUntil` — the tail now runs after the response. On the
  measured path that removes ~1.1s (Resend ~0.8s + stamp ~0.3s) from what the
  visitor waits for, and permanently decouples the visitor-facing outcome from
  email/webhook provider latency.

  Absent `defer` the tail runs inline exactly as before, so this is a latency
  change and never a behavioural one — every existing caller and test is
  unaffected. The handler is capability-guarded: a runtime without `waitUntil`
  falls back to the inline tail rather than silently dropping the notification,
  because a slow notification is recoverable and a lost one is not.

  An accepted result now reports `notifyStatus: "deferred"` when the tail was
  handed off — the in-request outcome does not exist in that case, and the real
  one still lands on the row via `stampNotified`.

  `TESTMODE_SKIPPED_WORK_MS` drops from 2s to 1s to match: the sink work the
  `form-e2e` probe skips is now just the scans and the insert.

### Patch Changes

- 2c13217: Stop reporting an already-captured lead to the visitor as a failed submission.

  `INGEST_TIMEOUT_MS` goes from 8s to 20s. The old budget was calibrated against a
  10s Netlify synchronous-function limit; the envelope is now 30s
  (`SYNCHRONOUS_FUNCTION_TIMEOUT`), so the headroom argument that produced 8s no
  longer holds — and 8s did not actually clear a **cold** central call.

  Central ingest persists the submission BEFORE its best-effort tail (notify →
  stamp → fan-out), so once the row exists the lead is captured. A client-side
  abort after that point tells the visitor their message failed while it is
  already saved and emailed — the visitor's only signal says the opposite of the
  truth, and a retry duplicates the lead.

  Observed on 1836dig 2026-08-03: row `sub_f4f195ff` stored with
  `notify_status: sent`, operator email delivered, and the browser still showed
  the site's failure copy. Measured on the same day, a cold central call runs
  ~5-7s (cold start ~1.9s + Airtable slug lookup ~2.4s + Turso open/migrate +
  insert + Resend ~0.8s), leaving the 8s budget with no real margin. 20s is ~3x
  that path and still leaves 10s of the envelope for the action to render.

  The fleet's `form-e2e` probe could not have caught this: its `testMode`
  submissions short-circuit in `ingestSubmission` before the classifier, the
  insert, and the Resend call, so the probe never exercises the slow path that
  real submissions pay.

## 0.78.0

### Minor Changes

- 6becfdf: Let a site opt the `a11y` audit into scanning its real routes.

  The audit only ever axe-scanned two synthetic fixture pages
  (`/dev/a11y-fixtures`, `/dev/animate-in`). No real page was ever checked, which is
  how five production pages on gallerysonder shipped a hero `<img>` with no `alt`
  attribute — a critical violation — with CI green the whole time.

  A site now lists its own routes in `package.json#reddoor.a11yRoutes`, and they are
  scanned **in addition to** the fixtures (which stay: they cover design-system
  components in isolation, which no real page does). Each violation is reported
  against the route path so it is attributable. Junk entries are dropped and an
  absent or unusable key leaves behaviour byte-identical to before.

  Opt-in rather than automatic on purpose: the shared CI workflow runs this audit
  with `--fail-on-violations`, and most of the fleet carries pre-existing
  accessibility debt, so enabling it centrally would red every repo at once.

- 7d0ca76: Remove the `ci` config template (and `"ci"` from `ConfigName`): every live fleet ci.yml carries per-site values (`netlify-site:`, `node-version:`, `permissions:`) a static template cannot own, so the exact-match heal in `self-updating`/`sync-configs` was an armed clobber — any run would have stripped those values in green auto-mergeable PRs. Ownership is split instead: the starter clone provides each site's ci.yml, and Renovate bumps the pinned reusable-workflow ref when reddoorla/.github tags a new version. Also retires the two ACCEPTED_GAPS entries — the central repo and .github now run Renovate themselves.
- 1d8b798: `protection-audit` now verifies the full posture floor per public repo, not just ruleset shape: secret scanning + push protection must be enabled, and the renovate workflow must exist, be active, and have actually run within 3 days (GitHub silently disables quiet schedules, and template-cloned schedule triggers may never register — the first live sweep caught two never-run and two stale repos).

### Patch Changes

- c4c7ae3: Shared eslint config: turn `svelte/valid-prop-names-in-kit-pages` off for `+error.svelte` files. eslint-plugin-svelte 3.20+ allows only an `error` prop there, but SvelteKit really passes merged layout `data` to error pages (proven by reddoorla.com's live 404), and the rule takes no options to widen the list.

## 0.77.0

### Minor Changes

- 7a4ac6b: fix(fleet): disable platform auto-merge fleet-wide, let Renovate own the merge

  **Behaviour change for consumers of the `self-updating` and `launch` recipes.**

  GitHub's platform auto-merge is a per-PR flag that anyone with write access can
  arm; the PR then merges itself later, unattended, once checks pass. On
  2026-07-26 a bulk `gh pr merge --auto` sweep armed it across 8 fleet repos, and
  two `actions/checkout` **major** PRs merged with zero reviews the next morning
  (`reddoor-starter#77`, `reddoor-website#111`) once Renovate's own rebase cleared
  their conflicts. The org Renovate preset forbids auto-merging majors and was
  working correctly — Renovate never armed them — but the preset has no authority
  over a flag someone else set.
  - `self-updating` now **disables** GitHub platform auto-merge instead of
    enabling it. The self-heal still runs on every `self-updating` / `launch` run,
    so a repo where someone re-enables the flag gets it turned back off and the
    correction is reported as an action — a drift alarm rather than a drift
    source.
  - New `disableRepoAutoMerge(repo)` on the `GitHub` wrapper. `enableRepoAutoMerge`
    is retained and exported as the documented rollback path.
  - The `renovate-action` config template now runs **twice daily**
    (`0 */12 * * *`, was weekly `0 7 * * 1`). Renovate can only merge while it is
    running, so with platform auto-merge off the cron is the merge cadence, not
    just the PR-creation cadence. Sites will pick this up via `sync-configs`.
  - The same template's actions are now **digest-pinned**
    (`actions/checkout@3d3c42e…` # v7, `renovatebot/github-action@1a96852b…` #
    v46.1.21). That workflow holds `RENOVATE_TOKEN`, a fleet-write PAT, so a
    mutable tag ref there was a supply-chain regression.

- b6c451b: Record and surface the newsletter fan-out, and tag Mailchimp members by source.

  The site-webhook and Mailchimp results were `console.error`-only and persisted
  nowhere, so an expired API key or a Mailchimp outage would silently stop signups
  reaching the audience while the submission row still read `notify=sent` — healthy
  to every view the operator has. Migration `0005_add_fanout_status` adds a
  `fanout_status` column; ingest now stamps one `<destination>:<outcome>` token per
  attempt (`webhook:ok,mailchimp:401`), and the dashboard shows a red `fan-out:` chip
  on the collapsed submission line plus a `Fan-out` detail row. Null still means
  nothing was attempted — a non-newsletter form, a spam row, or no destination
  configured. The stamp is best-effort like the fan-out itself: a provenance write
  never costs a lead.

  Members added by the pipeline are now tagged `Online Form` and `form:<type>`, so
  form signups are distinguishable from imports and manual adds inside Mailchimp
  (every API write otherwise shows the same "API - Generic" source). Mailchimp
  ignores `tags` in the member-upsert body for an **existing** member — the common
  repeat-signup case — so the tags are also applied through the dedicated tags
  endpoint; a tag failure is reported as `mailchimp-tags:failed` rather than failing
  the add.

### Patch Changes

- a6f9f69: Fix the `sync-configs` CI template pinning the reusable workflow three minor versions behind the fleet.

  The `ci-action` template pinned `reddoorla/.github/.github/workflows/ci.yml@78c4da64` (v1.0.0) while every fleet repo carries `@4a32c3d0` (v1.3.0). Running `sync-configs` would have silently regressed each repo's CI — including past the v1.3.0 fix that bumps `pnpm/action-setup` for the pnpm 11.12+ self-installer break.

## 0.76.0

### Minor Changes

- 2a05c91: form-e2e now finds the contact form on one-page sites.

  The probe hard-coded `/contact`. On a site whose only form lives on the homepage
  that route 404s, so the audit recorded `formPresent: false` — "checked, no contact
  form" — and moved on. That verdict is n/a rather than a failure, so nothing went
  red: the site's only conversion path was unmonitored while the cockpit looked
  clean. 1836dig is exactly this shape.

  The probe now walks `CONTACT_PATHS` (`/contact`, then `/`) and submits against the
  first route that renders a `<form>` carrying an email field. `/contact` stays
  first, so sites built from the starter still resolve in a single navigation.

  A `<form>` with no email input no longer counts as a contact form — homepages
  often carry a search or newsletter form, and submitting one would have reported a
  false pass.

  The route-discovery loop is exported as `findFormPath`, taking a structural
  `FormProbePage` rather than a Playwright `Page`, so it is unit-tested without
  launching a browser. Previously this logic sat inside `defaultFormRunner` and no
  test could reach it.

- 2d2251d: blux freeze: site-declared extra slots, plus two CLI options that were missing

  `blux freeze --extra-slots <path>` accepts a JSON declaration of slots the
  byte-faithful template carries no token for, and appends them to the emitted
  slot manifest so `blux migrate-frozen` pushes them to Prismic like any other
  slot. This covers editable content the render composes itself rather than
  substituting into the export's markup — a `<video>` poster (the export ships no
  `poster` attribute, so there is nothing to tokenize) or a data panel the export
  baked as a flattened image and the render rebuilds as real text.

  Declared keys must start with the reserved `x.` prefix and are validated
  against the derived keys, so a site declaration can never shadow real page
  content; a malformed declaration fails the freeze rather than shipping, since
  these become live CMS fields. The tool stays generic — it knows only that extra
  slots exist, never what any site puts in them.

  Also registers two `blux` options that the command handler already read but the
  CLI never declared, so passing either was an "Unknown option" error:
  - `--site <slug>` (freeze / migrate-frozen)
  - `--extra-slots <path>` (freeze)

- e109903: blux freeze: whitespace-only leaves stay literal instead of becoming CMS fields

  A page builder emits blank rows as content: a list item or table cell holding
  `&nbsp;`, there only to occupy a line. The freeze tokenized those like any other
  text leaf, which turned layout into a Prismic Rich Text field — and Rich Text
  cannot store a whitespace-only value. It round-trips to `""`, the row collapses
  to its padding, and the page silently loses a line of vertical rhythm.

  This is a defect that only surfaces _after_ the migration, on the live site, in a
  place nobody thought to re-measure. It cost the-pointe 24px of footer.

  `tokenizeText` now decides "carries content" on the DECODED text rather than the
  raw source. `rawText.trim()` could not see this: for a `&nbsp;` leaf it trims to
  the literal string `"&nbsp;"`, which is not empty, so the leaf looked like copy.
  Testing the decoded text catches every spelling — `&nbsp;`, `&#160;`, `&#xa0;`,
  `&emsp;`, `&thinsp;` — because JS `String.trim()` strips the whole Unicode
  whitespace class. A real character such as `&amp;` still decodes to content and
  is tokenized exactly as before.

  **Re-freezing an existing site shifts slot keys.** A skipped leaf does not
  advance the section counter (matching how plain-whitespace leaves have always
  been treated), so every key after a dropped one moves down by one within its
  section. Verified against the-pointe by round-tripping its committed artifact:
  94 tokenized leaves become 93, the single dropped value is `" &nbsp;"`, the
  content sequence is otherwise identical, and 5 keys shift (`h.t12`–`h.t16`) in
  one of its 15 sections. Since `blux freeze` and `blux migrate-frozen` regenerate
  the template and the manifest together, this is self-consistent — but do not
  commit a new template against an old published document.

- 205b640: Generate report header images from a site's live homepage.

  The per-site "Header image" was made by hand in Figma. 34 of 44 Websites rows had
  none, which hard-fails `preflight` with `header-image-missing` — "the send will
  throw" — and blocked 1836dig's launch report.

  `reddoor-maint header-image <site>` screenshots the site's homepage and
  composites it into the bundled plate, writing a local JPEG for review;
  `--write-airtable` uploads it, and `--all` backfills every live site without one.

  Report drafts now regenerate the header first, so the screenshot matches the
  period being reported instead of whenever the image was last made by hand. Sonder
  runs 16 reports a year, so a static header goes visibly stale. Regeneration is
  best-effort: a capture failure keeps the stored image rather than failing the
  draft, and the operator still reviews the rendered preview before approving.

- db52934: webflow import module: capture, docs, migrate — scrape a live Webflow site into a
  JSON IR and push it into Prismic via the shared migration runner (first consumer:
  beachfrontdentistry.com). Pipeline: fixtures → html-to-richtext → detail/index
  extractors (team, services, categories, questions, reviews) → crawler + asset
  manifest → IR-to-entity-docs → beachfront page-doc assembly → CLI `webflow
capture`/`docs`/`migrate` → the proven blux `runMigration` runner (no blux
  changes). Live rehearsal: 75 entity docs + 5 page docs, 70 assets, 0 missing,
  zero extractor throws across all 75 real pages. 64 new tests. Two editorial
  notes carried forward for a human pass: a `[DRAFT]` first-visit paragraph and an
  empty tour-photo carousel awaiting Phase-4 fill.

### Patch Changes

- 987208e: approve button gets real feedback: a darker green success state, an in-flight
  spinner, and hover/focus states across the site dashboard's controls.
  - **Approved** is now `#14663c` instead of staying the idle `#2c7`, and it overrides
    the `:disabled` dimming — the button stays disabled after a successful approve, and
    a 60%-opacity "Approved" read as not-quite-finished. (It also lifts white-on-green
    contrast to ~7:1 for that state.)
  - **Spinner** while the POST is in flight: a CSS `::after` ring, not injected markup —
    the handler is deliberately `textContent`/`title`-only so server strings can never
    become HTML, and a pseudo-element keeps that guarantee. The label goes transparent
    rather than being removed, so the button holds its width and the pending row never
    reflows mid-request. `aria-busy` carries the same news to screen readers, and both
    are cleared in a `finally` so no exit path can strand it spinning.
    `prefers-reduced-motion` slows the spin to 2.4s rather than freezing it — a stopped
    ring reads as a hung request.
  - **Hover, active and focus-visible** on all four of the page's controls (approve,
    override toggle, override submit, trigger renovate), each `:not(:disabled)` so a
    dead button never invites a click. Keyboard focus was previously invisible on all of
    them.

  Verified in a real browser across every state (idle/hover/loading/approved/disabled),
  plus 17 new tests.

- 4629e91: the per-site dashboard's Approve button (and every other control on the page)
  was dead — one escape sequence killed the whole inline script.

  `b.title = data.blockers.join("\n")` was written inside `renderSiteDashboardHtml`'s
  template literal, so the `\n` was consumed at BUILD time and emitted a real newline
  into the served HTML — an unterminated string literal. The browser then refused to
  parse the entire `<script>` element, so NOTHING in it attached: Approve, "Send
  anyway…" (both override controls), Trigger Renovate, and the site-details selects
  were all inert. The page looked completely normal — the button rendered enabled, the
  preflight chip was green, and clicking simply did nothing, with no error surfaced
  anywhere in the product.

  Fixed by double-escaping so the browser receives `\n` (the tooltip still joins
  blockers on real newlines — asserted). The explanatory comment avoids backticks for
  the same reason: it too lives inside the template literal.

  Guarded by a new test that extracts every inline `<script>` from every dashboard page
  (site dashboard in both health-clean and health-red states, fleet cockpit, submissions
  page) and compiles each with `new Function` — parse-only, no DOM. A single syntax error
  in one of these blocks is never a partial failure, so nothing smaller than
  "the whole block parses" is a useful assertion.

- 6e9cfd5: daily-reports cron can finally reach GA + Search Console, and an unwired
  environment now says so instead of going quiet.

  GA/Search enrichment runs at DRAFT time, but `daily-reports.yml`'s drafting step
  only ever passed `AIRTABLE_PAT` + `AIRTABLE_BASE_ID` — no GA credentials existed
  anywhere in `.github/workflows/`. So `readGaConfig()` returned `null` on every
  scheduled run and both `fetchGaUsers`/`fetchSearch` took their not-configured
  early return. Every CI-drafted report shipped with blank GA numbers (which drops
  the whole ANALYTICS section from the client email, since `analyticsSection()`
  renders `""` with no data), no search position (so the maintenance template fell
  back to the bare "Google Indexed" label instead of "Page 1 Google Result (#N)"),
  and **no `Maint: Google Indexed` evidence record at all** — which the dashboard
  rendered as a bare amber "needs you" pill with an empty note and nothing to drill
  into. Caught on Sonder's 2026-07 maintenance report; Search Console in fact had
  the site at position #2.

  The step now takes `GA_SUBJECT` + `GA_SA_KEY_JSON` (the key file's contents,
  written to `$RUNNER_TEMP` because the code takes a path) — both need adding as
  repo secrets; `docs/SETUP.md` has the `gh secret set` lines.

  `fetchSearch` also splits the old single skip in two. An un-enrolled site stays a
  true skip (nothing to measure, box stays manual), but an **enrolled** site with no
  credentials is now `notConfigured` and produces an honest `unknown` evidence
  record noting "Search Console not configured in the environment that drafted this
  report". Gating is unchanged — Google Indexed is still advisory on Maintenance and
  still gating on Testing (where an absent record already coerced to `unknown`), so
  no report's approvability moves.

- 0624181: smoke audit runs `svelte-kit sync` before the suite — unbreaking 9 of 11 live sites.

  `playwright.config.ts` resolves `tsconfig.json`, which extends the **generated**
  `./.svelte-kit/tsconfig.json`. A fresh clone has no such file, and no fleet repo
  carries a `prepare` script to write one, so Playwright aborted while loading its
  own config, before running a single test:

  ```
  Error: Failed to load tsconfig file at <site>/tsconfig.json:
  Failed to resolve "extends" path "./.svelte-kit/tsconfig.json"
  ```

  Nine of eleven live sites were recording `Smoke OK: fail` for this reason —
  CalTex, Data Dynamiq, ERP, Espada, LA Homelessness Initiative, MSOT, Revogen,
  Sonder and Vineyard. Only Reddoor and LA Homelessness Youth passed.

  It stayed invisible because `fleet-smoke.yml` gates on `FLEET_WRITE_SUMMARY`,
  which counts rows **written**, not rows **passing**. A failing site is still
  written, so the nightly reported success throughout.

  The audit now runs `pnpm exec svelte-kit sync` between install and `test:smoke`.
  Fixing it centrally covers every site at once, where a `prepare` script would
  need a PR per repo. `sync` is idempotent and fast, so it runs unconditionally
  rather than probing for the file — a warm checkout can have `node_modules`
  without `.svelte-kit`. The step is best-effort: a non-SvelteKit site or a missing
  binary can never downgrade a working suite, and the suite remains the verdict.

  Verified A/B against a cold clone of data-dynamiq: `smoke fail` (tsconfig error)
  before, `smoke pass` (suite green) after.

## 0.75.1

### Patch Changes

- 34f0f7e: browser audit: flag unsubstituted SvelteKit placeholders + require a visible `<main>` on mobile

  The `browser` audit now warns when a sampled route ships a literal `%sveltekit.*%` token
  (a broken `app.html` — e.g. a placeholder named in a comment before the real one, which the
  naive first-match template substitution fills, leaving the real token unrendered). It also
  requires a visible `<main>`/`[role=main]` on the mobile checks, mirroring desktop, so a
  fully-blank render can no longer pass mobile on status + no-overflow alone. Both close the gap
  that let a blank/corrupt homepage slip past the sweep.

## 0.75.0

### Minor Changes

- 9fd165a: blux convert: emit products.json — the product catalog a Blux "products" feed
  drives. Blux renders a detail page per record (/products/<slug>) from a
  Handlebars template the static export drops, so the catalog is rebuilt
  deterministically: canonical categories (the raw feed is dirty — whitespace,
  case, and typo variants like "Upholstrered" → "Upholstered"), the faithful
  slug (each record's stored `url` wins, e.g. "Howdy Set" → howdyset, else derive
  from the title), and reconstructed main + gallery image urls. Slug-collision
  safe (an enabled record wins over a disabled duplicate). Proven on composition:
  552 records → 549 products (3 collisions deduped), categories Upholstered 408 /
  Case 126 / Exterior 15, all reconstructed image urls resolve.

## 0.74.0

### Minor Changes

- e9dd401: blux convert: emit site-config.json — the site chrome (navigation + footer)
  the page-focused convert dropped. Parses the export's nested navigation tree
  (top items with optional dropdown children + the resolved logo url) and the
  footer (enabled social networks + the copyright line) into a render-side
  config the Nav/Footer consume. Additive: a site with no navigation/footer
  yields an empty config (the render keeps its logo-only bar and placeholder
  footer). The nav logo — chrome, not on any page grid, so absent from the
  scraped urlMap — resolves by reconstructing its CDN url.

  Footer social profile urls aren't in the export (Blux injects them at render
  time from account config), so they're recovered from the scraped live footer:
  each enabled network is matched to its profile link by host (subdomain-safe,
  so `notfacebook.com` never matches). Proven on composition: 6 nav items (2
  dropdowns), resolved logo, and all 5 footer socials linked
  (facebook/twitter/instagram/pinterest/linkedin).

## 0.73.0

### Minor Changes

- c758fff: blux theme: emit the export's button skins. Converted trees carry the raw
  anchors verbatim (`class="ib middle buttonsN"`), so without the declared
  `styles.buttons` skins a button renders as a bare link. `ThemeIR.buttonStyles`
  captures each skin (values in declaration order — the skins rely on a `border`
  shorthand followed by side zero-overrides netting a bottom-only rule) and
  `emitButtonsCss` appends `.buttonsN` rules (+ :hover/:active variants) and the
  `.ib` inline-block base to theme.css.
- ea45e71: blux convert: capture a peeled card wrapper's content padding alongside its
  background. A Blux card's `.blocksN` fill carries the background-color while its
  `.blocksNcontainer` carries the content inset (e.g. `padding: 100px 4% 80px`);
  the layout-wrapper peel dropped the latter, so restored cards rendered with the
  fill hugging their text. The padding now rides onto the card's `style` too —
  gated on a background being present, so a plain band container's inset (handled
  via blockClass defaults) is never double-captured. Fixes the-pointe band 3's
  stats card and its band-14 listing cards.
- a3f167b: blux convert: preserve grid-cell containment and cell-level padding through the
  peel. Three shapes the flatten used to drop: a multi-child `block-subcontent`
  now parses to its own stack (the original contains each cell's block margins
  via a block-content clearfix); a cell-level container's inline padding rides
  onto the node it wraps even without a background (band-level container padding
  stays excluded — that is the band's own content padding); and a padded wrapper
  around a bare leaf or a multi-block group carries the box as a one-stack
  wrapper applied once, never duplicated per child. Classification is unaffected:
  pattern-matching sees through the synthetic style boxes (a SplitFeature media
  cell that gained an inset stays SplitFeature).
- 7864bfe: feat(blux): capture a peeled card wrapper's background-color onto grid rows

  `blux convert` was dropping the inline `background-color` on Blux "card"
  wrappers (`.blocks0` divs with no grid token of their own), because the grid
  parser peels those pure-layout wrappers to reach the structural content —
  losing any background they carried. `collectStructuralChildren` now threads a
  peeled wrapper's inline `background-color` down to the structural node it wraps
  (the nearest wrapper wins, transparent ignored), and `withCardBackground`
  lands it on the resulting `row`/`stack` node as a `style` deviation (same shape
  as a text leaf's `style`; distinct from `Band.background`, a Media image). The
  render manifest's `RenderNode` row/stack now carry `style?`. On the-pointe this
  restores band 3's white stats card and band 14's white listing cards.

- 8152804: feat(blux): emit export class-default padding + text-style deviations

  `blux convert` now captures the Blux export's own layout defaults instead of
  dropping them. `blockClassDefaults(siteJson)` reads each `.blocksNcontainer`
  entry from `styles.blocks` and `buildPresentation` fills a band's
  `_contentPadding` / `_contentPaddingMobile` / `_max-content-width` from that
  class default whenever the block's own styles omit the key (the mobile override
  only ever pairs with a filled default). Text-leaf `style` deviations captured by
  the parser — inline color/padding and decoded `margin-N{r,l,t,b}` utilities —
  now pass through to the render manifest's heading/body/subtitle nodes.

- 1166187: blux: capture the export favicon. Every Blux export declares its favicon as a
  bare media uuid in `settings.favicon` whose CDN url appears only in the
  rendered `<link rel="icon">` tags (the uuid is routinely absent from the media
  dict). assembleIR now resolves it from the scraped urls onto
  `SiteIR.meta.favicon` — kept off the plan-bound assets list so it never rides
  the migration into Prismic media — and `blux convert` downloads it beside the
  plan as `favicon.png` (via the same injectable fetch seam as `--probe`). A
  fetch failure never fails the command: the `{assetId, url}` pair is preserved
  as `favicon.json` so the download can be re-run by hand.
- 1899030: blux convert: materialize feed-grid tiles. Gallery/portfolio grids render
  their tiles CLIENT-SIDE from feed records — the static export ships only the
  `display:none` `{{…}}` template (dropped last round), so those bands
  converted empty. `convertSite` now rebuilds the visible tiles
  DETERMINISTICALLY from the feed data: a band whose site.json item declares
  `sources` + `sourceConfig` is materialized into a Grid tile row —
  `__media` sources resolve to the tag-matched library images (`&&`/`||` filter
  DSL), a feed id resolves to its records (filtered, sorted, template-expanded).
  Image urls reconstruct from the site's CDN base (`https://<host>/<siteId>/
<uuid>.<ext>`, the untransformed full-res base the export's own `data-base`
  uses). The tiles are a normal Grid node tree, so they classify and render with
  no new render surface. Proven on composition-hospitality: gallery 0→132
  images, portfolio 0→524 project titles, every url resolves. Tile-ratio
  cropping (the sourceConfig `ratio`) and big-list column layout are follow-ups.
- 809ea23: blux convert: three fidelity captures from the final live-diff pass. A LONE
  width-constrained grid cell (grid-2-r60) keeps its row — the token is the
  content column's width, and flattening it rendered the column full-width. A
  peeled `valignmiddle` wrapper rides the node style as the `_valign: middle`
  presentation hint (the original vertically centers that cell against its row
  siblings). And the emitted anchor base gains `.links { text-decoration:
underline }` — an inline-block box does not inherit an ancestor's
  text-decoration, so the link affordance must be declared on the anchor itself.
- c84f1a1: blux convert: mark the map widget's toggle-panel row in the presentation
  manifest. The Blux clickMap widget switches the area below the map between N
  sibling content panels (one per toggle — on the-pointe, the address grid plus
  three hidden logo strips); structurally that is a row directly following the
  widget:map inside a stack with exactly one cell per toggle. The row now emits
  `panels: true` so the render can show only the active toggle's panel instead of
  stacking all of them.
- 257888e: blux convert: whole-site multi-page conversion. Every page of the export (the
  homepage's root index.html plus each page dir's index.html) now runs through
  the faithful-grid pipeline — previously only the home page did, and inner
  pages existed solely as the archetype path's low-confidence block guesses.
  `convertSite` assembles ONE IR from all page htmls (the asset urlMap then
  resolves media that only appear on inner pages), emits one uid-keyed page
  document per page, and writes a page-namespaced presentation manifest
  (`{ pages: { <uid>: { bands } } }` — band indices are page-local, so a flat
  map would collide). normalizePages pins the first page's uid to "home" (the
  render's root-route contract), derives paths/uids from the source `url` when
  set, and renames colliding uids with a diagnostic. Pages missing from the
  export get a `missing-page-html` diagnostic and are skipped. The layout
  report and map-config outputs are keyed per page. Proven on the
  compositionHospitality export: 8/8 pages FAITHFUL, 36 bands.
- 9012b89: blux convert: capture the nested block-in-cell mechanism the peel used to drop.
  A grid cell holding a full Blux block pins its own box with inline `min-height`
  (e.g. an 80vh panel), paints it via an abs-fill `block-background-layer`
  (gradients the wrapper background-color capture never sees), and centers its
  content with a valignmiddle container. All three now ride the card onto the
  node style: `min-height`, the `background` shorthand, and the existing
  `_valign` hint. Captured only inside a cell (like padding) — a band-level
  container's min-height is the band's own full-height chrome, and band-level
  background layers stay SectionBand territory. Found on the-tower band 1
  (-808px vs live before capture); the same mechanism sizes its band 5 split.
- 99c2aae: blux theme: carry each text style's own block margin into the role utilities.
  Blux's vertical rhythm between stacked blocks is the text styles' margins
  (e.g. Grid Titles' `10px 0`), which collapse in normal flow; the emitted
  `.txt-role-textN` rules previously hardcoded `margin: 0`, flattening that
  rhythm. The margin now rides the IR (`TextStyleIR.margin`), a
  `--text-textN--margin` theme var, and `margin: var(--text-textN--margin, 0)`
  in the role utility — roles without one stay flush exactly as before.
- 1709b8d: feat(cockpit): generic accept-key matcher for watch conditions + chip discoverability

  Any amber Watch condition can now be accepted (muted) by the operator, not just
  the three that had hardcoded accept branches. `assignTier` collects each active
  watch condition as a structured candidate carrying a set of **stable accept
  keys** (with human aliases — e.g. the Netlify/no-custom-domain watch accepts
  `no custom domain`, `netlify`, `netlify.app`, `on netlify`) decoupled from the
  volatile reason text, then a single generic matcher routes each to muted or
  watching. Adding a future watch condition makes it acceptable with no new
  branch.

  The cockpit card now surfaces the exact accept token beside each watch chip
  (`… · accept: "no custom domain"`, with a tooltip), so the operator can see
  precisely what to enter — closing the discoverability gap where the mute token
  never matched the displayed text.

  `acceptedWatchConditions` parsing now tolerates both the Multiple-Select array
  shape and a delimited long-text string, so the Airtable field can migrate to
  free text with no code change.

  Invariants preserved: acceptance is watch-only (the accept loop runs strictly
  below the attention short-circuits, so it can never mute a red condition), keyed
  on the stable signal token (accepting `performance` tolerates 82→78 but a drop
  below the floor still alarms via its AttentionItem), and accepted conditions
  still render as muted `✓ accepted:` chips.

- 5cab822: feat(reports): default Search Console query to site name + flag name-default misses

  Search-presence enrichment no longer requires a hand-entered `Search query`
  per site. When the Airtable `Search query` cell is empty (or whitespace),
  `fetchSearch` falls back to the site's name as the brand query, so every
  GA-enrolled site (one with a GA4 property ID or an explicit query) gets brand
  search tracking automatically. An explicit `Search query` still wins when set.

  Sites where the site-name default returns no Search Console data are flagged —
  a per-site `⚑` log line plus a one-line batch summary
  (`⚑ N site(s) returned no Search Console data for their name …`) — so the
  operator knows the handful whose legal name differs from their brand phrasing
  and needs a hand-tuned query. The flag is deliberately separate from the
  GA/Search soft-fail (outage) signal: a clean "no data for the name" is a
  tuning hint, not an analytics failure, so it never trips the analytics-health
  alarm. A site that is found but ranks below page 1 is a valid measurement, not
  a miss, and is not flagged.

### Patch Changes

- 7d065b9: Backlog triage tooling for the pre-tuning submissions pile-up. New `submissions rescore` CLI re-runs the CURRENT spam classifier (turnstile "unverifiable") over every status='new' row — dry-run table by default, `--apply` re-buckets rows scoring >= SPAM_THRESHOLD to spam_auto with the new score/reasons plus a `retro-rescore` marker. The /submissions page gains a bulk "Mark all N filtered as read" action: a confirm-gated POST back to the page handler that flips every still-'new' row matching the current filter to 'read' server-side (`markFilteredAsRead`); spam and operator-touched rows are never affected by either path.
- 6a5807e: feat: Require-Turnstile guardrail + solved-hostname check + honest no-property search flag

  Closes out the remaining confirmed findings from the 2026-07-15 adversarial review.
  - **Require-Turnstile guardrail.** The nightly function-health sweep already reads the
    site's `/health` `forms.turnstile` boolean but dropped it before Airtable; it now
    persists as the `Turnstile widget` field (pass/fail, freshness via `Function health
checked at`). A site with `Require Turnstile` ON whose fresh sweep says the widget is
    MISSING raises a **critical attention item** (cockpit + digest) — that combination
    silently buckets 100% of the site's real leads, and the form-e2e probe cannot see it
    (testMode bypasses the gate). The item rides the attention short-circuit ABOVE the
    accepted-watch mute loop, so no accept key can silence it. A gated site whose widget
    state merely can't be verified (null verdict / stale sweep) gets an acceptable amber
    watch (`turnstile-unverified`). Rollout preconditions live in
    `docs/runbooks/require-turnstile-rollout.md`.
  - **Solved-hostname check (defense-in-depth).** `verifyTurnstile` now returns
    `{ outcome, hostname }` — siteverify's record of where a passing token was solved.
    On a `Require Turnstile` site, a passing token solved on a host unrelated to the
    site's own URL escalates to `spam_auto` (`turnstile-required-hostname`). Subdomains
    match both ways (www./previews), a null hostname or unparseable site URL skips the
    check entirely (fail-open), and non-gated sites are untouched. Bare-outcome strings
    remain accepted by `ingestSubmission` for compatibility.
  - **Search flag split (#408 follow-up).** `defaultQueryMissed` conflated "the site-name
    default found no data" with "NO Search Console property matched at all" — and its
    remedy ("set an explicit Search query") permanently silenced the latter, since an
    explicit query that finds nothing is by design never flagged. `fetchSearchPresence`
    now reports `propertyFound`, and drafting raises a distinct `searchPropertyMissing`
    flag (fires for explicit AND default queries) with the correct remedy: verify the
    domain property exists and the service account has access. The `--due` batch summary
    prints the two cases as separate lines.

- 9327af2: blux convert: feed-tile fidelity fixes from a full adversarial review of the
  materialization. Five real gaps vs the live site (one review finding — a
  "code-point" title sort — was refuted by the export's own sort JS, which uses
  localeCompare, so that stayed):
  - Tag filter now matches singular/plural (a trailing "s"): a `projects` filter
    also selects `project`-tagged media, recovering 7 real gallery tiles an
    exact match dropped (interior 100 → 107, matching live exactly).
  - `__media` grids now apply the configured sort (the gallery/portfolio grids
    are `fdate` — newest-first — not media-upload order).
  - `__media` tiles now carry their overlay captions: the library entry's `name`
    is the tile title and `description` the body (both real display text, not a
    filename as previously assumed) — escaped as plain text.
  - Feed-record title/body are placed as HTML VERBATIM (Blux stores them as HTML
    with entities pre-encoded): a `<br>` renders as a break, and `&amp;` is no
    longer double-escaped to a visible `&amp;`.

  Proven on composition: gallery 132 → 139 images with captions, zero double-
  escapes, zero template-token leaks, all reconstructed urls resolve.

- 0b67348: blux convert: classify a full-page hero slider as a Carousel. A `.caslider`
  whose slides are `stack[media, title, location]` (image + a heading + a
  secondary body line) was rejected by the exact `stack[media, heading]` slide
  match and fell through to the faithful Grid — rendering all N slides stacked
  full-width (composition's home hero was 18 slides tall, ~18000px vs live's one
  80vh frame). `carouselSlides` now accepts a slide whose first child is media
  followed by text nodes, taking the title heading as the caption. The
  secondary body line (the hero's location) is dropped until the single-text
  caption model carries a second line — a flagged follow-up. Proven on
  composition: home band 0 now a Carousel(18) at 80vh (~800px), not a
  18000px grid; the-pointe/tower gallery carousels are unchanged.
- 9929699: blux convert: a hero carousel slide now carries its secondary caption line.
  A full-page hero slide is `stack[media, title, body]` — the title was the
  caption but the body (the project location / design credits) was dropped.
  carouselSlides now captures the first non-blank body/subtitle after the title
  as a `subcaption`; the emit threads it to the page-doc item and the manifest
  metadata. Proven on composition: the home hero now shows "Headquarters" over
  "Ontario, California", etc. Empty hero bodies produce no phantom subcaption.
- 7d94803: blux convert: feed-grid tile cropping + overlay captions. Gallery/portfolio
  tiles rendered at their natural (tall, varied) height with the caption in a
  row below; the original crops each tile to `sourceConfig.mediaRatio` (4:3) and
  overlays the caption ON the image (`layout: behind`, `overlay: true`), so a
  tile is only as tall as its image. A tile image now carries `cropRatio` (the
  render frames it in a fixed-aspect object-cover box) and, for an overlay grid,
  the tile stack carries `_overlay`/`_overlayColor`/`_overlayValign` hints so the
  render reveals a colored caption panel on hover. Proven on composition:
  gallery band 1 15698px → 12036px (live 11087), band 2 3702px (live 3644) — the
  tiles are now uniform 4:3 cards like the original.
- 797a5f1: fix(audits): stop the browser sweep crying wolf — verified reachability + honest titles-meta

  The 2026-07-16 sweeps failed "Titles & Meta OK" on 10 of 11 live sites and "Uptime Reachable" on
  3, while every site answered 200 to a plain fetch. Root cause: hosts' bot protection (Netlify
  WAF) serves 403 challenge interstitials to the headless-browser probe burst — status 403, title =
  the bare domain, no meta — poisoning both verdicts, with two amplifiers in route discovery
  (asset URLs like a homepage-linked PDF sampled as "routes", and `/a` + `/a/` sampled as two
  routes → guaranteed duplicate-title fail). Fixes:
  - Route discovery samples only real page routes: asset/file extensions filtered, trailing
    slashes normalized.
  - Every browser-side unreachable/title-less observation is re-verified with a plain fetch (with
    cooldown retries for WAF-shaped statuses) BEFORE a fail verdict can persist; only a confirmed
    non-2xx/timeout keeps the fail.
  - Fail verdicts are now actionable: confirmed-failing URLs (`unreachableUrls`) and per-URL
    title/meta findings (`titleMetaProblems`, incl. which routes share a duplicate title) ride in
    the audit note + details. Verdict semantics and Airtable fields are unchanged.

- fb4b3c6: fix(forms): stop the classifier silently bucketing genuine leads + three hardening fixes

  An adversarial review pass over #410/#412 confirmed two HIGH false-positive classes and
  three smaller defects. All verified by executing the classifier and replaying live data.
  - **Gibberish rule reworked.** The ≥5-consecutive-consonant rule (y as consonant) fires
    on ordinary English — every `psych*` word ≥10 letters (p-s-y-c-h is itself a 5-run),
    "worthwhile", "nightclubs": 3,138 dictionary words — so gibberish(+35) + one pasted
    link(+25) silently bucketed whole genuine-lead verticals (a psychology practice's
    inquiry scored exactly 60). Now: run ≥7 with y as a VOWEL, **or** ≥3 interior
    lower→upper case flips. Measured: zero dictionary words or common brand names flagged;
    all four live mash samples still caught; live recall unchanged (8/20 marked spam).
  - **Keywords split into seller-voice vs buyer-compatible tiers.** Phrases a genuine
    prospect writes in first person ("our google ranking tanked", "seo problem",
    "free consultation", "virtual assistant") stacked to 75 on exactly the SEO-help
    inquiry a web agency wants most. Buyer-compatible phrases alone now score a weak +10
    (capped +20 — even with the lead's own site link the sum stays under 60); a
    seller-voice phrase ("would you be interested", "position your brand") promotes them
    back to full weight, so real pitches still bucket at 75.
  - **Duplicate-body velocity was silently inert for non-ASCII bodies**: libSQL `lower()`
    is ASCII-only while JS `toLowerCase()` is Unicode, so a sentence-cased Cyrillic spray
    could never match its own byte-identical copy. Both sides now fold in SQL (with an
    explicit whitespace trim set — SQLite's bare `trim()` strips spaces only).
  - **`Accepted Watch Conditions` array elements are validated as strings** — a
    collaborator/attachment-shaped field passes `Array.isArray` with object elements and
    crashed the whole fleet cockpit build on one misconfigured row.
  - **`requireTurnstile` doc comment corrected** — it still described pre-#412 semantics
    (claimed absent tokens stay neutral) and now documents the rollout precondition: only
    enable on a site whose deployed package forwards `_meta.turnstileToken` from every
    form, since a non-forwarding site would silently bucket 100% of its real leads.

- ae03d9b: Three cockpit-honesty fixes. (1) Pre-launch mute pierce: a "launch period"
  site still mutes expected pre-launch noise (early Lighthouse, errored deploy,
  Renovate/analytics warnings), but a genuine alarm — any critical-severity item
  or default-branch CI red — now re-tiers the site to attention through the
  normal machinery (needs-you broken band, red verdict), matching what the daily
  digest already surfaced; muted noise is also filtered off the card's chips.
  (2) Legacy-status visibility: "legacy" joins the Status union; archived
  (legacy/deprecated) rows render as a neutral collapsed cockpit lane + an
  "N archived" verdict term, and a Status cell outside the union (typo/renamed
  option) surfaces as an amber watch row instead of silently vanishing the site
  — without nulling the cell, which would make it schedulable-by-default.
  (3) Auto-fix counter reset: renovate-dispatch --fleet now runs counter
  bookkeeping even when there is nothing to dispatch (the reset-on-clean branch
  was unreachable on a fully-clean fleet — Alamo sat at 7 from a long-closed
  episode), and the reset applies regardless of visibility/repo so archived
  sites can't hold stale counters.
- c00920c: feat(forms): bounced lead notifications become visible — webhook mapping + cockpit alarm

  The Espada failure mode: apm@espada-pm.com bounced 4 of the last 8 lead
  notifications and NOTHING alarmed, because notifyStatus "sent" only means
  Resend accepted the email.
  - **Webhook mapping.** The resend-webhook now checks a bounce/complaint
    event's email id against submissions' `resend_message_id` FIRST (the id
    spaces are disjoint from report emails): a match flips that submission's
    `notify_status` to the new `'bounced'` terminal value and stops there —
    the report-email path is untouched, idempotent on svix replays, and a
    Turso blip fails open to the report path.
  - **Cockpit + digest alarm.** New `collectNotifyBounceAlerts` collector
    (kind `notify-bounce`, CRITICAL): one attention item per site with >= 2
    bounced notifications in the last 14 days — "lead notifications bouncing
    — check the point-of-contact address". Wired into both the cockpit
    rawItems and the digest collector list with the shared
    `notify-bounce:<siteId>` diff key.
  - **Row marker.** A bounced submission shows a visible red "notify bounced"
    chip on its summary line in the per-site strip and /submissions (plus
    `bounced` in the Notify detail row) — not just a tooltip.

- 8e7f6eb: fix(forms/dashboard): genuine-resubmit exemption, retro re-bucket for classifier-caught sprays, full-bucket facets

  Second adversarial pass over the 2026-07-15/16 spam work confirmed three defects (and
  refuted three more claims); all fixed here:
  - **Genuine same-sender resubmission was silently bucketed AND retro-flipped the
    delivered original.** A real visitor resending an identical message (double-click, or
    no reply after days) exact-matched their own prior row → the resend went to
    `spam_auto` with notify skipped and the original still-`new` row was retro-flipped —
    an active lead vanished with no signal. The duplicate scan now exempts matches from
    the SAME sender on the SAME site (live corpus showed 7 genuine leads one resend away
    from this). Cross-site or different-sender copies still count as spray evidence.
  - **Retro re-bucket never fired for classifier-caught sprays.** Both structural scans
    were guarded by "not already spam", so once the tuned classifier began catching whole
    spray families (all live families now score ≥ 60), the retro cleanup #420 shipped
    could never run — 18 known spray copies sit permanently in the unread queue. The
    scans now always run; escalation/reason still only applies when not already spam,
    and prior still-`new` copies get retro-cleaned regardless of which layer caught the
    incoming copy.
  - **The /submissions facet line tallied only the current page** (≤50 rows) while
    sitting under the full-bucket total — and the rollout runbook directs the operator to
    judge the requireTurnstile canary from it. A new `listSpamReasonsFiltered` helper
    feeds the facet line every matching row's reasons (fetched only on spam views).

  Also fixed outside this repo: the Airtable `Require Turnstile` checkbox description
  still claimed absent tokens stay neutral (pre-#412 semantics — the opposite of the
  shipped hard gate); rewritten to point at the rollout runbook.

- c19cb80: Structural anti-spray spam signals: cross-site repeat-sender detection, near-duplicate body detection, and retroactive re-bucketing.

  Live analysis showed the biggest residual spam classes evade per-message content scoring: template sprays with per-site substitution (the dog-harness spray differed only in greeting; SEO sprays swap the target domain), the same sender blasting multiple fleet sites, and the first copy of every spray being delivered by design. Three new ingest signals close those gaps:
  - `findRecentDuplicateSubmissions` replaces the exact-only `countRecentDuplicateMessages`: bodies are normalized in JS (full-Unicode lowercase; URLs/emails/domains/digit-runs stripped) and matched both exactly (>= 40 normalized chars) and by token-set Jaccard >= 0.9 (both sides >= 25 tokens, so short genuine messages never collide). Exact hits keep the `duplicate-body` reason; near-dupes get `similar-body`.
  - `listRecentSubmissionsForEmail` powers the cross-site repeat-sender signal: the fleet's sites are unrelated businesses, so one email contacting 2+ different sites within 30 days is a solicitation tell → `spam_auto` with reason `repeat-sender`. Same-site repeats (genuine follow-ups) never trigger.
  - `markSubmissionsSpamRetro` re-buckets prior still-`new` copies once a later copy identifies the spray (`retro:repeat-sender` / `retro:duplicate-body` appended to any existing reason). The `status = 'new'` guard is load-bearing: rows the operator already read/replied/marked are never touched.

  All three are best-effort and fail-open (a lookup failure never blocks a lead), and everything lands in the recoverable `spam_auto` bucket — never a hard reject.

- e972d5f: feat(forms): aggressive SEO/solicitation filtering tuned from the live miss corpus

  Operator policy (2026-07-15): the fleet's sites are niche and specific — they rank top
  for their own names — and clients who want SEO/marketing help ask the agency directly,
  so SEO-topic content arriving through a public contact form is near-always solicitation.
  Overblock is accepted; `spam_auto` stays recoverable.

  Tuned from a replay of every live submission the previous classifier missed:
  - **Seller-keyword weight 25 → 30 (cap 3 hits / 90)** — two solicitor phrases now bucket
    outright. Genuine leads write zero of them; a lead who grazes ONE ("we want to rank
    higher") is still delivered at 30.
  - **SEO-topic phrases move (back) to seller tier at full weight** ("google ranking",
    "rank higher", "drive traffic", "seo problem", "backlinks", "virtual assistant") and
    the list is expanded with the observed dodges: "page one" / "1st page" (was "first
    page of google" — real pitches write "You're not on page one" and "1st page of
    Google"), "top of search results", "seo process", "people already searching",
    "leads and sales", "businesses like yours", "tried emailing you" (the classic opener),
    "article for your website", "wikipedia page" / "wiki links", "get yours today" /
    "free shipping" (product blasts), and the MAVIS virtual-assistant flood's template
    invariants ("virtual intelligent system", "mavis", "overtake and handle",
    "custom built ai") — that flood rotates names/domains and rewords every copy, so the
    exact-duplicate velocity signal can't see it.
  - **Hyphens fold to spaces before matching** — "link-building" and "custom-built AI"
    were live keyword dodges.
  - **Lorem-ipsum detector** (+60, the one signal allowed to bucket alone): form-tester
    bots submit truncated Latin filler ("Velit ullam reprehen") that is too short for the
    velocity signal and invisible to the gibberish detector; two distinct stems are
    required so a lone romance-language cognate ("voluptuous") can never fire.
  - Buyer tier shrinks to the genuinely ambiguous pair ("within 24 hours",
    "free consultation") — weak +10 capped +20 alone, promoted to full weight beside any
    seller phrase.

  Measured on the live corpus (old vs new): marked-spam recall **8/20 → 19/20** (the one
  remaining miss is a keyword-less "share a document" phish), and 16 additional unmarked
  spam rows in the delivered pile now bucket — every one hand-verified as solicitation
  (MAVIS flood ×10, search-ranking pitches, guest-article fishing, product blasts).
  **Zero genuine leads flip**: the charity invite, artist introduction, job seeker, poet,
  price-list ask, and portal complaint all still deliver.

- f7bda79: Make the requireTurnstile canary reviewable from the dashboard. Spam reasons are
  now visible text, not just a hover tooltip (which never fires on iPad/phone): the
  auto-spam badge gains an inline reason chip (truncated past 3 tokens) and every
  scored row gets a "Spam" row (score + full reasons) in the expanded detail block.
  /submissions filtered to spam_auto or spam shows a per-reason facet summary above
  the list (tokens normalized by stripping trailing :N counts) so
  "turnstile-required-absent" bot tells separate from content-classifier hits at a
  glance. The per-site "Spam screen (30d)" panel stops counting spam_auto/spam rows
  as Delivered — those notifications were skipped — and adds an "Auto-filtered" row
  for the spam_auto count in the window.
- 5009135: fix(forms): catch cold-outreach/gibberish/bare-domain spam + lower threshold to 60

  Live data showed the classifier was auto-bucketing nothing (`spam_auto` = 0 across
  127 recent submissions) while ~1-in-4 delivered messages were spam. This tunes it:
  - **Threshold 100 → 60.** The dominant bypass — Latin-script cold outreach (SEO /
    virtual-assistant pitches) — only sums 25–55 from content signals, so nothing crossed 100. Every individual signal stays low enough that none buckets alone (each needs
    corroboration), and `spam_auto` is recoverable, so a false positive is a nuisance the
    operator can undo, not a lost lead.
  - **Cold-outreach / SEO keyword phrases** added to `SPAM_KEYWORDS` (multi-word, so they
    stay high-precision): "guest post", "link building", "first page of google", "position
    your brand", "within 24 hours", "virtual assistant", "seo problem", etc.
  - **Gibberish-token signal** for random keyboard-mash form-filler bots — detected by a run
    of ≥5 consecutive consonants in a long token (real English words never exceed 4), Latin
    a-z only so native-script names are untouched. Body +35 (strong tell); name +35 only
    under a stricter single-token rule, so a consonant-heavy real surname can't bucket alone.
  - **Bare-domain signal** (+20) for a pasted `brand.com` with no scheme/www — the exact
    dodge past the URL regex — excluding email domains, only when no real URL is present.
  - **URL contribution capped** at two links (max +50) so a genuine lead pasting their site
    plus portfolio stays under the threshold on links alone.

  Measured on the live sample at threshold 60: 8/20 hand-marked spam now auto-bucket (was
  0/20) plus additional unmarked inbox spam, with **zero false positives on genuine leads**.
  The residual miss — grammatically clean single-signal outreach — needs a velocity /
  duplicate-submission signal, which is the tracked next lever (it requires an ingest-time DB
  lookup).

- 0d543e8: fix(forms): hard-block missing-token submissions on gated sites + duplicate-body velocity signal

  Two ingest-time spam defenses aimed at the current direct-POST outreach flood, which
  the content classifier can't reliably catch (grammatically clean, single-signal pitches).
  Both bucket to the recoverable `spam_auto` status, never to a hard reject.
  - **Absent Turnstile token → auto-spam on `Require Turnstile` sites.** `verifyTurnstile`
    now distinguishes a _configured-secret-but-no-token-forwarded_ case as a new `"absent"`
    outcome. A real browser that renders the widget always sends a token, so a completely
    missing one is the direct-POST-bot signature. On a site that has opted into
    `Require Turnstile`, both a forged token (`"fail"`) and an absent one now escalate
    (reasons `turnstile-required-failed` / `turnstile-required-absent`). A _present-but-
    expired/duplicate_ token stays `"unverifiable"` and fail-open — a real browser did
    render the widget — and sites that haven't opted in are entirely unaffected.
  - **Duplicate-body velocity signal.** The same pitch blasted across the fleet (or re-run)
    shows up as identical message bodies. Ingest now does a fleet-wide lookup
    (`countRecentDuplicateMessages`, case/whitespace-normalized, 30-day window) and buckets a
    repeat as `spam_auto` + `duplicate-body`. Guarded: skipped for newsletter forms, for
    bodies shorter than 40 chars (short lines legitimately repeat across real people), and
    when the row is already spam. Best-effort — a lookup failure never blocks a lead.

  Reddoor is the `Require Turnstile` canary; the absent-token block only takes effect on
  opted-in sites, so this ships safe for the rest of the fleet.

- fdc9843: Submissions & digest visibility. (a) The nightly digest gains a "Submissions"
  telemetry section (new genuine leads vs auto-filtered spam over the window, with
  a per-site breakdown when nonzero); it rides only when the digest already sends,
  so the no-noise skip rule is unchanged. (b) The cockpit "📥 N new" counts split
  actionable leads (contact/inquiry/reserve) from newsletter/rsvp signups so a
  newsletter backlog can't drown real leads. (c) `/submissions` spam-reason facet
  tokens (including the turnstile reasons) become clickable filter chips backed by
  a `reason` query param. (d) The per-site page `/s/<slug>` now shows that site's
  active alarm/watch context at the top, reusing the cockpit's own collectors +
  `assignTier` (no forked logic). (e) Markup/accessibility fixes on `/submissions`
  rows (valid list nesting; larger coarse-pointer tap targets).
- 7c75ca9: Extend the WAF-challenge honesty discipline (#428) to the crossbrowser/mobile verdicts (challenge-poisoned engine/device checks are voided against verified reachability) and the link checker (challenge-shaped link statuses get a plain-fetch cooldown re-check before counting broken); all three verdicts now name their offenders in details and the evidence note.

## 0.72.0

### Minor Changes

- a3b4873: feat: GA/Search impersonation-subject failover list. `GA_SUBJECT` now accepts a comma-separated list of Workspace subjects tried in order (a single address stays the degenerate case). Both the GA Data client and the Search Console client fall through to the next subject on auth-shaped failures (HTTP 401/403, gRPC PERMISSION_DENIED/UNAUTHENTICATED, OAuth `invalid_grant` from a suspended subject — and, for Search Console, a subject whose `sites.list` resolves zero matching properties, since that API hides inaccessible properties instead of 403ing) and emit one greppable `subject failover` warning when a later subject carries the run. This structurally mitigates the fleet-wide single-subject SPOF flagged in five consecutive review briefs: losing the primary subject now degrades to a visible warning instead of blanking every site's analytics at once. A genuine auth failure always dominates a later subject's empty-`sites.list` sentinel when deciding the thrown error, so a dying primary can never be masked as an affirmative "not on page 1" (which would clear the analytics alarm and record false data) regardless of subject order. Transient per-user quota/rate-limit 403s are distinguished from access loss so the failover warning doesn't send operators to the offboarding runbook over a rate-limit blip. The role-account cutover runbook (docs/runbooks/ga-search-role-account-cutover.md) is updated for a zero-downtime `reports@reddoorla.com,<old>` transition.

### Patch Changes

- 4c4a036: Spam-classifier false-positive tuning: non-Latin script now scores on the message body only (never the name) at a reduced weight of 25 so it needs corroboration to cross the threshold; ambiguous vertical keywords (casino, weight loss, escort, payday loan, backlinks) narrowed to clearly-promotional phrasings so legitimate business enquiries no longer score; comma/semicolon-glued URLs now count individually instead of matching as one link.
- 2ab91f6: Move the unrecognized-frequency guard to the read boundary. `toFrequency` (mapRow) used to silently coerce any non-exact Airtable frequency value to "None", which made due.ts's `⚠ unrecognized frequency` warning dead code and its trailing-space tolerance moot — a renamed or trailing-space select option silently dropped a site from report scheduling with zero signal. Now `toFrequency` trims first (so "Quarterly " schedules as Quarterly, preserving #197's intent), warns LOUDLY on any still-unrecognized non-empty value before coercing it to "None", and stays silent for blank cells. The unreachable warn/trim branches in due.ts are deleted, and the two due.test.ts cases that asserted the old behavior through a factory bypass now feed raw Airtable-shaped records through mapRow.
- 0b9c57c: LOW-severity sweep (evening-review backlog). Forms: `createIngestAction` guards `buildPayload`/`buildSubmissionMeta` so a bad field access becomes `fail(400)` not a 500 (endpoint parity); the screen-out beacon key is namespaced to `_screenOut` (both keys accepted for wire-compat with older senders); the unused visitor user-agent is no longer forwarded in `_meta`. Audits: distinct greppable log labels for `fleet_events` prune failure and the Dependabot→pnpm-audit degradation; the Netlify deploy fetch is bounded with an `AbortSignal.timeout` so a half-open TCP can't stall the fleet sweep. Dashboard: `trigger-renovate` rejects a malformed legacy `Git repo` cell (reuses `REPO_RE`) instead of dispatching into a 502, and its stale `makeGitHub` comment is corrected to `makeGitHubRest`. Recipes: `selftest email --all` targets report-eligible statuses (maintenance + hosting) rather than a hard-coded `maintenance`. Configs: the unused `playwrightA11yConfig` export is removed. Tests: `draft.test.ts` writes its preview under `os.tmpdir()` via `mkdtemp` instead of a hardcoded `/tmp` path. Docs: `TURNSTILE_SECRET_KEY` added to the deploy-env table; three stranded morning-report briefs recovered into the repo.
- 76d39a1: fix(forms): map benign Turnstile error-codes to unverifiable; fail weight 70→50

  `verifyTurnstile` now parses the siteverify `error-codes` array and returns
  `"fail"` only for `invalid-input-response` (an actual bad/forged token). Every
  other `success:false` — `timeout-or-duplicate` (expired 300s token from a
  human filling a long form, or a double-submit), `internal-error`, secret/config
  errors, unknown or absent codes — fails open to `"unverifiable"`, so a
  Cloudflare-side or operational condition never punishes a possibly-real
  visitor. The classifier's turnstile-fail weight drops from 70 to 50 so a lone
  "fail" plus one benign co-signal (a single pasted URL, +30) no longer reaches
  the spam_auto threshold of 100, and a new guardrail test pins that
  `requireTurnstile` sites keep accepting + notifying on `"unverifiable"`
  (Cloudflare outage / JS-off visitors never spam-bucket on gated sites).

## 0.71.0

### Minor Changes

- 94073af: blux grid plan 2: band classifier + widget router. `classifyBand`/`classifyBands`
  turn plan-1 `Band` trees into a typed `SliceSpec` IR — unambiguous shapes become
  CMS-editable pattern slices (TitleBand, RichText, Hero, Gallery, MediaFull,
  SplitFeature, VideoFeature, LocationMap), everything else falls back to a
  render-faithful `Grid` spec carrying the raw node tree. Promotion is strictly
  conservative: bands with surplus text, significant raw markup, or co-located
  widgets stay `Grid` so no content is ever silently dropped. The map widget is
  routed via an injected `isMapMount` predicate (plan 4 supplies the real one);
  a 16-band classification golden over the-pointe pins the fidelity gate
  (3 TitleBand, 1 Hero, 1 Gallery, 1 SplitFeature, 10 Grid).
- d3a3caf: feat(blux): Carousel slice type — slider bands emit slides + editable captions

  A source slider row (`.caslider`) whose every cell is a media slide — bare or
  captioned (`stack[media, heading]`, the band-8 archetype) — now classifies as a
  first-class `Carousel` instead of the Grid fallback. The spec carries only what
  the export structurally encodes: the slides, their caption text/role metadata,
  and `data-columns` — no autoplay/duration/dots (the export encodes none, so the
  fields are deliberately absent).

  All five emit paths gain a carousel case:
  - **Page doc:** `slice_type: "carousel"` with one item per slide in slide order
    (`{ caption }` as entity-decoded plain text with hard breaks preserved; `{}`
    for an uncaptioned slide) — caption text is Prismic-editable and the render
    zips items to manifest slides by index.
  - **Plan assets:** every slide's media is collected for upload.
  - **Presentation manifest:** new `BandPresentation.carousel` payload — resolved
    slide media plus caption `{ level, role }` metadata and `columns` — and a new
    `RenderMedia.minHeight` field carrying the source holder's inline `min-height`
    (e.g. `80vh`) so a cover-frame carousel reserves the original's height.
  - **Layout validation:** carousel slide-count completeness check (a dropped
    slide is a `media-dropped` finding, styled after the gallery check).
  - **Manifest URL rewrite:** carousel slide urls rewrite CDN→Prismic like gallery.

  Against the real the-pointe export only band 8 changes (`grid_band`→`carousel`,
  3 captioned `80vh` slides, `columns: 1`); every other band is byte-identical in
  the goldens and the structural-signature golden is unchanged.

- b087dc7: feat(blux): extract-map stage — map config + real isMapMount classifier predicate; blux grid writes map-config.json
- 5e38cf9: feat(blux): faithful-grid plan 5 — `blux convert` emits the Prismic page document
  (text + band indices) and the `blux-presentation.json` render manifest (layout
  tree + resolved media + block styles + map payload), keyed by band index. Media
  is Prismic-hosted: `convert` writes CDN urls + the asset list, and `blux migrate`
  uploads the assets and rewrites the manifest urls to Prismic for durability.
  Parser fix: Blux custom-code embeds (`[data-exec]`, incl. the map mount) now
  survive as `raw` leaves instead of being peeled away.
- ef63b0f: feat(blux): faithful-grid emit — extract three things the Blux export already
  encodes but the pipeline was dropping, so every future site inherits them
  instead of needing per-site hand-edits.
  - **Media intrinsic sizing.** `Media`/`RenderMedia` gain `width`/`aspect`/`fit`,
    read off a foreground image holder's inline pixel `width` (the width the export
    actually renders it at — rule, logo, or full photo), its `.mediaRatio`
    `data-og-ratio` (aspect), and `background-size` (contain/cover, case-insensitive).
    The render layer treats `width` as advisory and caps it at 100% of the cell, so
    a graphic keeps its true size and a photo still fills. Non-px widths and band
    backgrounds carry no sizing.
  - **Hard line breaks + entity decoding.** Title text now flows through a shared
    `blockPlainText` (headings and subtitles alike): a display title's `<br>`
    survives into the page doc as a newline (was collapsed to a space) while
    insignificant source-formatting whitespace folds to spaces (robust to
    non-minified exports), and HTML entities decode (`Bar &amp; Grill` →
    `Bar & Grill`) consistently across both paths.
  - **CTA links.** A leaf `<a>` (an in-band button/text link with no structural
    descendants) is captured as a `raw` node instead of being peeled away and
    dropped; an anchor that wraps media still peels so the inner image resolves.
    A band whose only surplus content is such a link falls to the render-faithful
    `Grid` fallback rather than silently dropping the link during promotion.

  Site-level design tuning (content padding, hidden-on-live elements, column
  widths) is deliberately NOT extracted — it is not encoded in the export and
  stays a per-site concern.

- e503928: blux grid plan 6: offline layout-signature validation gate. New pure
  `validateLayout` diffs the classified `SliceSpec[]` (the source answer key,
  already gated band→spec by the classify golden) against the emitted
  `blux-presentation.json` manifest and names every band whose layout drifted,
  media dropped, or map went missing — no browser, fully deterministic. Grid
  bands must round-trip their structural signature (`sigOf`, token-canonical so a
  source node and its `raw`-less render twin compare equal); smart slices are
  payload-checked, and a SplitFeature's text subtree is signature-checked too so
  a dropped nested media isn't reported faithful. `blux convert` now appends a
  fidelity summary and writes `layout-report.json` (still exits 0 — a generator
  never gates); `blux validate <dir>` runs the gate offline and exits non-zero on
  findings, with `--against <file|url>` layering the existing content-coverage
  check as informational text. The convert pipeline is extracted into a shared
  `convertExport` so convert and validate agree on which media resolve. A
  grid-validate golden pins the-pointe converting with zero findings.
- f1d7d1c: form-e2e goes live, safely: the live Playwright runner now preflights each site's `/health` and refuses to submit unless it declares `forms.testMode: true` (strict boolean, fail-closed on any fetch/parse error) — a new `testModeUndeclared` outcome maps to a plain skip (no details, prior verdict preserved), distinct from the persisted no-form n/a. A site only becomes probe-eligible by shipping the starter's contact `buildPayload` forwarding and the `/health` declaration in the same deploy, so an armed fleet run can never deliver the probe as a real lead. New nightly `fleet-form-e2e.yml` producer (10:15 UTC, checkout-free, `REDDOOR_FORM_E2E_LIVE=1`) writes `Form E2E OK` + `Form E2E checked at` to Airtable with the same FLEET_WRITE_SUMMARY gate + tracking-issue alerting as fleet-smoke.
- c899f67: The shared `configs/playwright-a11y` base now honors `REDDOOR_SMOKE_PORT`
  (R1.1 port binding): when the central smoke audit allocates a port, the base
  binds vite to it with `--strictPort` and aims the baseURL + readiness probe at
  it. Previously only sites on the smoke-suite recipe's R1.1 config template got
  this protection — sites whose `playwright.config.ts` merely re-exports the
  shared base (the sync-configs canonical shape; pre-R1.1 adopters the recipe
  flags but never rewrites) hard-coded 5173, so any vite already squatting that
  port was silently tested instead of the site. Observed live during tonight's
  fleet-smoke triage: caltex's suite ran against erp-industrial's dev server and
  reported the wrong site's results. Re-exporting sites inherit the fix on their
  next `@reddoorla/maintenance` bump; behavior with the variable unset is
  unchanged (fixed 5173, no `--strictPort`).

### Patch Changes

- 64e3e09: fix(blux): recover captions nested inside a media holder + drop empty casliders

  Two coupled parser fixes for the band-8 archetype (a captioned image slider):
  - **Media-leaf caption capture (A):** Blux slider tiles nest the slide's caption
    (`block-title`/`body`/`subtitle`) INSIDE the `.camediaload[data-media]` holder,
    which the parser treats as an opaque media leaf — so those captions were
    dropped and the band degraded to a bare image gallery. `parseNode` now, when a
    media holder carries text descendants, emits the media PLUS the caption(s) as a
    `stack[media, …caption]`. This does NOT change the peel boundary
    (`isLeafElement`/`collectStructuralChildren` are untouched) — only the holder's
    own internal text is recovered. A pure-media holder (the vast majority) stays a
    bare media node, byte-identical.
  - **Empty-caslider cleanup (G):** `parseContainer` now parses its structural
    children up front and drops any that collapse to an empty `raw` (an empty,
    JS-hydrated `.caslider` with no static slides), so a lone poster image is no
    longer misrepresented as `[media, empty-block]`. Non-empty raws (`[data-exec]`
    embeds, leaf anchors) always carry real html and are kept.

  Fleet-regression verified against the real the-pointe export: only band 8
  (`Gallery`→captioned `Grid`, its 3 captions restored) and band 12 (empty raw
  removed) change; the other 14 bands — including the `.camediaload`-background
  Hero/Grid/Split bands 0/1/7/9/11 — are byte-identical in the structural-signature
  and classify goldens. The carousel _slice type_ (rendering band 8 as a true
  one-at-a-time slider) is a separate follow-up; band 8 is fully faithful as a
  captioned grid.

- 7e876e5: fix(blux): emit fidelity pass — backgrounds, video, title roles, fonts, map

  Seven additive faithfulness fixes found by auditing the emit output against the
  real the-pointe export, none touching the core media-leaf/wrapper-peel path:
  - **Band backgrounds** now carry `background-size` (`auto`/`contain`) + non-center
    `background-position`, so a corner-anchored native-size accent (`bg-lines-*.png`
    on bands 1/7/9) isn't stretched full-bleed like a `cover` photo.
  - **Foreground video** captures its intrinsic aspect (the `%`-suffixed
    `data-og-ratio`/`.mediaRatio`, which previously NaN'd) and its `<video>`
    playback attributes (`controls`/`playsinline`/…), so a user-controlled inline
    video isn't rendered as a background loop.
  - **Hero/TitleBand** carry the heading's `textN` role + level and the subtitle's
    role (band 15's script-accent title no longer renders like a plain title). The
    text itself stays the Prismic page-doc string.
  - **Typekit fonts**: a `T:` `font-ident` decodes to the real family (`ysxc` →
    Montserrat) instead of the obfuscated id, and its weight (n6 → 600) is folded
    into the font-load hint that `settings.fonts.google` omits.
  - **Map**: the mount's inline `height` (600px) and the chip→content-panel binding
    (`panelIndex` + `defaultToggle`) are extracted.

  Render-side consumption of these fields (the-pointe) is a separate front-half PR.
  Golden + unit tests updated; the convert-golden stub resolver now mirrors the
  real passthrough so position/playback are exercised end-to-end.

- 511b815: fix(blux): parse the grid `-s<N>` suffix as spacing, not a cell width

  The Blux grid token `grid-1-s40` / `grid-any-s20` encodes the grid's inter-cell
  spacing (matching `data-spacing`), with the real column count in `data-columns`.
  The parser was storing that `s` value as `sized` and the render layer treated it
  as a width percentage — so a single-column stat list (`grid-1-s40`, four items)
  rendered as a 40%-wide 2×2 grid instead of a full-width vertical stack. Renamed
  the token field `sized` → `spacing` and stopped using it for width; cell width
  now comes only from `cols`/`ratio`, faithful to what the export encodes.

- f88ad21: fix(blux): capture a `<video>`'s CDN base from its `src` so videos resolve
  offline like images. Previously a video parsed with only assetId+ext (no
  `base`), so `mediaCdnUrl` returned null and the video resolved solely via the IR
  sourceUrl — i.e. it depended on site.json listing the asset, breaking convert's
  offline invariant even though the full url sits on `<video src>`. The parser now
  records the src prefix as `base`, so `blux convert`/`blux validate` resolve
  the-pointe's hero video (and any `<video>`) from the markup alone, with no
  site.json asset entry.
- 722198e: form-e2e live runner: click `input[type="submit"]` as well as `button[type="submit"]`. reddoor-website's contact form uses the input variant — the first enrolled run timed out waiting for a button and recorded a false `Form E2E OK = fail`.
- d3c32ed: Forms hardening from the espada form-e2e investigation: (1) `submitToIngest` now bounds the site→central call with an abort budget (`timeoutMs`, default `INGEST_TIMEOUT_MS` = 8s) — a central function hung mid-deploy previously left the visitor's submit awaiting until Netlify killed the site function at its 10s limit, returning a broken response instead of the friendly error copy. (2) The form-e2e live runner now captures the action POST status (+ error-body snippet on ≥400) and any `role="alert"` text when the success banner never appears, so a failing site names the real server response instead of an undiagnosable "no success banner after submit".
- c899f67: smoke-suite recipe: detect the hydration marker instead of hardcoding `footer`. Bespoke sites whose Svelte source renders no literal `<footer>` element (a capital-F `<Footer />` component tag doesn't count) now get a `main` — or, failing that, `body` — marker in the generated `tests/smoke/routes.ts`, with a recipe note flagging the missing landmark. Starter-shaped sites still receive the byte-verbatim template. Prevents the false-fail that red'd la-homelessness-initiative on the first nightly fleet-smoke run.

## 0.70.0

### Minor Changes

- 95e7aa3: `blux` CLI command group. `blux emit <exportDir>` runs the deterministic conversion offline and writes the migration plan, `customtypes/*.json` schemas, theme CSS, review manifest, and assembled IR (plus a diagnostics summary). `blux migrate <outDir>` executes an emitted plan against a live Prismic repo — creds-gated on `PRISMIC_REPOSITORY_NAME` + `PRISMIC_WRITE_TOKEN`, pushing custom types via the Custom Types API and documents + assets via the Migration API (`@prismicio/*` are lazily-imported devDependencies, so consumer installs and CLI startup stay clean).
- 32c92bb: blux emit: emit the `.txt-role-textN` utility layer into `theme.css`

  `blux emit` now appends one `.txt-role-textN :is(h1…h6,p)` utility per text
  role directly after the `@theme` block, generated from the IR's text styles.
  A converted site imports the emitted `theme.css` and gets both the role
  tokens and the utilities that map them onto headings/paragraphs — the same
  CSS the-pointe hand-generated with a per-site script, now owned by the
  pipeline so future conversions cost zero hand-tuning. Verified byte-identical
  (all 14 roles) to the-pointe's hand-generated file.

- 749d472: Blux pipeline hardening from the first live conversion: emit now coerces rich text to each slice's allowed block types, flattens deep section trees into sequential slices, skips empty pages, and drops non-image assets from image fields (all recorded as plan diagnostics); `blux emit --probe` reconstructs + HEAD-probes CDN URLs for used assets the HTML scrape missed; the migration runner is rewritten on the raw Prismic APIs — upserts documents by uid, reuses already-uploaded assets, and surfaces full validation details.
- f265d2e: blux: parse the export's style data and surface it for the design pass.
  - `normalizeTheme` now parses the real `styles.text` shape (`{ _label, ".textN": { css props } }`) into named `TextStyleIR` roles — font family (quotes stripped), size, weight, line height, text-transform, letter-spacing, and `__media_mobile_*` responsive overrides. Roles are named from the entry's own `.textN` key, so deleted-style `{ removed: true }` tombstones drop out instead of emitting phantom default roles and role names never renumber. Every value passes a shared CSS cleaner that rejects Blux's malformed placeholders (`""`, `"px"`, `"0.px"`) so they can't poison a Tailwind custom property.
  - The theme font pair falls back to Blux's default roles (text0/text1) when `settings.fonts` names none, and `settings.fonts.google` is parsed into a font-load spec (family + numeric weights) so the design pass installs the exact `@fontsource` weights instead of measuring them off the rendered site.
  - `theme.css` emits the full var set per role (`--text-textN` and `--line-height`/`--font-weight`/`--font-family`/`--text-transform`/`--letter-spacing`/`--mobile-font-size`/`--mobile-line-height`), labeled with the role's export name, led by a `/* Fonts to load — … */` comment.
  - Sections gain `presentation` hints: the text roles a block's `_title`/`_body` class references, per-element inline overrides on those elements (e.g. a hero title's white `color`), and the block's own layout styles. These ride the migration plan as `stylesManifest` (emitted as `styles-manifest.json`, indexes aligned with each document's post-filter slice zone) and are never pushed to Prismic — the consuming site's design pass works from data instead of screenshots.

- 32c92bb: blux validate: deterministic content-coverage check against the export

  New `blux validate <exportDir> --against <rendered.html | url>` action. The
  export's `index.html` is the answer key; the command extracts its visible
  text runs and reports which appear in the converted site's rendered HTML, so a
  conversion's fidelity is a one-command coverage score instead of a per-page
  eyeball. On the live the-pointe render it scores 81% and names the real gaps
  (un-migrated hero overlay copy, portfolio section labels), spending zero
  tokens to find them. Matching folds case, entities, and punctuation to
  compare words rather than typography.

### Patch Changes

- ab664c1: fix(blux): read display text from `title`/`body`, not the `_title`/`_body` style objects

  Blux stores a block's display text in `title`/`body`; the underscore twins are
  per-element style config where `class: "disable"` hides the element on the
  rendered site. The normalizer preferred the style object and stringified it,
  migrating literal "[object Object]" text (230 spots on thePointe) plus 66
  disabled editor labels that never render. Text now comes from the right field,
  disabled elements are omitted, and the archetype rules gain honest signals:
  a background image/video alone is a hero (Blux text-less banners), and media
  next to any visible copy stays a media_text instead of falling to the bare
  fallback and losing the image.

- 58f0b66: `smoke` audit now surfaces the actual Playwright failure. On a non-zero run it distilled `stderr.slice(0, 200)`, but Playwright writes its failing-test list (which test, expected vs received) to **stdout** — so the fleet-smoke summary/Airtable captured only a `[WebServer] npm warn …` line and hid what broke. `summarizeSmokeFailure` now extracts the failing test title + Error/Expected/Received head + the "N failed" tally from stdout (ANSI-stripped, capped), falling back to stderr only when stdout carried no reporter output.

## 0.69.0

### Minor Changes

- bc6d695: New `@reddoorla/maintenance/client` subpath: `whenPageReady()` and `prefersReducedMotion()` — load-aware page readiness for splash screens and intro overlays. Replaces the fleet's blind `setTimeout` splash timers with real signals (eager-image settlement, optional document load, caller-supplied promises) bracketed by a `minMs` floor and `maxMs` ceiling. Framework-free, SSR-safe, dependency-light (gated by smoke-dist like `./forms`).

## 0.68.0

### Minor Changes

- 2e0206b: The dashboard's pending-report rows now tell the whole approval story: the
  resolved recipients exactly as the send path computes them (To override →
  point of contact, plus the forced ops CC), a draft-time preview link to the rendered
  email (labeled as such — send re-renders with current Commentary) (or "no preview yet"), and when an approval actually goes out — the next
  09:23 UTC daily run, with an hours countdown. Approve was the
  highest-stakes, most information-starved click on the dashboard (operator
  approve-loop UX memo, proposal 1); it now shows what it sends, to whom, and
  when.
- b506b48: Approve-time send-blocker gate. `approveReport` now blocks (with reasons) any
  report whose send is already known to throw — missing/malformed recipients,
  missing header image, or a null report-level Lighthouse snapshot — via a new
  pure `approveBlockers(site, report)` shared by three surfaces: the approve
  endpoint (closes the vacuous gate on Launch/Announcement, which have no
  checklist), the per-site dashboard's pending rows (a preflight chip: red =
  blocked + button disabled, amber = To resolves to operator addresses only,
  green = clear, reasons in the tooltip; the history-table approve action is
  gated identically), and a new daily-digest collector that surfaces
  approved-but-doomed reports as critical "will fail at send" attention items
  the evening before the 09:23 UTC run would go red.
- 0fa3b55: New `ensure-site <slug>` command: find-or-create the Airtable Websites row for
  a new site (Status "in development", Git repo default `reddoorla/<slug>`),
  fill-blanks-only on re-run so operator edits are never clobbered. Day-one step
  of the /new-site bootstrap workflow — the row makes audits, form-ingest slug
  resolution, and reports work from birth.
- 7a52ab4: New `preflight [site] | --all` command: read-only pre-send checks over the live
  Airtable rows. Fails on what would make drafting or `report --send-ready` throw
  (missing/malformed recipients, missing header image, missing Lighthouse scores
  for Maintenance/Testing drafts) and on RAW frequency cells the mapper would
  silently coerce to "None" (typos, trailing spaces — the site quietly drops off
  the schedule). Warns on what send-time validation can't see: operator addresses
  left in a client site's resolved To, unsent queued drafts that would race the
  new report (the current cycle's own payload is informational, not a warning),
  and truly stale schedule anchors (suppressed when a newer Sent-at supersedes
  them). Fleet mode mirrors the real pipelines: Announcement checks announce's
  maintenance-status targets; Maintenance/Testing check everything `report --due`
  schedules (eligible + null-status rows). Exit 0 = safe (warnings printed),
  1 = hard failure, 2 = bad args. Never writes, never sends.

  Also exposes `maintenanceFreqRaw`/`testingFreqRaw` on `WebsiteRow` (the literal
  Airtable cells behind the coerced frequencies) and exports `ELIGIBLE_STATUSES`
  from due.ts.

## 0.67.0

### Minor Changes

- 1cbff3a: Forms spam defense: restore the content-based spam filtering that was lost when the fleet moved off Netlify Forms (which ran Akismet) to the central token-gated ingest. Two free, complementary tiers now sit on top of the existing honeypot/timing screen:
  - **Heuristic classifier (central).** A pure `classifySpam` scorer folds content signals (link count, link markup, spam keywords, non-Latin script, disposable-email domains, URL-in-name, degenerate/all-caps content — scanned across `message` and site-specific free-text `extraFields`) plus the Turnstile verdict into a `spam_score`. Above `SPAM_THRESHOLD` the submission is stored as a distinct `spam_auto` status with `spam_score`/`spam_reason` recorded for tuning.
  - **Cloudflare Turnstile (edge, verified centrally).** Each site forwards a widget token in a stripped `_meta` envelope; `form-ingest.mts` verifies it against a single `TURNSTILE_SECRET_KEY`, so no per-site secret is needed. A per-site `Require Turnstile` Airtable flag hard-flags a genuine challenge failure.

  Auto-spam is a **recoverable** row, not a drop: it suppresses both the operator notification and the submitter autoresponder and skips newsletter fan-out, is hidden from the per-site lead strip, and is reviewable on `/submissions` (with a provenance badge and a "Not spam → new" button) plus a cockpit "auto-filtered" affordance. The operator-marked `spam` metric is untouched (distinct status).

  Everything fails open — a Turnstile timeout, unset secret, absent token, or a classifier throw never 502s an accepted lead; bots get no signal (`{ ok: true }`, no notify-status echo). Visitor IP/UA are used only transiently (Turnstile `remoteip` + scoring) and never persisted; the `_meta` token/IP/UA can never leak into stored lead data.

  Ships dark and useful: the classifier bites spam immediately with zero per-site changes; Turnstile activates per site as `reddoor-starter` rolls out the widget. Operator prerequisites before activation: set `TURNSTILE_SECRET_KEY` (dashboard env) + `PUBLIC_TURNSTILE_SITE_KEY` (per site), and add the `Require Turnstile` boolean column to the Airtable Websites table.

## 0.66.0

### Minor Changes

- b1750b2: Scheduling: the "next maintenance / next testing" dates are now owned by the code, not an Airtable formula + automation. A new shared `nextDueDate(site, reports, type, today)` (the same `lastSent ?? anchor) + frequency` logic the scheduler already uses — extracted so `findDueReports` and the display can't drift) computes each site's true next-due date, and the nightly `report --due` sweep writes them to Airtable `Next maintenance at` / `Next testing at` date fields (best-effort, per-site isolated, and run even when nothing is due so the dates stay fresh).

  This replaces the prior setup where an Airtable automation overwrote the `maintenance day` anchor with a `DATEADD(TODAY(), frequency)` formula value — which the scheduler then added the frequency to _again_, pushing the first post-announcement maintenance report a full cycle late. With the automation removed, `maintenance day` / `testing day` are clean operator-set anchors and the next-due dates shown in Airtable derive from the exact logic that drafts the reports. Operators should delete the old `next maintenance day` / `next testing day` formula fields (nothing in the code reads them).

## 0.65.3

### Patch Changes

- 6e5d3b1: fix(svelte5): the `dollarPropsClass` codemod no longer emits an invalid rest element

  When the `$props()` destructuring it extends already ended in a rest element (`...rest`, as produced by `exportLetToProps` or the official `svelte-migrate` pass), the codemod appended `class: className = ""` AFTER it, emitting `let { …, ...rest, class: className = "" } = $props()`. A rest element must be last in a destructuring pattern, so this was invalid JS — every site with a `$$props.class` pass-through plus a rest element failed to compile with "A rest element must be last in a destructuring pattern" / "Comma is not permitted after the rest element" (~12 files on hedloc's Svelte 5 migration alone).

  The codemod now inserts `class: className = ""` BEFORE a trailing rest element, producing the valid `let { …, class: className = "", ...rest } = $props()`. Bodies with no rest element are unchanged (class still appended), and a rest-only body becomes `{ class: className = "", ...rest }`.

## 0.65.2

### Patch Changes

- 81540af: Cockpit deps metric now surfaces the registry-major outdated count. The deps audit already computed `OutdatedCounts.major` (how many installed deps are a full major behind npm's latest), but it was dropped at `depsCountsFromResult` and never reached the dashboard — the cockpit only showed `X drifted (Y major) · Z outdated`, where `(Y major)` is drift vs the fleet baseline, easily misread as "majors available". The count is now plumbed through `DepsCounts` → the Airtable `Deps Major Outdated` field → `WebsiteRow.depsMajorOutdated` → the render, so the deps span reads `X drifted (Y major) · Z outdated (N major)` — the new `(N major)` being majors behind the registry, distinct from the baseline-drift major. The value is null-guarded end to end: it's only written/rendered when known (including a real 0), and absent on older Airtable rows it simply omits, so nothing is back-filled with a misleading count.

  Note: requires a Number field `Deps Major Outdated` on the Websites table before the audit writes a non-null value.

- 7f1e8f2: Maintenance email: refresh the "testing" placeholder. The blurred-tests teaser image is replaced with the new design (the frosted testing checklist behind a "Request Testing Upgrade" button + invitation copy), and the "Last Tested: <date>" line beneath it is removed. The new image is exported at 2× (1200×1362, ~470 KB — lighter than the prior 590 KB asset) and keeps the same `blurredTests.jpg` filename/cid, so the swap is asset-only. The underlying `lastTestedDate` field is still computed and stored on the Airtable Report row (and used by the dashboard); only the email line is gone.

## 0.65.1

### Patch Changes

- 08c966d: Fix: an announcement-time GA/Search outage now surfaces the per-site analytics-failure signal instead of silently hiding the traffic block. The `announce` recipe read only `.value` from the soft-failing GA/Search enrichment and never recorded `analyticsSoftFailAt` — so if Google errored during the monthly announcement run, the email's analytics block simply disappeared (reading identically to "site has no GA configured"), the operator got zero signal, and the client received a one-time onboarding email with the traffic section missing. `announce` now mirrors the `--due` draft path: when GA is configured for the site, a soft-fail stamps `Analytics soft-fail at` (driving the cockpit/digest alert) and a clean enrichment clears it so the signal self-heals. Best-effort write — the operator-added column's absence can't break the draft.
- f4dd1df: Email footers: the first contact line ("Just hit reply.") now renders as a red bold heading, matching the "questions, concerns or requests?" title directly above it — across all three report email types (announcement, launch, maintenance). Previously it was plain black body text, so the call to action read as a quieter footnote than the question prompting it. Following contact lines (e.g. "We're here to help in any way we can.") are unchanged.
- d5beaf8: Docs + health: document the dashboard's deploy env, and surface `TURSO_DATABASE_URL` in the webhook health check. The deployed Netlify functions read `DASHBOARD_PASSWORD` (the cockpit/per-site auth gate), `DASHBOARD_BASE_URL`, `RENOVATE_TOKEN` (the "Trigger Renovate" button), and `GH_TOKEN` (request-path GitHub REST), but the README "Set env vars" table listed none of them — so a by-the-book deploy produced an unauthable dashboard with dead action buttons. All four are now documented. The `resend-webhook` GET health check (the README's post-deploy smoke test) now also reports `TURSO_DATABASE_URL` presence, since its absence 500s the whole dashboard + forms surface — the most common fresh-deploy failure — and Netlify env vars are site-wide. Presence-only, never values.
- 84369b4: Fix: the "got through, marked spam" metric no longer double-counts when an operator re-marks a submission. It was an increment-only counter (`recordMarkedSpam`) bumped on every transition into `spam`, so toggling a submission spam → new → spam inflated the tally to 2, and un-marking never decremented — the per-site spam-through count on the cockpit could exceed the number of distinct spam submissions. `listScreenOutsSince` now DERIVES `markedSpam` from the rows themselves — a live `COUNT(*) FROM submissions WHERE status = 'spam'`, windowed by `submitted_at` — which is exact, idempotent under re-marks, and self-corrects an un-mark. It's also now arrival-dated like the honeypot/too-fast buckets (the old counter was mark-dated). No migration: the `recordMarkedSpam` increment is dropped from the status-change path and the legacy `marked_spam` column is simply no longer read.
- b08c3da: Fix: a transient Netlify API failure no longer clears a real "deploy errored" alarm from the cockpit's Broken band. The deploy probe previously used `null` as a single sentinel for both "couldn't read the API" and "site has no production deploy", so a network error / non-2xx / malformed response during the nightly sweep overwrote a genuine `error` deploy status to `null` — silently dropping a broken production site out of the Broken band ("all clear" while prod was down). The probe now returns a discriminated `NetlifyDeployFetch` (`{ ok: false }` for a read failure vs `{ ok: true, deploy }` for a real read), and on a read failure the audit returns no details so the Airtable writer leaves the prior `Deploy status` intact. A genuine empty deploy list still persists `null` (a real "none" verdict). The principle: an _alarm_ field preserves its prior value on an uncertain read, where a _pass-gate_ field clears.
- e002359: Fix: a single failing site no longer aborts a whole `--fleet` recipe run. The fleet commands `self-updating`, `sync-configs`, `onboard`, `convert-to-pnpm`, `bump-deps`, `svelte-codemods`, and `upgrade` each looped `for (const s of sites) results.push(await recipe(s))` with no per-site error handling. The recipes throw on a non-clean working tree (and on transient git errors), so the first site with a dirty checkout threw out of the loop and every subsequent site was silently never processed — surfacing as a crash rather than a per-site report. A new shared `runRecipeOverSites(recipe, sites, run)` helper runs the recipes sequentially (they do git/filesystem work) and isolates each site: a throw becomes a `failed` RecipeResult so the rest of the fleet still runs. The `init` command (which returns its own `InitResult` rather than a `RecipeResult`) gets the same per-site isolation inline. This mirrors the isolation `prepareFleetSites` already provides for the clone/prep phase, one layer up at recipe execution.
- fc02667: Fix: `self-updating` now corrects a present-but-STALE config, not just a missing one. Its gate was existence-only — it opened the bootstrap PR only when `ci.yml` / `renovate.yml` / `renovate.json` was absent on the default branch, and reported "already self-updating" for any repo that merely HAD the three files, however out of date. So drift it exists to repair (an old pinned reusable-workflow SHA, a stale Renovate schedule window — the exact class behind the months-long fleet auto-update regression) was invisible forever. The recipe now content-diffs each template against the canonical version via a new `GitHub.fileContentsOnBranch` (raw GitHub contents API), and opens (or notes an already-open) PR when any file is missing OR drifted. A trailing-whitespace/line-ending-only difference is normalized away so it can't open a needless PR every nightly run, and the existing `findOpenSelfUpdatingPR` dedup keeps drift from churning more than one open PR per repo.

## 0.65.0

### Minor Changes

- 8813bb2: Cockpit accepted Watch conditions. A new `Accepted Watch Conditions` Airtable Websites field lets the operator mark a watch condition (a Lighthouse category, stale repo, or no-custom-domain) as reviewed and accepted on a per-site basis. `assignTier` routes an accepted, currently-active condition out of the amber Watch band — an all-accepted site goes healthy and leaves the Needs-you feed + verdict count — while it stays visible as a muted "✓ accepted: …" chip on the Fleet-browse card. Acceptance is watch-only: a sub-floor (broken) Lighthouse score still alarms, so accepting "Best Practices 78" never hides a drop to 72. Ships dark until the Airtable field exists (`?? []` no-op).
- 840c43a: security audit: ingest GitHub Dependabot alerts as the source of truth

  The `security` audit now reads a repo-backed site's GitHub Dependabot alerts (prod **and** dev, from the GitHub Advisory DB) via the REST API and writes the severity counts + advisory list to Airtable — fixing a false-green blind spot where `pnpm audit --prod` reported 0 critical/high while Dependabot flagged real (often dev-scoped) criticals.
  - `securityAudit` prefers Dependabot when the site has a `gitRepo` and a `GITHUB_TOKEN` is available; it falls back to `pnpm audit` (then `npm audit`) for repo-less sites or any API error (403/404/network) — a Dependabot hiccup never fails a site.
  - All open alerts count toward the tallies; the cockpit's auto-patching (amber Watch) vs Renovate-exhausted (red Broken) bands decide urgency. Each advisory now carries its dependency `scope` (`"runtime"` | `"development"`), surfaced as a `(dev)` tag on the per-site dashboard.
  - New `makeGitHubRest().listDependabotAlerts()` — cursor pagination via the `Link` header (the endpoint has no numeric `page` param) with a per-request abort timeout so a hung connection falls back instead of stalling the sweep. `fleet-security.yml` passes the org PAT as `GITHUB_TOKEN`; it needs the **Dependabot alerts: read** permission on the fleet repos, otherwise it degrades gracefully to `pnpm audit`.

### Patch Changes

- db8e3e2: Lazy-load the libSQL/Kysely stack in `db/client` so the `audit` CLI command no longer eager-imports the central-only DB devDependencies. `reddoor-maint audit` (run in every fleet site's CI) crashed with `Cannot find package '@libsql/client'` because the `audit` entry transitively reached `db/client` (via `fleet-events-writer`), whose top-level `import` of `@libsql/client` / `kysely` / `@libsql/kysely-libsql` resolves to devDeps that consuming sites never install. Those values are now imported dynamically inside `openDb()`, keeping the module graph dependency-free until an actual DB connection is opened (the fleet-events writer already swallows the open failure best-effort). The dist smoke gate now also loads `cli/commands/audit.js` under the central-dep blocker — the `bin.js --version` check missed this because CLI subcommands load lazily.

## 0.64.0

### Minor Changes

- 6d2dcc7: Cockpit three-band severity. The fleet verdict bar goes from binary (green "All clear" / red "N need you") to four worst-band-wins states — green (all clear) / blue (waiting on your yes) / amber (watch) / red (broken) — with lower-band and healthy counts in the meta line. The Needs-you feed gains an amber **Watch** band between Broken and Waiting that surfaces self-patching vulns (a CVE Renovate is still auto-fixing, which previously hid under "All clear") and the whole former watch tier (degrading Lighthouse, stale repo, no custom domain). An exhausted vuln still escalates to red Broken.

## 0.63.0

### Minor Changes

- 65b668b: New `selftest email [site]` CLI command: preview any report email (announcement/maintenance/testing/launch) for a site — or `--all` maintenance sites — to yourself (`--to` to override; defaults to `OPERATOR_EMAIL`), with `--dry-run` to render to disk. No Airtable side effects. Faithfulness via a shared `renderReportEmail` seam used by both the real send path and the self-test, plus a shared `defaultReportSubject`.

## 0.62.1

### Patch Changes

- 91e79f3: Report emails now hide the ANALYTICS block instead of rendering an empty "— Users" placeholder when there's no traffic data. The block appears only when there's something real to show — a GA user count or a page-1 search callout; a GA-less site that still ranks shows just the search line (no user count), and a site with neither drops the block (and its data-contextual SEO call-to-action) entirely. The announcement template's alternating band colors stay correct when the block is hidden (the dropped band no longer consumes a color slot).

## 0.62.0

### Minor Changes

- 63d5ecf: Fleet activity feed: a recorded `fleet_events` log (libSQL) written by the nightly producers (auto-merged Renovate PRs, cleared vulns, recovered CI, renewed certs, launches, per-sweep rollups) and surfaced as a collapsed "Recently" lane on the cockpit. Ships dark until `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` are added to the fleet workflows.

### Patch Changes

- 2f9ed6f: Announcement email copy/style tweaks: subject now reads "Your testing & maintenance report for {Site Name} ({domain})" (was "schedule for {name}"); the contact heading drops the leading "Any" ("Questions, concerns or requests?"); the cadence reassurance tail ("there's nothing you need to do.") renders in italics; secondary contact lines render in muted grey. Shared report sections gain two improvements that also reach the monthly maintenance report: the Lighthouse footnote links "Google's Lighthouse tool" to the Lighthouse docs, and the analytics trend names the concrete comparison window ("vs the previous N days") instead of the generic "last period" (announcements use a fixed 30-day window; other reports derive it from the stored period).

## 0.61.0

### Minor Changes

- 6272c64: Dashboard: reorganize the fleet cockpit around "check nothing's on fire". A glance
  verdict (✓ All clear / ⚠ N sites need you) leads the page, followed by a single
  per-site, navigation-only "Needs you" feed (Broken → Waiting on your yes → Slipping;
  every row opens the site page). The fleet card browser and the submissions/spam inbox
  move into collapsed lanes, and the card filters now work (one flat grid, no nested
  collapsed tiers). Vulns only enter the feed once Renovate's auto-fix is exhausted, so
  the verdict can read All clear while the fleet patches in the background. The fleet
  sweep button is relabeled Refresh → Audit.

## 0.60.1

### Patch Changes

- c6393d5: Dashboard: the fleet-refresh spinner now shows live detail for the long
  Lighthouse sweep — the current build phase (setting up → building → installing
  browsers → auditing the fleet…), elapsed time, a per-workflow ETA, and a
  view-run link while running. Adds `currentRunStep` to the GitHub REST client.

## 0.60.0

### Minor Changes

- 0680595: Dashboard: the "Refresh fleet state" button now follows its runs live. After
  dispatch the cockpit polls the actual fleet-security + fleet-lighthouse runs
  (per-workflow spinner → ✓/✗), auto-reloads onto fresh numbers when both succeed,
  links the run on failure, and resumes the spinner across a manual reload.
  Adds `GET /api/fleet/refresh/status`, a `listWorkflowRuns` REST method, and the
  pure `summarizeFleetRunStatus`.
- fa79c7d: feat(dashboard): add a "Refresh fleet state" button to the cockpit

  A fleet-level action (`POST /api/fleet/refresh`) that dispatches the `fleet-security` and `fleet-lighthouse` GitHub Actions workflows on demand, so vulnerabilities, auto-check signals, Lighthouse scores, and GitHub signals refresh immediately instead of waiting for the nightly cron. Reuses the authed-write gate chain and the `fetch`-based `makeGitHubRest` client. Dispatches each workflow independently (partial success is reported), confirms before firing (the sweeps are heavy fleet-wide runs), and needs `RENOVATE_TOKEN` in the dashboard Netlify env (already set).

## 0.59.1

### Patch Changes

- 2e92ae9: fix(dashboard): Trigger Renovate now dispatches via the GitHub REST API instead of the `gh` CLI

  The Trigger Renovate button (the dashboard's first request-path GitHub write) shelled out to the `gh` CLI through `makeGitHub`. That works in CI/dev but the Netlify Functions (AWS Lambda) runtime has no `gh` binary, so every live dispatch threw `ENOENT` and the endpoint returned 502. The handler now uses a new `fetch`-based `makeGitHubRest` client (default-branch lookup + `workflow_dispatch`), which is all the Lambda runtime needs.

## 0.59.0

### Minor Changes

- 15bbca5: Interactive cockpit. A "Trigger Renovate" button on repo-backed cockpit cards and
  per-site pages (authed `POST /api/sites/:slug/trigger-renovate` → dispatches that
  repo's `renovate.yml`; needs `RENOVATE_TOKEN` in the dashboard env, degrades to
  "not configured" without it). Plus an inline site-details editor on `/s/<slug>` for
  a safe-text + operational field allowlist (Status, cadences, recipients, point of
  contact, GA4 id, search query, git repo, copy overrides) via authed
  `POST /api/sites/:slug/details` — every field is column-allowlisted and validated
  before the Airtable write.

## 0.58.0

### Minor Changes

- 7ccbacc: Surface an "auto-fix failed" signal on the dashboard when Renovate has been
  auto-dispatched for the same critical/high vulnerability across 3+ nightly
  cycles without clearing it. A per-site `Security Auto-Fix Attempts` counter
  (owned by `renovate-dispatch`: incremented on each real dispatch, reset when
  the vuln clears) drives a distinct chip, filter, and summary tally so the
  operator can tell "Renovate's on it" from "Renovate couldn't fix this — it
  needs me". Inert until the Airtable Websites `Security Auto-Fix Attempts`
  Number field is added.

## 0.57.0

### Minor Changes

- b0871a1: `renovate-dispatch` now re-triggers a repo whose open Renovate PR is stuck (conflicting), instead of skipping it.

  The dedup guard previously skipped any repo with an open Renovate PR — which also skipped a PR that had gone **conflicting** (its branch fell behind the base after another PR merged the same lockfile), so a stalled security PR would wait for the weekly Renovate run to self-heal. Now the guard skips only a **healthy** (non-conflicting) open Renovate PR; a conflicting/stuck one is re-dispatched, which triggers Renovate to rebase it. `UNKNOWN` mergeability (GitHub still computing) is treated as healthy so we don't churn on uncertainty.

  Adds `mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"` to `PullRequestSummary` (populated from the `openPullRequests` GraphQL query) and a `hasHealthyRenovatePr(prs)` helper that reuses the existing `isRenovatePR` classifier.

- 6a5674e: CC `info@reddoorla.com` on every outgoing report.

  All report emails (Maintenance / Testing / Announcement / Launch) now carry the ops inbox on CC in addition to any per-site "Report recipients (CC)", so there's always an internal copy on file alongside the client recipients. The address is added only when it isn't already a CC or To recipient (case-insensitive), so a report is never double-addressed. `info@reddoorla.com` was already the reply-to; it's now also CC'd.

## 0.56.0

### Minor Changes

- d886ab1: Trigger Renovate on sites the nightly security sweep flags with vulnerabilities, instead of waiting for the weekly schedule.

  New `reddoor-maint renovate-dispatch --fleet` command: reads the Websites table, selects the active, repo-backed sites whose latest security audit found a **critical or high** vulnerability, and fires each one's `renovate.yml` `workflow_dispatch`. Renovate's OSV vulnerability alerts bypass its weekly schedule, so the remediation PR opens immediately and auto-merges per the shared preset — closing the detect→remediate gap from up to a week down to hours.

  A repo that already has an open Renovate PR is skipped (remediation is in flight), so a persistent vuln doesn't re-fire a dispatch every night while its fix PR waits. (A vuln with no available fix produces no PR, so it would still re-dispatch nightly — an idempotent Renovate no-op.)

  Wired as a best-effort follow-up step on `fleet-security.yml` (runs after the sweep writes fresh counts to Airtable). It reuses the existing `RENOVATE_TOKEN`, never fails the security job: a missing token clean-skips, and a per-repo dispatch failure (a repo without `renovate.yml`, or a token lacking `actions:write`) is surfaced as a warning. Moderate/low vulns are left to the normal weekly cadence.

  Adds `GitHub.dispatchWorkflow(repo, workflow, ref)`.

- 09ce7ec: Stop fleet sites from inheriting the server/report/audit dependency chain (and its transitive CVEs).

  The package shipped `mjml`, `resend`, `airtable`, `@google-analytics/data`, `google-auth-library`, the libSQL/Kysely stack, `sharp`, `svix`, and `@lhci/cli` as `dependencies`, so every consuming site installed them transitively — even though sites only import `./forms` + `./configs/*` and run `reddoor-maint audit --only a11y` in CI. That dragged in transitive vulnerabilities (`html-minifier` via `mjml`, `tmp` via `@lhci/cli`, …) fleet-wide.

  Those 11 packages are now `devDependencies` (this repo's CLI, Netlify functions, and audit pipeline still use them). To keep the CLI working for consumers without them:
  - The CLI (`bin.ts`) now lazy-loads each command (`await import("./commands/…")` inside the action) instead of eagerly importing every command at startup.
  - `tsup` builds with `splitting: true` and externalizes all node_modules deps, so each command becomes an on-demand chunk and `bin.js`'s startup graph stays free of the heavy chain.
  - A `smoke-dist` gate asserts every consumer-facing entry (`bin.js`, `./forms`, `./configs/*`) has a static import closure free of the central-only deps.

  Verified by a tarball-install simulation: a fresh consumer no longer has `mjml`/`airtable`/`@lhci/cli`/`html-minifier`/etc. in `node_modules`, while `./forms`, `./configs/*`, and the CLI still load and run.

  Note on the bare `.` entry: its report/audit/dashboard library exports now require the central-only packages, which a plain `pnpm add` no longer installs — so importing functions from the bare `@reddoorla/maintenance` specifier works only where the dev dependencies are present (this repo's CLI/Netlify functions, or tooling that installs them). Fleet sites never use that entry (CLI + `./forms` + `./configs/*` only), which is why this stays a minor; it is documented in the README "Library usage" note and enforced clean for the consumer-facing entries by the `smoke-dist` gate.

## 0.55.0

### Minor Changes

- 51d6da9: Fleet-wide GA/Search analytics-failure alerting + a role-account cutover runbook — closes the GA single-subject SPOF open loop (one impersonated `GA_SUBJECT` backs every site's analytics; if it loses access, all reports silently draft with blank analytics).
  - **Dedicated alert email** from `report --due`: when GA/Search enrichment soft-fails across a _majority_ of analytics-configured sites in a run (the signature of the shared subject losing access), the operator gets one alert email (`assessAnalyticsAlert` + `composeAnalyticsAlertEmail`; best-effort, daily-idempotent). A lone/minority failure stays a per-site issue and does not alert.
  - **Persisted per-site signal** on the cockpit + digest: drafting records a per-site `analyticsSoftFailAt` timestamp on the Websites row (set on a soft-fail, cleared on a clean enrichment), and a new `collectAnalyticsFailures` collector surfaces a `kind:"analytics"` Needs-attention item per failing site (self-healing, 45-day staleness). A fleet-wide outage surfaces it across many sites at once.
  - **Runbook**: `docs/runbooks/ga-search-role-account-cutover.md` — the ordered, grant-before-flip procedure to move the impersonated subject to the `reports@reddoorla.com` role account.

  ⚠️ The persisted signal is gated on a manual Airtable step: add an **`Analytics soft-fail at`** date field to the Websites table. Until it exists, the write is swallowed (drafting is unaffected) and the collector emits nothing — the dedicated email works regardless.

## 0.54.4

### Patch Changes

- a2164b0: Morning-brief LOW sweep (2026-06-23): a batch of small correctness, hardening, and test-fidelity fixes.
  - **Unknown `?site=` slug on `/submissions` now 404s** instead of silently returning the whole fleet (LOW-2).
  - **`/submissions` page-beyond-last** shows a clear "no submissions on page N" notice + a link to the last real page, instead of an empty list under a "120 submissions" header with an impossible "Page 5 of 3" pager (LOW-3).
  - **Dashboard handlers authenticate before the Airtable/Turso env guards**, so an unauthenticated probe gets a 401 rather than a differentiated 500 that discloses which backend env is unset (LOW-4; fleet-homepage / site-dashboard / submissions-page).
  - **`data-approve-url` is now HTML-escaped** on both the cockpit approve strip and the per-site approve button, matching the already-escaped `data-report-id` (LOW-5).
  - **Invalid `formType` is rejected** at the ingest normalizer instead of silently coercing to `contact` (which dropped the newsletter Mailchimp fan-out for a typo'd type); an absent/blank `formType` still defaults to `contact` (LOW-6) — matching `createIngestEndpoint`'s behavior.
  - **Newsletter webhook egress is restricted to PUBLIC https URLs** via a new `isPublicHttpsUrl` guard that blocks loopback/private/link-local/CGNAT hosts (SSRF defense-in-depth; LOW-7).
  - **Dynamic `.js/.mjs/.cjs` fleet inventories now scheme-allowlist `deployedUrl`** like the JSON/Airtable providers, so a module returning `file://` can't reach Chrome/lhci (LOW-8).
  - **`verifyFormsToken` hashes both inputs to a fixed-length digest before the constant-time compare**, removing the length-based early return (LOW-10).
  - Dropped an orphaned/misplaced JSDoc block on `parseExtraFields` (LOW-12).
  - Added tests for the `runMigrations` lost-marker re-run path (LOW-13) and for the `/submissions` date filter built from the UI's `YYYY-MM-DD` inputs (LOW-14).

## 0.54.3

### Patch Changes

- a37dc9e: More 2026-06-23 morning-review hardening:
  - **fix(db):** `listNewSubmissions` now caps at 200 (matching `listSubmissionsForSite`). The cockpit loads this whole array on every render — unbounded, it deserialized every unread submission fleet-wide.
  - **fix(db):** the `/submissions` text search now escapes LIKE metacharacters (`%`, `_`, `\`) with an `ESCAPE` clause, so a user's literal `john_doe` no longer also matches `johnXdoe` and a bare `%` no longer matches everything. (Already parameterized — this is a correctness fix, not an injection fix.)
  - **fix(audits):** the `browser` audit's plain `fetch()`es (route-discovery GET + link HEAD/GET) now use `AbortSignal.timeout(10s)`, so a host that hangs without erroring can't stall the sequential fleet audit indefinitely. An abort degrades to the existing null/network-error path.
  - **chore:** `release-health.yml` gains `timeout-minutes: 5` (a hung `npm view` would otherwise sit at GitHub's 6-hour default and, with `cancel-in-progress: false`, pin every later daily run). Added a `pretest` build step so local `pnpm test` runs the CLI tests against fresh `dist` rather than a stale build.

## 0.54.2

### Patch Changes

- 980ced9: Harden four issues from the 2026-06-23 morning review:
  - **fix(forms):** the timing-gate spam screen could be bypassed by a forged FUTURE timestamp. `elapsedMs` went negative, which the `>= 0` guard let skip the too-fast branch. `screenSubmission` now treats any numeric elapsed below `MIN_FILL_MS` (negatives included) as too-fast, and `elapsedMs` clamps at 0 (defense-in-depth).
  - **fix(audits):** the domain audit now writes `Cert days remaining` unconditionally, so a DNS/cert failure CLEARS a stale value. Previously a stale non-null number survived next to a freshly-stamped "Domain checked at", false-passing the Domain/DNS/SSL auto-tick for a site that was actually down.
  - **perf(db):** `openDb` migrations now run once per process per persistent database URL (a module-level cache), instead of two Turso round-trips on every warm Netlify invocation. `:memory:` is excluded (each is a fresh database), and a failed first run evicts the cache so the next call retries.
  - **fix(github):** `secretExists` and `findOpenSelfUpdatingPR` now request `per_page=100` instead of the REST default of 30 — preventing a false secret-miss (needless overwrite) and a duplicate self-updating PR on repos with many secrets/open PRs.

- 384206d: fix(report): a superseded draft no longer permanently blocks future Maintenance reports

  The pile-up guard skipped a new-period draft whenever an earlier-period draft for the same (site, type) was still unsent — but a draft that a higher tier _superseded_ (`draftReady=false`, never sent) also matched that condition, wedging every future Maintenance draft for the site forever (Reddoor's live failure: Maintenance + Testing both monthly). The guard now additionally requires `draftReady`, so only a genuinely pending-approval draft blocks.

## 0.54.1

### Patch Changes

- 768344b: Retire the Airtable-backed submission and spam-screen-out code paths now that the dashboard runs on libSQL. Removes the dual-write soak shadow, the one-off backfill/reconcile scaffolding (kept `reddoor-maint db migrate`), and the Airtable `Submissions`/`Spam Screenouts` modules. The row shape + enum validators live in `src/reports/submission-row.ts`.

## 0.54.0

### Minor Changes

- c909f96: Add a fleet-wide `/submissions` page (filter by site/type/status/date + text search, paginated 50/page, with per-row triage) and reorder the cockpit + per-site dashboards so attention content leads and the spam + submissions blocks sink to the bottom. The cockpit submissions strip and each site's submissions section now link into the new page.

## 0.53.0

### Minor Changes

- c3f8ca4: Cut the dashboard handlers over to the libSQL store: form ingest writes submissions and
  exact spam screen-out counters to libSQL (with an optional `DUAL_WRITE_AIRTABLE=1` soak
  that also shadow-writes to Airtable for rollback insurance), submission triage reads/writes
  libSQL, and the per-site page + cockpit read submissions and spam totals from libSQL.
  Requires `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` in the dashboard site env.

## 0.52.0

### Minor Changes

- 4c271e3: Add a libSQL-backed store for the two high-volume data sets — form submissions and
  spam screen-out counters — behind the existing dependency-injection seam, plus a
  `reddoor-maint db migrate|backfill|reconcile` CLI. Screen-out counters are now exact
  (atomic upsert) instead of approximate daily buckets, and per-site submission reads are
  indexed server-side. Airtable remains the human back office for Websites, Reports, and
  Digest State. Handlers are not yet switched — that lands in the cutover.

## 0.51.0

### Minor Changes

- dd0ff74: The per-site dashboard now shows **which** vulnerabilities a site has, not just the totals. The
  security audit already extracted a per-advisory list (module, severity, title, CVEs, link) but
  only the C/H/M/L counts were persisted — the detail was discarded. The audit write-back now also
  persists that list to a new Websites `Security advisories` field (severity-sorted, capped at 25;
  an empty array on a clean run clears a stale list), `WebsiteRow` parses it back defensively
  (malformed entries dropped; absent/unparseable → null = never audited), and the site page renders
  a "Vulnerabilities (N)" section grouped by severity with a link to each advisory. All
  Airtable-sourced text is HTML-escaped and advisory URLs run through `safeUrl`. The section is
  omitted entirely when a site was never audited or is clean.
- 0474c6e: Spam catch-rate is now observable. The honeypot/timing screen runs on each fleet site and silently
  drops bots before they reach the dashboard, so the catch count was invisible. The site form helpers
  now fire a best-effort, no-PII screen-out beacon (`{ screenOut: honeypot|too-fast }`) to the existing
  ingest endpoint when they reject a submission; the ingest routes it to a compact per-site/per-day
  `Spam Screenouts` bucket. Marking a submission "spam" increments the same bucket's `Marked spam`
  counter. The per-site page gains a "Spam screen (30d)" panel (caught honeypot/too-fast, delivered,
  marked spam) and the cockpit gains a one-line fleet roll-up (caught + through) — so you can tell a
  weaker screen (rising _through_) from more exposure (rising _caught_, steady _through_). Counts are
  approximate under high concurrency (the read side sums duplicate same-day buckets); the beacon never
  throws and is abort-bounded (~1.5s), so the real-human clean path is never delayed and a hung beacon
  on a screened submit waits at most the timeout.

### Patch Changes

- dd0ff74: Throttle all Airtable HTTP at its single funnel so paging bursts stop tripping the per-base
  ~5 req/s limit. Even fully sequential `eachPage` paging fires fast enough that one cockpit load
  scanning Reports + Submissions could exceed the cap and exhaust the SDK's 429-retry budget. The
  shared `openBase` now wraps `base._base.runAction` — the one method every list/create/update/destroy
  call funnels through — with a min-interval throttle (~220ms ⇒ ≤ ~4.5 req/s) that spaces request
  _starts_ while preserving order. The SDK's built-in 429 retry stays as a backstop. The throttle
  chain is fail-safe: a throw or rejection in one step can never stall the queue (which would
  silently hang every subsequent Airtable call in the process).
- dd0ff74: Cap the cockpit's "New submissions" strip at the 10 newest rows so it can't grow into a
  fleet-wide wall as submissions accumulate. The heading still shows the true total and a
  `+N more — triage on each site page` line links onward; per-site NEW-submission counts and
  badges are unaffected (the cap is at render only, not the fetch). The per-site form-submissions
  section (already capped at 25) now says `showing 25 of N` when it lists a slice, so the heading
  no longer implies every submission is on the page.
- 0474c6e: The per-site dashboard now lets you inspect a submission, not just triage it. Each submission is an
  expandable row revealing all stored fields — phone, full message, source URL, UTM, the per-site extra
  fields, notify status, Resend message ID, and submission number — all HTML-escaped, with the source
  URL run through `safeUrl`.

## 0.50.0

### Minor Changes

- 73be4c6: Checklist auto-tick gains three Testing signals from one new audit: **Desktop Browsers**,
  **Mobile Browsers**, and **Links & Navigation**. A new checkout-free `browser` audit drives
  Playwright against the deployed URL — chromium/firefox/webkit for desktop, mobile-emulated
  chromium/webkit, and an internal-link check — over a **representative route sample** discovered
  from the sitemap and **bucketed by path family** so CMS-generated templates (Prismic
  `[uid]`/`[slug]` pages) are always covered, not just static top-level pages. It joins the nightly
  sweep (`--only lighthouse,domain,browser`, all checkout-free; the runner now `playwright
install`s firefox/webkit) and persists `Crossbrowser OK` / `Mobile OK` / `Links OK` / `Broken
links` / `Browser checked at` to the Websites row. The three boxes auto-tick at draft time when
  fresh and green; stale → unknown, a failing verdict → fail (amber, with the broken-link count for
  Links), never-run → manual. Fail-safe throughout: empty/flaky observations never count as a pass.
  Honest scope: cross-engine render without JS errors + no mobile overflow + internal links resolve
  — not pixel-perfect visual correctness or real-device touch.
- a6b8c17: Checklist auto-tick gains its second signal: **Domain, DNS & SSL**. A new checkout-free `domain`
  audit probes each site's deployed URL (DNS resolve + TLS cert expiry via Node `dns`/`tls`, no
  repo clone) and persists `Cert days remaining` + `Domain checked at` to the Websites row; it
  joins the nightly `fleet-lighthouse` sweep (`--only lighthouse,domain` — both run against the
  deployed URL, so no extra clone). The `Maint: Domain, DNS & SSL` box then auto-ticks at draft
  time when the check is fresh, the domain is custom (not `*.netlify.app`), it resolves, and the
  cert has >14 days left. Fail-safe as always: stale → unknown, near-expiry / unresolved → fail
  (amber with the reason), no custom domain or never-probed → left manual. Honest scope: resolve +
  valid cert only — not registrar expiry, www↔apex redirect, or MX.
- 96d1559: Report checklist items can now auto-tick from verified signals. Phase 1 ships the engine
  (`autoTickChecklist`, a `Checklist auto-evidence` snapshot on the report row, and green/amber
  evidence badges on the dashboard beside each checkbox) and wires the first signal: **Google
  Indexed** auto-ticks when Search Console shows the brand query on page 1 at draft time.
  Fail-safe — a box auto-ticks only on fresh positive proof; a missing, soft-failed, or
  not-on-page-1 signal leaves the box manual (amber, with the reason). The per-report human
  approve gate and the operator's one-click override are unchanged.

  Operator setup: add a **`Checklist auto-evidence`** (Long text) field to the Reports table
  before the next draft run — drafts write the evidence snapshot there.

- baf2994: Checklist auto-tick gains the **Security Updates** signal (the last of the six automatable
  checks). The security audit now stamps a `Last security audit at` freshness timestamp alongside
  its vuln counts, and a new nightly **`fleet-security`** workflow runs `pnpm/npm audit` across the
  fleet (checkout-ful — it reads each repo's committed lockfile; kept a separate job so the
  lighthouse/domain/browser sweep stays checkout-free). The `Maint: Security Updates` box
  auto-ticks when fresh with **0 critical and 0 high** advisories; any critical/high → fail (amber,
  with the count), stale → unknown, never-run → manual. Honest scope: "no known critical/high
  advisories in the declared dependencies as of the last audit" (moderate/low advisory-only; does
  not prove the fix is deployed).

  Also relaxes `writeAuditsToAirtable`: a Lighthouse result is no longer _required_ — a standalone
  `--only security` (or any non-lighthouse) sweep now persists its audits instead of erroring. The
  Lighthouse-miss flag still fires when Lighthouse was actually run but produced no scores.

### Patch Changes

- b16088d: Report emails now attach only the inline images they actually render. The blurred-tests image
  (`cid:rd-blurred-tests-jpg`) is referenced solely by the Maintenance template, yet `sendOne`
  previously attached it — plus the green check — to every report type, leaving a dangling inline
  part that some mail clients surface as a stray downloadable attachment on Testing, Announcement,
  and Launch emails. The send path now gates each bundled image on its `cid` appearing in the
  rendered HTML: the header attaches always, the check on every type except Launch, and the
  blurred-tests image only on Maintenance. Self-correcting if a template's image usage changes.

## 0.49.1

### Patch Changes

- c18d960: The Maintenance report's "Last Tested" date now reflects the real last automated test. It reads
  the live `Last lighthouse audit at` timestamp on the Websites row — stamped every time
  `audit lighthouse --write-airtable` refreshes the scores — instead of the hand-set `testing day`
  scheduling anchor (which went stale and could show a date months out of date). `testing day` is
  unchanged; it remains the recurrence anchor used by the due-report scheduler. A site that has
  never been audited leaves the line blank, exactly as before.

## 0.49.0

### Minor Changes

- 0471dec: Only one report is queued for approval per site at a time, highest tier wins. Report tiers form
  a superset chain — Maintenance ⊂ Testing ⊂ {Announcement, Launch} — so a higher-tier draft makes
  lower ones redundant. A new shared `queueDraft` (src/reports/queue.ts), called by every draft
  path (`draftReportForSite`, `announce`, `launch`):
  - Supersedes lower-tier reports already pending approval for the site by **un-queuing** them
    (clears `Draft ready` — the row is kept, not deleted), then queues the new one.
  - Stands down (leaves the new draft un-queued) when an **equal-or-higher** tier is already
    pending — e.g. a queued Testing blocks a new Maintenance draft, and a queued Launch blocks a
    new Announcement (the existing one is kept rather than silently replaced).

  The `report` CLI surfaces the outcome ("drafted but NOT queued…" / "superseded N lower-tier
  drafts"); `draftReportForSite` returns `queued` + `supersededIds`, and `announce` results carry
  `queued`.

  The nightly `--due` run now distinguishes a draft `queueDraft` intentionally un-queued from one
  wedged half-made by a crash: if a higher-or-equal-tier report is still pending for the site, the
  not-ready row is skipped instead of re-completed — otherwise it would re-render and append a
  duplicate HTML attachment every run only to be re-blocked.

## 0.48.0

### Minor Changes

- 8ec20e1: The announcement email is rebuilt from the monthly report's own components so it reads as a
  testing report with extra explanation, not a lighter one-off. A new shared `email-sections`
  module (`checklistRowsSection`, `lighthouseScoresSection`, `analyticsSection`) is used by BOTH
  the report and the announcement, so they can't drift in design:
  - The announcement now renders MAINTENANCE CHECKS (first) then TESTING as real checklist rows,
    the full LIGHTHOUSE SCORES block, and the big ANALYTICS number + Google-position line.
  - Each pace's cadence is baked into its section's intro copy ("…We do this every month.") —
    the separate WHAT TO EXPECT block is gone.
  - The open-door invitation is reworded ("…just let us know.") and folded into the end of
    RECENT IMPROVEMENTS (no duplicate "reply" CTA right before the contact block).
  - Every alternating-background band carries equal top/bottom padding.

  Also: **Lighthouse "Ideal" bands now all top out at 100** (Best Practices was 80–92 → 80–100),
  in both the report and the announcement, since they share the component. Dead announcement copy
  keys removed (`announceScoreNote`, `announcePreviewLabel`, `announceCadenceHeading`,
  `announceTestingLabel`, `announceMaintenanceLabel`).

## 0.47.0

### Minor Changes

- 27f064d: The announcement email now shows the testing/maintenance checks as a **checkmark
  list** (a green ✓ per item under each pace, mirroring the report's checklist) and
  gains a **TRAFFIC & SEARCH** section — visitors for the last ~30 days with an
  up/down trend vs the prior window, plus the page-1 Google position — fetched live
  by the `announce` recipe via the report pipeline's soft-failing GA + Search Console
  enrichment (`fetchGaUsers` / `fetchSearch`, now exported) and stored on the Reports
  row (`ReportEnrichment`; `updateReportScores` extended for the reuse path).

  Also fixes a latent send-path gap: `sendOne` re-rendered a sent Announcement WITHOUT
  its cadence/improvements (they aren't stored on the row), silently dropping the whole
  "WHAT TO EXPECT" section from the delivered email. A new `announcementSiteExtras(site)`
  helper re-derives them from the Websites row and is shared by both the draft preview
  and the send re-render, so the sent email matches what the operator reviewed.

- 636cfd3: Announcement + report email polish:
  - The score-preview accessibility label is now **"Readability (A11y)"** (was
    "Readability") in both the announcement and the monthly report, so the parenthetical
    makes the meaning explicit.
  - The announcement's WHAT TO EXPECT checks now use the report's own green check image
    (`cid:rd-check-png`, attached inline at send) placed **after** each label, so the
    announcement's checks match the monthly report exactly (replacing the inline `✓` glyph;
    `alt="✓"` is the fallback shown in the attachment-less review preview).
  - New optional `announceScoreNote` copy field renders a thin-italic gloss under the
    Lighthouse scores ("These are independent Google Lighthouse scores, each out of 100 —
    higher is better."); a blank value omits it.
  - The Testing checklist item "Verified After Updates" is relabeled **"Tested After
    Updates"** (display-only — the Airtable checkbox column key is unchanged, so no
    live-base migration).

- b09bf20: Search Console brand matching is now robust to phrasing. The report/announcement
  "brand search position" no longer depends on the operator typing the exact query
  string: the `Search query` is treated as a case-insensitive **substring hint**
  (`contains` instead of `equals`). Among the matching user queries we report the
  position of the **exact-match query when present** (a precisely-configured brand query
  is honored verbatim — no longer-tail variant can hijack the number), otherwise the
  **most-searched** matching query (highest impressions, tie-break best position). New
  exported `pickBrandQuery` (most-searched) and `selectBrandPosition` (exact-first then
  fallback). So "red door creative" is honored exactly, "red door" still resolves to the
  brand's top query, and a near-miss like "reddoor creative la" no longer silently returns
  nothing. Backward-compatible — an exact string contains itself, so every currently-working
  site keeps its result.

## 0.46.0

### Minor Changes

- 19f4bd9: The announcement email's "WHAT TO EXPECT" section now spells out what each pace
  covers: under "Full site testing" and "Routine maintenance" it lists that pass's
  specific checks inline (middot-separated), pulled from the **same**
  `testingChecklist` / `maintenanceChecks` copy arrays the monthly report renders —
  so the announcement and the report can never drift. The now-redundant standalone
  "WHAT WE MONITOR" block is removed (its items are covered by the expanded section
  plus the score preview), and the unused `announceMonitorItems` copy key is dropped.

## 0.45.0

### Minor Changes

- 3d2f0df: `report <slug>` gains a `--type <Maintenance|Testing>` flag so the operator can
  draft a Testing report (not just the default Maintenance) for a single site on
  demand. Type parsing is case-insensitive and validated before any Airtable access,
  so a bad value fails fast without credentials; Launch and Announcement are
  rejected with a pointer to their own commands (`launch` / `announce`). Works with
  `--preview` too.
- bdc2813: A **Testing** report now gates on all 13 checklist items (the 6 maintenance items
  plus the 7 testing items), not just the 7 testing ones. A testing pass also
  performs the maintenance checks — and the Testing email already shows both lists —
  so `checklistFor("Testing")` returns maintenance-then-testing, the dashboard
  renders all 13 checkboxes, and approve/send stay blocked until every one is
  checked. Maintenance reports are unchanged (still gate on their 6 items);
  Launch/Announcement remain ungated.

## 0.44.0

### Minor Changes

- 698b097: Revise the maintenance and testing checklists (the operator gate + client-email
  lines, kept in sync). Maintenance stays 6 items but is sharpened: `Reviewed Logs`
  → "Deploy & Function Health", `DNS Checked` → "Domain, DNS & SSL" (absorbs SSL),
  `Reviewed Certificate` is cut (Netlify auto-renews — it overlapped), and a new
  "Uptime Checked" is added. Testing grows 6 → 7: `Package Updates` → "Verified
  After Updates", `Animation Functionality` → "Interactions & Animations",
  `Bottlenecks` is cut (overlapped automated Lighthouse Performance), and two items
  are added — "Page Titles & Meta" (catches the recurring empty-title regression)
  and "Links & Navigation". `ALL_CHECKLIST_FIELDS` is now 13; "Google Indexed"
  stays at maintenance index 3 so the email keeps injecting the live search
  position. The two cut Airtable columns are retired (renamed, no longer read) and
  can be deleted in the UI.

## 0.43.0

### Minor Changes

- 1908fba: Reframe the announcement email (shipped in 0.42.0) from "your new monthly report"
  to an ongoing site-care message. It now states each client's **testing and
  maintenance cadence**, read from the Websites row (`testing freq` /
  `maintenence freq`) and rendered as a "WHAT TO EXPECT" section (e.g. "Full site
  testing — every quarter"); a `None` pace is omitted so no cadence is over-claimed.
  The score preview is framed as the latest full site test. Adds `ReportCadence` /
  `ReportFrequency` types and `ReportData.cadence`; the `announce` recipe passes
  each site's frequencies and uses a "Your testing & maintenance schedule for
  <site>" subject.
- 6a08456: Maintenance/Testing reports now gate on a per-item operator checklist: 12 checkbox fields on the Reports row, flippable in Airtable AND as interactive checkboxes on the dashboard per-site page; the Approve button is disabled and the approve action + send path both refuse until every item for the report's type is checked. The client email is unchanged. Launch/Announcement reports are not gated.
- bbfedd9: Cockpit + per-site dashboard visibility: labels on Lighthouse scores, a setup (N/4) tooltip listing missing onboarding items + a setup section on the per-site page, GA/Search report-source data + a site-details section on the per-site page, and a Home link on the per-site page.

## 0.42.0

### Minor Changes

- 0eb0722: Cockpit now flags a live (`maintenance`) site that is still served from its
  default `*.netlify.app` host — i.e. it never got a custom domain. The site drops
  to the 🟡 Watch tier with an "on `*.netlify.app` (no custom domain)" reason and a
  new `no-domain` filter chip, surfacing a launch-completeness gap that was
  otherwise invisible. A `launch period` site on `*.netlify.app` is left alone (no
  domain yet is expected pre-launch). Adds a small `isNetlifyAppUrl(url)` URL
  predicate (sibling of `isHttpUrl`) that matches the apex and any subdomain of
  `netlify.app` without being fooled by look-alike hosts.
- d8b06f9: Add a one-time **monthly-report announcement** email, as a new `Announcement`
  report type riding the existing draft → approve → send pipeline. A new `announce`
  recipe + CLI (`reddoor announce` for all `maintenance` sites, or
  `reddoor announce <site>` for one) drafts a personalized email per client
  introducing the recurring monthly report: a live preview of the site's latest
  Lighthouse scores (using the same client-facing labels as the real report),
  recent-improvement callouts (forms now delivered via Resend; the Svelte 4 → 5
  modernization — default-on fleet-wide, with the per-client approve review as the
  relevance backstop), and a soft open door to expand scope. Pure-value framing, no
  pricing. `createDraft` gains an optional `subjectOverride`. The send path is
  reused unchanged — an Announcement renders by type and does not flip Status.

  Operational prereq: add an `Announcement` option to the Airtable `Report type`
  single-select before running (the API can't add select options).

### Patch Changes

- 7fa8e7a: Per-site submissions are now fetched with a server-side `{Site}` filter, a
  newest-first sort, and a bounded `maxRecords`, instead of paging the entire
  `Submissions` table on every site-dashboard load and filtering in JS. This
  removes the one unbounded full-table scan in the request path as the fleet's
  submission volume grows. Internal only — no public API change.
- 802e8a9: Lower the form timing-gate threshold (`MIN_FILL_MS`) from 2000ms to 800ms. A
  too-fast fill is dropped silently (the visitor still sees success), so the old
  2s bar risked silently losing a real lead from a quick-but-genuine human
  (autofill, a short form, a returning visitor). At 800ms a submit is effectively
  instant — which a script does and a human realistically never beats — so the
  gate still blocks instant bots while erring toward letting borderline-fast
  humans through. The honeypot remains the primary bot signal; this only affects
  the server form-action path (`createIngestAction`), as the modal/JSON path
  already screens honeypot-only.

## 0.41.0

### Minor Changes

- c79e8d5: Field-based notification routing for form submissions. A site can now set a
  `Notify Routing` JSON column on its Airtable Websites row
  (`{field, routes, default?, cc?}`) to address the submission notification by the
  value of a submission field (e.g. route a contact form's `interest` to a
  different recipient per option), with support for multiple recipients and CC.
  Recipients resolve server-side from Airtable only — the submitting site never
  supplies an address. The config is parsed defensively (bad/blank JSON → the
  site keeps its existing single-POC behavior) and is inert until set, so the
  change is a no-op for every current site. The verify guard is preserved:
  pre-launch sites still route to the operator with no routing or CC.

## 0.40.0

### Minor Changes

- bea8d7b: Newsletter submissions can now be added directly to a per-site Mailchimp audience
  (no Zapier hop) when the site's new `Mailchimp API Key` + `Mailchimp Audience ID`
  Airtable columns are set. The dashboard ingest upserts the subscriber
  (`PUT /lists/{id}/members/{hash}`, idempotent, `status_if_new: subscribed`)
  best-effort — never blocking or failing the submission. The generic
  `Newsletter Webhook` remains available for other integrations.

## 0.39.0

### Minor Changes

- f55a128: Submission notification emails now include the submission's `extraFields` — the
  site-specific context a recipient most needs (the artwork an inquiry is about,
  the event an rsvp is for, the company on a contact). Previously these were
  stored in Airtable but omitted from the email; now they render as labeled rows
  (HTML-escaped, empty values dropped, malformed JSON tolerated).

### Patch Changes

- 59da053: Add the reddoor mark as a favicon on the dashboard pages (fleet cockpit + per-site
  dashboard), inlined as a data-URI so the function-rendered HTML carries the brand
  with no static-asset request.

## 0.38.0

### Minor Changes

- 7a9eacd: Newsletter submissions now fan out to a per-site webhook (e.g. a Zapier Catch
  Hook) when the site's new Airtable `Newsletter Webhook` column is set. The
  dashboard ingest POSTs newsletter-formType submissions to that URL best-effort
  (https-only, never blocks or fails the submission). Sites without the column set
  are unaffected.

## 0.37.0

### Minor Changes

- 2624486: Add `createIngestEndpoint` — a JSON `POST`-handler factory for client-driven
  forms (modals/lightboxes/fetch), the sibling of `createIngestAction`. Screens
  the honeypot, validates `formType` against `SUBMISSION_FORM_TYPES`, forwards to
  the dashboard ingest, and returns `{ ok }`-shaped JSON.

## 0.36.1

### Patch Changes

- dabf724: Dashboard cockpit visibility is now derived from site `Status` (shown when `maintenance` or `launch period`) instead of the vestigial per-site `Dashboard Token` field. The `dashboardToken` field is removed from `WebsiteRow`; the Airtable `Dashboard Token` column can be deleted.

## 0.36.0

### Minor Changes

- d024497: Forms: `createIngestAction` gains an optional `redirectTo` (303-redirect on success/bot-screen, e.g. a dedicated `/thank-you` page). Submission notifications are now status-aware — sites not yet in `maintenance` (launch period, hosting, etc.) route leads to the operator (`OPERATOR_EMAIL` or `tucker@reddoorla.com`); sites in `maintenance` go to the client POC as before.

## 0.35.0

### Minor Changes

- 84a0126: Add `createIngestAction` to the `@reddoorla/maintenance/forms` subpath — a factory that builds a SvelteKit `default` form action (bot screen → forward to the dashboard ingest endpoint → SvelteKit-shaped results). Fleet sites now wire a contact form in ~12 lines by supplying only a per-form `buildPayload`. SvelteKit is added as an optional peer dependency (only this module imports it).

## 0.34.0

### Minor Changes

- 7f02928: Add the `@reddoorla/maintenance/forms` subpath: `submitToIngest` + `screenSubmission` (and `SubmissionPayload`/`FormType`) for fleet SvelteKit sites to forward contact-form submissions to the dashboard ingest endpoint.

## 0.33.0

### Minor Changes

- a568c1e: feat(cockpit): the fleet homepage is now a triage cockpit (M4 slice 1). Sites group into 🔴 Needs-attention / 🟡 Watch / 🟢 Healthy tiers (collapsible), with the approve queue pinned on top. Each card shows its live M5 signals — critical/high vulns, sub-75 Lighthouse categories, delivery bounces/complaints — badged NEW/WORSE to match the daily email digest (the Digest State snapshot is read read-only, never written from the page). A summary bar gives the tier counts + headline triage line and filter chips. Rendered entirely from already-persisted Airtable state (no request-path GitHub/Lighthouse calls) and rate-limited against brute-force. Renovate-failing / CI-red / staleness signals follow in slice 2.
- d77be27: feat(github-signals): nightly fleet sweep persists three GitHub-sourced signals per site to Airtable (M4 slice 2a) — count of Renovate update PRs failing CI, default-branch CI state, and last-commit-to-default-branch timestamp. New `github-signals --fleet --write-airtable` command (runs in the nightly cron with the fleet-read token), a `defaultBranchStatus` GitHub query, and `updateGitHubSignals` Airtable writer. The cockpit reads these (slice 2b) with no request-path GitHub calls.
- ddfdc6b: feat(cockpit): the cockpit now surfaces the GitHub-sourced signals (M4 slice 2b). Sites with Renovate update PRs failing CI or a red default-branch build join the 🔴 attention tier (chips + NEW/WORSE badges + new `prs`/`ci` filters), and the 🟡 Watch tier's staleness now uses the real last-commit-to-`main` timestamp (slice 2a) instead of the audit-age proxy. Pure collectors read the persisted Websites fields — still zero request-path GitHub calls. The summary bar gains "N PRs failing" / "N CI red" counts.
- 58ceba2: feat(alerts): the digest's "Needs attention" now flags Lighthouse categories below 75 (M5 slice 3). Each of a site's four deployed scores — Performance, Accessibility, Best Practices, SEO — that drops under the floor surfaces as its own NEW/WORSE-badged item linking the dashboard. The metric is encoded as the deficit (`100 - score`), so a category sliding further down badges WORSE, a first crossing below the floor badges NEW, and a recovery clears it from the snapshot (re-NEWing if it regresses again). Pure Airtable read — no new fetch, token, or workflow change.
- 911e412: feat(alerts): the daily digest now surfaces fleet problems (M5 slice 1). The "Needs attention" section — empty since M3 — lists every site currently carrying a critical/high security vuln and every report that bounced or complained, **grouped by site, severity-ordered (critical first), and badged NEW or WORSE** versus the prior run. The hybrid snapshot never silently drops a standing problem, while the badges land the eye on what changed. Prior state lives in a single "Digest State" Airtable record (one read + write per run); a resolved problem clears even on a no-noise skip day, so a recurrence correctly re-badges NEW. Two zero-infra signals ship here; Renovate-PRs-failing-CI and Lighthouse regression follow on the same framework.
- 290674e: feat(alerts): the digest's "Needs attention" now also flags Renovate dependency-update PRs that are failing CI across the fleet (M5 slice 2). The daily run sweeps each repo's open PRs (via the shipped `collectRenovateFailures` detector behind a fleet-read `RENOVATE_TOKEN`), surfacing each red Renovate PR as a NEW/WORSE-badged item linking the PR, plus a single roll-up note for any repos that couldn't be checked (gaps are never hidden). The sweep is isolated — a GitHub hiccup yields nothing for this signal and never blanks the vuln/delivery signals — and is skipped entirely when no token is present (local runs are unaffected).
- 83cbd6c: feat(copy): email copy is now data, not scattered literals (M6a). Every hardcoded string in the report template moves into one `DEFAULT_COPY` catalog (`src/reports/copy.ts`) — fleet-wide wording is a one-file edit. A site can override the three most client-facing narrative blocks — **intro · contact · footer** — via new Airtable fields (`Copy — Intro/Contact/Footer`), merged `override ?? default` like report recipients. A site with no overrides renders a visually-identical email (all copy — default and override alike — is now HTML-escaped for safety, so e.g. an apostrophe renders as its entity). Sets up the launch email (M6b) to reuse the same copy layer.
- adaefa4: feat(launch): first-class site launch (M6b — completes M1–M6). `launch <site>` bootstraps CI+Renovate, runs a first audit, and drafts a **purpose-built launch email** (a new `Launch` report type) into the dashboard approve queue. Approving it sends the go-live email and flips the site **Status → maintenance** with a **`Launched at`** stamp — no client email leaves without the one-click approval. The launch email reuses the M6a copy layer (per-site contact/footer overrides honored).

### Patch Changes

- 411fead: fix(digest): a same-day `report --digest` re-run whose content changed (e.g. a manual re-dispatch after new signals appeared) no longer fails. Resend returns a 409 when an idempotency key is reused within 24h with a different body; the digest now treats that as a graceful "already sent today" skip (exit 0, no duplicate email, no state write) rather than throwing — which previously reddened the daily run and opened a false tracking issue. A genuine send/network failure still exits 1 loudly.

## 0.32.0

### Minor Changes

- 6b0229d: feat(dashboard): one-click approve — the M3 loop closes. Each pending report on `/s/<slug>` (and a "Pending your yes" list at the top, plus a fleet-wide count banner on `/`) gets an Approve button that POSTs to the new basic-auth-gated `/api/reports/:id/approve` Netlify function. The click is a decoupled, audited flag-flip — `Approved to send = TRUE` + `Approved At`/`Approved By` stamped, never a send — and is idempotent (already-approved and already-sent rows are safe no-ops; nothing can un-approve). The next daily run's `--send-ready` step does the actual sending.
- 113145e: feat(reports): `report --due` is now idempotent — a re-run never double-drafts. Each due (site, type) is keyed by the UTC `YYYY-MM` of its due date (`reportPeriodKey`), stamped onto the new Reports `Period` field at draft time, and skipped when a row for that key already exists. Skips surface in the output and never trip a non-zero exit, so a cron re-fire is a safe no-op. The manual single-site `report <slug>` path intentionally still always drafts.

  Also fixes a pre-existing live-Airtable break this work surfaced: report queries filtered linked-record `{Site}` fields by record id inside `filterByFormula`, which Airtable renders as primary-field _names_ — so the filter matched nothing, `lastSent` was never found, and dueness was computed from fallbacks. Reports are now fetched unfiltered (one paged query instead of N) and matched by record id client-side, so `report --due` dueness is correct against the real base for the first time.

- a64cd04: feat(reports): `report --digest` — one daily "your fleet today" operator email. A "Ready for your yes" section lists every draft-ready, unapproved, unsent report with a link to its dashboard page; a typed "Needs attention" section ships as the M5 alerting seam (empty for now, renders "all clear"). Skips the send entirely when there is nothing to report (no-noise default), dedupes same-day re-fires via a `digest-<date>` Resend idempotency key, and sends to `OPERATOR_EMAIL` (fallback `info@reddoorla.com`). Dashboard origin from `DASHBOARD_BASE_URL` (fallback the live Netlify origin). Email-client-safe HTML (charset, table layout, https-only links).

## 0.31.0

### Minor Changes

- e6417c9: feat(configs): `createSvelteConfig` composes the starter's richness. It now always injects the fleet's canonical `$components/$utils/$stores/$assets` aliases (a site can override per key or add its own), and gains two opt-in options: `csp` (`true` for the baseline Prismic+Vimeo policy, or `{ directives }` to extend it per-directive) and `placeholder` (`true` tolerates 404s during prerender for an un-wired clone). CSP and prerender tolerance are opt-in so adopting the helper never silently changes a site's behavior; an explicit `kit.csp` remains an escape hatch.

### Patch Changes

- a236e87: fix(a11y): the audit's transient `.reddoor-a11y-spec-*` dir is now removed on every catchable exit (try/finally), and `.reddoor-a11y-spec-*/` is in the canonical gitignore — so a timeout-killed run never leaves untracked files in a fleet repo's tree.
- a236e87: fix(airtable): a Lighthouse miss no longer discards a site's a11y/deps/security results — those are written first, then the run still surfaces the Lighthouse failure (so the fleet gate keeps its signal without losing the other audits' data).
- a236e87: fix(lighthouse): deployed-URL audits get the same 5-minute spawn budget as the checkout path (was 3), so a slow site's three cold runs don't time out into a spurious "no scores".
- a236e87: fix(deps): the audit guards `JSON.parse` (a corrupt package.json now fails cleanly with a clear message) and skips non-semver specs (`*`, `latest`, `workspace:*`, `npm:`-aliases, git/URL) that previously parsed to NaN and produced bogus drift.
- a236e87: fix(airtable): `getWebsiteBySlug` narrows the fetch with a `filterByFormula` (replicating `siteSlug` on `{Name}`, capped at one record) instead of paging the whole table per request, and validates the slug to keep URL input out of the formula.

## 0.30.0

### Minor Changes

- 4a9fd77: feat(dashboard): retire the per-site token model — the operator password gates `/s/<slug>` and `/`. `verifyDashboardToken` is removed; `dashboardToken` is now a fleet-homepage visibility flag only.
- 4a9fd77: feat(deps): add a real outdated-install signal alongside the declared-range "Deps Drifted" number. The deps audit now also reports how many installs are behind the registry's latest (`pnpm outdated`, best-effort), written to a new `Deps Outdated` Airtable field and shown on the dashboard.

### Patch Changes

- 4a9fd77: fix(fleet): `cloneIfNeeded` derives a clone URL from `gitRepo` (`https://github.com/<owner/repo>.git`, strict-validated) when no `repoUrl` is set, unbreaking checkout-based `--fleet airtable` recipes. The JSON inventory provider now also carries `gitRepo`/`deployedUrl`.
- 4a9fd77: fix(fleet): the fleet write-back now emits a machine-readable `FLEET_WRITE_SUMMARY wrote=N failed=M total=T` line so the nightly workflow can gate on real outcomes (red on total/mass write-back failure, warn on a tolerated single flake) instead of a "wrote ≥ 1" heuristic.
- 4a9fd77: fix(audits): kill the whole process group on a spawn timeout (detached when a timeout is set + `process.kill(-pid)` with SIGTERM→SIGKILL escalation), so a timed-out audit no longer orphans vite/Chromium. Timeout-less streaming calls stay attached so Ctrl-C still works. Also caps captured stdout/stderr.
- 4a9fd77: fix(sync-configs): the canonical `netlify.toml` template now ships the baseline security headers, and a `[[headers]]`-aware carve-out stops `sync-configs` from stripping a site's own security config (a header-less file is backfilled; a hardened one is left alone).

## 0.29.0

### Minor Changes

- 953edf9: feat(a11y audit): hydration smoke-check on `/`

  The a11y audit now smoke-loads the homepage (`smokeRoutes`, default `/`) and fails
  on any uncaught client-side exception — catching the class of bug where build + SSR
  succeed but client hydration throws and blanks the page (e.g. a Svelte 4→5 `run()`
  referencing a `$state` declared after it → TDZ ReferenceError on hydrate, which axe
  over `/dev` fixtures never sees). No axe runs on smoke routes (real routes carry
  a11y debt we don't gate on), and HTTP/SSR errors don't fire `pageerror`, so a
  data-less CI homepage that renders empty-but-valid won't false-fail. Runs inside the
  existing `reddoor-maint audit --only a11y` step — no CI workflow change; propagates
  to the fleet on the next Renovate bump of `@reddoorla/maintenance`.

## 0.28.0

### Minor Changes

- 7c7c123: feat(M7.1): sync-configs `ci` + `renovate-config` templates become thin shims

  The `ci` workflow template is now a ~6-line caller of the org reusable workflow
  (`reddoorla/.github/.github/workflows/ci.yml@<sha> # v1.0.0`), and `renovate.json` is a
  3-line shim that `extends` the org preset (`github>reddoorla/.github:renovate-config`).
  The canonical CI gate and dependency policy now live once in `reddoorla/.github`;
  Renovate keeps the SHA current. `self-updating` requires the new `ci / ci` check context.

## 0.27.2

### Patch Changes

- b93590c: fix(audit/a11y): eliminate flaky color-contrast violation on animated routes

  The a11y audit sampled pages while CSS transitions were still running, so axe
  computed color-contrast against semi-transparent text mid-fade — producing a
  flaky "serious" color-contrast violation (~1/3 of runs on `/dev/animate-in`).
  The audit now disables transitions/animations before running axe, asserting the
  resting state users (and `prefers-reduced-motion` users) actually see. Verified
  8/8 clean over repeated runs that previously flaked ~1-in-3.

- 5420a09: fix(sync-configs): bump renovate workflow pin `renovatebot/github-action@v40` → `@v46.1.14`

  The `@v40` major tag no longer resolves (the action ships full-version tags only, now at v46.x), so the synced renovate workflow failed at action-resolution on every fleet repo. Pin to a current, resolvable version; Renovate self-maintains it going forward.

## 0.27.1

### Patch Changes

- e3f152d: `sync-configs` no longer clobbers a site's `svelte.config.js` customizations. The svelte template is now compliance-checked instead of exact-matched: a config already on the canonical pattern (imports `createSvelteConfig` **and** `@sveltejs/adapter-netlify`) is left untouched, so site-specific `kit.alias` and `compilerOptions` survive every sync. A missing or genuinely off-pattern config is still rewritten to the canonical template. Fixes the silent loss of custom path aliases (e.g. `$utils`/`$components`) on re-sync.

## 0.27.0

### Minor Changes

- 73c1aa7: Add a canonical `netlify.toml` to the `sync-configs` template set (new `netlify` config name). Standardizes the fleet's Netlify build: `command = "pnpm build"`, `publish = "build/"`, `functions = "functions/"`, `NODE_VERSION = "22"`, `COREPACK_INTEGRITY_KEYS = "0"`. Pins Node to latest 22.x — the older `22.12.0` pin is below `@eslint/js@10`'s `^22.13.0` engine and broke installs. Pairs with the adapter-netlify `svelte.config.js` template (#105) to make a synced site build on Netlify out of the box.

  Note: this template overwrites `netlify.toml` on sync. Sites with custom redirects/headers/plugins should keep those in `_redirects`/`_headers`/SvelteKit, or they'll be clobbered.

## 0.26.1

### Patch Changes

- e4c690d: `onboard` now ensures `@sveltejs/adapter-netlify` is declared, alongside `@reddoorla/maintenance` and the audit deps. The synced `svelte.config.js` template imports the adapter, so a freshly-onboarded site couldn't build without it — onboard previously left that gap to be patched by hand. Versions are sourced from `baseline-versions` (new `FRAMEWORK_DEPS`, same drift-guard as `AUDIT_DEPS`); sites that already declare the adapter are left untouched.

## 0.26.0

### Minor Changes

- c0bfc6d: The `sync-configs` `svelte.config.js` template now defaults to `@sveltejs/adapter-netlify` (`adapter({ edge: false, split: false })`) instead of `adapter-auto`. The whole Reddoor fleet deploys to Netlify, so the explicit adapter gives consistent `build/` output and avoids the adapter-auto resolution that left sites needing a manual override (caltex and erp both already use adapter-netlify). Sites must have `@sveltejs/adapter-netlify` installed.

## 0.25.0

### Minor Changes

- fb4532c: `self-updating` is now idempotent: it drives a repo to a known end-state (CI files on the default branch + auto-merge + branch protection requiring `ci` + the `RENOVATE_TOKEN` secret), checking remote state and acting only on what's missing. This fixes two gaps: `init`→`self-updating` no longer skips the GitHub wiring just because `sync-configs` already wrote the CI files, and a partial-failure run now self-heals on re-run instead of leaving a repo half-configured. New remote-read methods on the `GitHub` wrapper (`filesOnBranch`, `branchProtectionContexts`, `secretExists`, `autoMergeEnabled`, `findOpenSelfUpdatingPR`).

## 0.24.0

### Minor Changes

- 6954a9c: Add `.prettierignore` to the `sync-configs` canonical template set. The CI gate runs `prettier --check .`, which formats YAML — without a `.prettierignore`, `pnpm-lock.yaml` (and Renovate-updated lockfiles) fail the check. The new template excludes the lockfile and generated dirs (`.svelte-kit/`, `build/`, `.netlify/`, `dist/`) so the CI prettier step is green fleet-wide. New `ConfigName` `"prettier-ignore"`.

## 0.23.0

### Minor Changes

- 2206846: M1: self-updating repos. New `reddoor-maint self-updating [site]` recipe bootstraps a repo to keep itself current — writes a unified CI workflow (format+lint, typecheck, build, a11y via `audit --only a11y --fail-on-violations`; no lighthouse), a nightly self-hosted Renovate workflow, and `renovate.json` (patch/minor auto-merge on green, majors → PR); pushes, opens a PR, enables branch protection + auto-merge, and sets the `RENOVATE_TOKEN` secret. The three files join the `sync-configs` canonical set so the CI standard stays unified fleet-wide.
  - New `src/github/` (gh CLI wrappers + config); `GITHUB_TOKEN` + `RENOVATE_TOKEN` in credentials.env.
  - New Airtable Websites "Git repo" field → `WebsiteRow.gitRepo` → `Site.gitRepo` (falls back to the checkout's origin remote for local runs).
  - `audit --fail-on-violations` (a11y CI gate; exits non-zero on any a11y violation).

## 0.22.0

### Minor Changes

- 08cc2fe: Surface Google search presence in the report email, sourced from the Search Console Search Analytics API (reusing the GA service-account domain-wide delegation — added scope `webmasters.readonly`). The Custom Search JSON API path from the prior release is replaced (it is closed to new customers).
  - `src/reports/search/client.ts` — `fetchSearchPresence` queries the average position for a site's per-site query over the report period; `foundOnPage1 = avgPosition <= 10`, displayed rank is the rounded average. Resolves the Search Console property from the optional "Search Console property" Websites column, else auto-resolves (Domain or URL-prefix) from `sites.list`.
  - The report email's "Google Indexed" row becomes `Page 1 Google Result (#N)` when on page 1; otherwise unchanged. Positive-only — the negative is stored on the Reports row ("Search found page 1" / "Search position") for operator eyes, never shown to the client.
  - Soft-fail throughout: unconfigured / no query / API error leaves the draft unaffected.
  - Removes the obsolete `GOOGLE_SEARCH_API_KEY` / `GOOGLE_SEARCH_ENGINE_ID` env vars.

## 0.21.0

### Minor Changes

- a4e2528: Add a Google search-presence capability: given a per-site query and the site's domain, check whether the site appears on page 1 of Google's organic results.
  - `src/reports/search/client.ts` — `fetchSearchPresence({ apiKey, engineId, query, siteUrl })` → `{ foundOnPage1, position }` via the Custom Search JSON API (free 100/day; de-personalized national-ranking proxy). Hostname matching normalizes `www.`/scheme/path. Throws on non-OK responses so callers can soft-fail.
  - `src/reports/search/config.ts` — `readSearchConfig()` reads `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID`; null when unset → check skipped.
  - New Websites "Search query" column → `WebsiteRow.searchQuery`.

  This is the capability only. Surfacing it in the report email's "Google Indexed" line (and the draft-time fetch) lands as a follow-up, after the email's `escapeXml` helper merges. Operator setup (one-time): a Google Cloud API key with Custom Search enabled + a Programmable Search Engine ID in `credentials.env`.

## 0.20.0

### Minor Changes

- 70558e3: Report email polish — three client-facing improvements to the maintenance report:
  - **Analytics trend.** The ANALYTICS section now shows direction, rate, and raw change vs the previous period — `▲ 24% vs last period (549 → 679)` — instead of two bare numbers. Growth is green; a dip or flat is muted grey (a traffic dip isn't a failure). "New this period" when the prior period was a real 0. Pure presentation of data already fetched.
  - **GA "unavailable" vs "zero" are now distinct.** `ReportData.gaUsersCurrent/Previous` are optional; when GA is unconfigured / has no property ID / the fetch failed, the email renders "— Users" and "Last Period: —" rather than a misleading "0".
  - **Subject line carries the period.** `"{Site} — May 2026 Maintenance Report"` (UTC month/year from the report's completed-on date) for inbox scannability and archival. `Subject override` still wins.

  Also a correctness fix (was flagged in the 2026-05-29 review, never fixed, and widened by the recent header `alt`/`href` work): **site name, URL, and commentary are now XML-escaped before the strict MJML render.** Previously a client named with an `&` ("Brown & Co"), or a `<`/`"` in a URL or commentary, threw at render time and blocked the send. Added a regression test covering `&`, `<`, and `"`.

## 0.19.0

### Minor Changes

- 0da6913: Report drafts now auto-populate the analytics fields ("GA users (period)" / "GA users (prev period)") from the GA4 Data API, instead of requiring manual entry. At draft time, for any site with a "GA4 property ID" set, the CLI fetches `activeUsers` for the report period and the equal-length previous period and writes both into the Reports row (and into the rendered review HTML, so they agree).

  Auth uses the service account via domain-wide delegation (impersonating a Workspace user) proven out on 2026-06-01 — configured with `GA_SUBJECT` (the impersonated user) and the service-account key at `GA_SA_KEY_PATH` (defaults alongside `credentials.env`), scope `analytics.readonly`.

  Soft-fail by design: if GA isn't configured, the site has no property ID, or the API errors, drafting logs a one-line warning, leaves the fields blank for manual entry, and still creates the draft. GA is an enhancement, never a gate.

## 0.18.1

### Patch Changes

- 57c3b8c: Fix squished/distorted report header image. The reserve-space change in 0.18.0 set an explicit pixel `height` on the header `<mj-image>`, which MJML emits as `height:<px>` while keeping `width:100%` — so the height stayed locked while the width scaled, distorting the header at any rendered width other than the 600px design width (mobile, narrow reading panes). The header now stays `height:auto` (always proportional, never distorts) and reserves its vertical space via `aspect-ratio` in a head `<mj-style>` instead. Added a regression test asserting the header `<img>` uses `height:auto` and never a fixed pixel height.

## 0.18.0

### Minor Changes

- 7441bb8: Report header images are now downscaled, dimensioned, and given a loading placeholder before send. Per-site headers in Airtable are often multi-MB / 2400px+ (the ERP Industrials header was 3.55 MB / 2400×3200) while the email renders them at ~600px — so the email shipped ~16× more pixels than the display could use, loaded slowly, and reflowed when it finally painted (the `<mj-image>` had no height).

  The send path (`orchestrate.ts`) now runs each header through a new `prepareHeaderImage` (`src/reports/maintenance-email/header-image.ts`, backed by `sharp`): downscale to 2× the 600px display width for retina, re-encode JPEG q82 on a flat white background, never upscale. On the real ERP header this is a **93% byte reduction (3.39 MB → 239 KB)** with no visible quality loss — the cut is resolution the email can't display, not the quality compression that visibly degraded the paper texture and in-image text.

  It also returns the display dimensions and a dominant-color placeholder, which the template now applies to the header `<mj-image>` (`width`/`height` to reserve the box and stop reflow, `container-background-color` as the loading/blocked placeholder, `alt` for blocked-image clients). When dimensions are absent (e.g. the local preview path) the header falls back to today's bare image. Adds `sharp` as a dependency.

## 0.17.1

### Patch Changes

- a676921: `audit --write-airtable` now refuses to run when combined with `--fleet`, exiting with code 2 and a clear message before any audit work begins. Previously the combo silently overwrote one Airtable Websites row's dashboard tiles with results pooled across all fleet sites (cwd-derived slug + flat `AuditResult[]`) — dashboard-wrong, not crash-loud. Per-site writes are the supported path: `cd <site>/ && reddoor-maint audit --write-airtable`. Per-site batched fleet writes can return as a follow-up when there's actual demand.

  Also bundled in this patch: `src/reports/draft.ts` `daysAgo` now uses UTC accessors to stay TZ-consistent with `due.ts` (was the only non-UTC date math left in the reports pipeline; fires only on the first-ever report for a (site, type) pair). And `pnpm.overrides` to force `tmp@>=0.2.6` and `uuid@>=11.1.1`, clearing two transitive security advisories pulled in via `@lhci/cli`. Remaining advisories (mjml chain) have no upstream patch and are accepted with documented rationale in the morning brief.

## 0.17.0

### Minor Changes

- 08eba85: Per-site dashboard at `/s/<slug>?t=<token>` now shows a "Site Health" section with three tiles (Accessibility issues, Dependency updates, Security alerts) alongside the existing Lighthouse scores. Deps tile gains a "N major behind" sub-line when relevant; Security tile gains a `C/H/M/L` severity breakdown when total > 0. A "Last audited Xd ago" line under the URL completes the picture.

  Empty state surfaces a clear operator hint (`run reddoor-maint audit --write-airtable from the site checkout`) for sites that haven't been audited since Phase 2c shipped. Onboarding-status indicator stays operator-only — fleet page only.

## 0.16.0

### Minor Changes

- 8ecba98: CLI now auto-loads credentials from `~/.config/reddoor-maint/credentials.env` (respects `$XDG_CONFIG_HOME`) at startup, so `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `RESEND_API_KEY`, `DASHBOARD_PASSWORD` etc. follow the operator into any cwd — no more `cd` back into the maintenance repo to pick up `.env`. Shell-exported env vars still win over file values; missing/unreadable file is a silent no-op.

  When `AIRTABLE_PAT` or `AIRTABLE_BASE_ID` is missing, the error now points at the file path: `AIRTABLE_PAT not set. Export it in your shell or put it in /Users/<you>/.config/reddoor-maint/credentials.env as AIRTABLE_PAT=...`

## 0.15.0

### Minor Changes

- 2bfb7be: `reddoor-maint audit` now shows live progress while audits run, using `listr2` for spinners. Single-site runs show one spinner per audit type (e.g. `lighthouse: P=87 A=95 BP=78 SEO=100 (32s)`); fleet runs (`--fleet`) show one spinner per site with an `N/4 audits` counter. Audits still run fully in parallel — the spinner layer is presentation-only. `--write-airtable` gets its own progress step (`Wrote to Websites[Acme] (4 audit types)`).

  Behavior preserved: `--json` mode is silent (no spinner output, clean JSON on stdout), non-TTY contexts fall back to one-line-per-task transitions (CI logs, file redirects), and the final result table / JSON still prints to stdout exactly as before.

## 0.14.0

### Minor Changes

- c78e515: Fleet homepage now shows per-site cards with a11y violations, deps drift (count + major-behind), security vulnerability counts by severity, last-audited relative time, and a 4-point onboarding status. `audit --write-airtable` extended to persist the new counts to seven new `Websites` columns (`A11y Violations`, `Deps Drifted`, `Deps Major Behind`, `Security Vulns Critical/High/Moderate/Low`) alongside the existing Lighthouse fields.

  **Operator action required:** add the seven new number columns to the Airtable Websites table before running `audit --write-airtable` on the new version. Missing columns won't crash — they'll just stay `null` on the dashboard until populated.

## 0.13.0

### Minor Changes

- 640aa03: Refresh `baselineVersions` against `reddoor-starter`'s May 2026 dep set. Most caret-floated sites in the fleet had drifted ahead of the previous baseline (svelte 5.55.5 → 5.55.10, kit 2.59.0 → 2.61.1, vite 8.0.10 → 8.0.14, prismic-client 7.3.1 → 7.21.8, prismic-svelte 2.0.0 → 2.2.1, slice-machine-ui 2.11.1 → 2.21.3, eslint 10.3.0 → 10.4.0, prettier 3.1.1 → 3.8.3, prettier-plugin-svelte 3.2.6 → 4.0.1, tailwindcss 4.0.14 → 4.3.0, @lucide/svelte 1.14.0 → 1.17.0, and ~10 more). After this change, `deps` audits across the fleet flip from `warn` back to `pass` without any per-site work.

  Also adds `.reddoor-a11y/` to `CANONICAL_GITIGNORE_ENTRIES` so the local audit-output dir lands in every site's managed gitignore block on the next `sync-configs` run.

  The Svelte 4 → 5 upgrade recipe (`src/recipes/svelte-5/step-bump-versions.ts`) is intentionally unchanged — it pins a known-good transition combo, not the live baseline.

## 0.12.1

### Patch Changes

- 0e70da9: Fleet homepage now hides sites without a `Dashboard Token` instead of rendering them with a "no token" badge. The Airtable Websites table tracks every project — many aren't on the Reddoor maintenance stack (deprecated, hosting-only, in-dev for other teams). `dashboardToken` is the explicit opt-in: only sites with a token belong on the fleet view.

  Filter happens at the Netlify function layer; the render module is now a pure "render what you're given" function. Header copy updated from "N sites in the Websites table" to "N sites on the Reddoor stack" to match.

## 0.12.0

### Minor Changes

- 3aa8c8d: Phase 2 of the site dashboard: a password-gated fleet homepage at `/` listing every site in the Airtable Websites table. Each row links to its per-site `/s/<slug>?t=<token>` page (Phase 1). HTTP Basic Auth against a new `DASHBOARD_PASSWORD` env var (Netlify site env); username is ignored. Sites without a `Dashboard Token` set render with a "no token" badge so the homepage doubles as a setup-progress view.

  Operator setup: set `DASHBOARD_PASSWORD` in the Netlify site env (any value), then visit `https://<netlify-domain>/`. Browser prompts for credentials; type anything for username, the configured value for password.

  Phase 2b (click-to-trigger audit per site, via GitHub Actions workflow_dispatch) and Phase 2c (extending `audit --write-airtable` to persist lint/deps/security/a11y findings) are deferred to separate plans.

## 0.11.2

### Patch Changes

- 1882bc8: `audit --write-airtable` no longer refuses to write scores when the lighthouse audit fails because of assertion thresholds (e.g. best-practices below 0.9). The dashboard's whole purpose is to track those scores over time — refusing to push them when one assertion trips defeats the point.

  New behavior: only refuse when the audit produced no scores at all (infrastructure failure — empty `details.summary`, e.g. no manifest written / spawn timeout). Real scores below threshold are written.

  Extracted as `hasRealScores(result)` in `src/audits/lighthouse-airtable.ts` so the policy is unit-testable in isolation.

## 0.11.1

### Patch Changes

- 9ed0f23: Fix `/s/:slug` dashboard routing. The 0.11.0 shape relied on a `[[redirects]]` rewrite with `status=200` to map `/s/:slug` → the site-dashboard function — but Netlify passes the ORIGINAL request URL to the function in that mode, so `slug` was never extractable from the query string and every request fell through to the health-check JSON.

  Switches to Netlify v2 function-level path routing via `export const config = { path: ["/s/:slug", "/.netlify/functions/site-dashboard"] }`. The function reads `slug` from `ctx.params` (with the query-string fallback retained for direct function calls). Drops the rewrite from `netlify.toml`. Caught immediately on the first end-to-end deploy verification against caltex.

## 0.11.0

### Minor Changes

- 58379eb: Add per-site dashboard at `/s/<slug>?t=<token>`, deployed by the existing Netlify site. Pulls site metadata + lighthouse scores + recent reports from Airtable; gated by a new `Dashboard Token` field on the Websites row (operator generates one per site, rotated by replacing the value). Pure render module (`renderSiteDashboardHtml`) + constant-time token compare (`verifyDashboardToken`) are exported from the package entry for library consumers and CLI preview use.

  Operator setup: add a single-line-text field named `Dashboard Token` to the Websites table, generate a token with `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`, paste into the row. The dashboard URL becomes shareable immediately.

  Phase 1 surfaces what's already in Airtable today — lighthouse 4-tile + recent reports list. Phase 2 (extending `audit --write-airtable` to persist lint/deps/security/a11y findings + adding those tiles) lands in a follow-up. Custom domain (e.g. `status.reddoor.la`) is operator DNS work; the function is domain-agnostic.

## 0.10.7

### Patch Changes

- fd5b52c: a11y audit: write the spec/config directory inside `site.path` (not `/tmp`) so the spec's `import AxeBuilder from "@axe-core/playwright"` resolves via Node's walk-up to the site's `node_modules`. Same class of bug as the `webServer.cwd` fix in 0.10.6 — third layer of "the audit's working directory matters." Caltex 0.10.6 dogfood reproduced this in seconds; the manual fix-validation against caltex came back with `0 violations, 1 passed in 9.2s`.

## 0.10.6

### Patch Changes

- b7d6964: Two real fixes surfaced by dogfooding 0.10.5 against caltex.
  - **lighthouse**: `lhci@0.15+` no longer writes `manifest.json` — the audit was reading a stale filename and reporting "no manifest written" against perfectly healthy runs. The audit now scans `.lighthouseci/` for `lhr-*.json` files (which lhci does still write) and builds the manifest equivalent from each lhr's `requestedUrl` + `categories.X.score`.
  - **a11y**: the synthesized playwright config lives in `/tmp`, and playwright's default `webServer.cwd` is the config file's directory — so `npm run vite:dev` was reading `/tmp/.../package.json` and ENOENT'ing before vite ever started. The synthesized config now pins `webServer.cwd` to the site's path.

  Both were silent classes — masked by `manifest.json`-writing test mocks and a `webServer.cwd`-defaulting playwright config. Caltex dogfooding caught both on the first real audit run after 0.10.5 shipped.

## 0.10.5

### Patch Changes

- 488c315: Harden lighthouse + a11y audits against zombie dev-server processes.

  Both audits used to spawn `npm run vite:dev` and probe a hardcoded `localhost:5173`. If another process was already on 5173 (e.g. an orphaned vite from a prior `pnpm dev`), vite would silently bump to a free port while the audit kept probing 5173 — landing on the zombie and getting stale 404s, surfacing as `no manifest written` / `no results written (exit 1)`.

  The audits now allocate a free port up front and pass `--port <port> --strictPort` to vite, so the spawned server either binds the intended port or fails loudly. The lighthouse config gets its URL port rewritten to match; the a11y audit synthesizes its own playwright config (with `reuseExistingServer: false`) instead of relying on the site's local one.

## 0.10.4

### Patch Changes

- 9b506b4: fix: legacy-reactive codemod skips comments + selfPackageVersion/resolvePackageVersion walk up to find our package.json

  Two silent-corruption bug classes surfaced in tonight's deep review of the 0.7→0.10 arc. Both shipped in 0.10.x without ever triggering a test failure or a parser error.

  **1. `legacy-reactive.ts` brace counter ignored comments.**

  The codemod that converts `$: { ... }` Svelte 4 reactive blocks into `$effect(() => { ... })` walked the source counting braces, but only knew how to skip string literals — not `// line comments` or `/* block comments */`. A reactive block containing `// closing brace: }` would have the comment's `}` decrement the depth counter prematurely, causing `findMatchingClose` to return the wrong position. Result: either consume code AFTER the block (the real closing brace would be left as an orphan) or drop code FROM the block (truncated body emitted inside the new `$effect`). Output still compiles in Svelte 5 — no parser to scream — so the corruption shipped silently.

  Fix: `findMatchingClose` now skips both `// …\n` and `/* … */` segments alongside the existing string-literal masking. 3 new regression tests in `tests/recipes/svelte-5/codemods/legacy-reactive.test.ts` pin both comment shapes plus an inflate-depth case.

  **2. `selfPackageVersion` + `resolvePackageVersion` silently returned `"0.0.0"`/`"unknown"` when called from `dist/index.js`.**

  Both helpers used a `here/../../package.json` shortcut that held for `src/X/Y.ts` (in dev) and `dist/cli/bin.js` (in CLI invocations) — both happen to be 2 dirs deep under the package root. But when a consumer imports `onboard` from `dist/index.js` (only 1 dir deep), the lookup walks above the package root, ENOENTs, and the defensive fallback kicks in. Library consumers got `^0.0.0` pinned into their site's `package.json` instead of `^0.10.3`. Same bug class as the bundled-assets ENOENT we hotfixed in 0.10.2.

  Both functions now walk UP from the caller looking for the first `package.json` whose `name` matches `"@reddoorla/maintenance"`. Robust regardless of bundling layout.

  `selfPackageVersion` and `selfCaretRange` are now exported from the library entry so the regression test can invoke them through the built `dist/index.js` — the production context where the bug actually shipped. New `tests/util/self-version.test.ts` covers both src-context and dist-context paths plus the walk-past-unrelated-package.jsons case (essential when the consumer's own `package.json` sits above `node_modules/@reddoorla/maintenance/`).

## 0.10.3

### Patch Changes

- 3a6815a: fix(codemod, audit): dollar-restprops trailing-comma corruption + a11y spawn timeout

  **Codemod (`dollar-restprops`):** when the input `$props()` destructuring had a multi-line shape with a trailing comma (`{ foo, bar, }`), the codemod's `${trimmed}, ...rest` template emitted `bar,, ...rest` — invalid syntax. Surfaced when running init against caltex on 2026-05-27: Accordian.svelte was committed with a double comma and ESLint/prettier choked. Fix strips any trailing comma before insertion; new regression test pins both the plain-JS and TS-annotated forms.

  **a11y audit:** spawn was inheriting the shared 30 s default from `runAudits`. On cold trees, playwright needs to download Chrome + boot the dev server, easily 2-3 min — same failure mode the lighthouse audit had before its 5-min override. a11y now gets the same `timeoutMs: 5 * 60_000` treatment.

  Both bugs surfaced in the same `init` smoke test run; bundling them since they're equally small + same severity (both rendered the chain unable to complete cleanly on a real site).

## 0.10.2

### Patch Changes

- 8bd3751: fix(reports): bundled-image loader walks up to find assets dir (regression in 0.10.0–0.10.1)

  `reddoor-maint report --send-ready` on the published 0.10.0 and 0.10.1 packages crashed with `ENOENT: no such file or directory, open '<install>/dist/cli/check.png'` — tsup inlined the loader module into `dist/cli/bin.js` (and other entries), so its `dirname(fileURLToPath(import.meta.url))`-based sibling resolution looked next to `bin.js` instead of next to the actual `check.png` / `blurredTests.jpg` in `dist/reports/maintenance-email/assets/`. Dev tests didn't catch it because Vitest evaluates source files directly.

  Fix: the loader now walks up from `import.meta.url` looking for the assets dir in either the dev layout (`src/reports/maintenance-email/assets/`) or the published layout (`dist/reports/maintenance-email/assets/`). Memoised — walks once per process. Source layout preferred so workspace dev always reads from the canonical source.

  New regression test (`tests/reports/bundled-assets.test.ts`) builds dist and spawns Node to invoke `loadBundledImages` through `dist/index.js` from arbitrary cwds, including `/` — the actual failure mode that shipped (npx runs the package from `~/.npm/_npx/<hash>/` with the user's cwd elsewhere).

  Also exports `loadBundledImages`, `CHECK_CID`, `BLURRED_CID`, and `BundledImage` from the library entry so consumers / tests can invoke the loader directly.

## 0.10.1

### Patch Changes

- 9e779c9: feat(webhook): GET health-check on `/resend-webhook` + Netlify deploy procedure in README

  `GET /.netlify/functions/resend-webhook` now returns a JSON envelope reporting which of the three required env vars (`RESEND_WEBHOOK_SECRET`, `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`) are present on the deployed Netlify function. Lets operators curl the deployed URL right after wiring env vars and confirm the function is reachable + env is wired before doing any Resend webhook configuration. Reports presence-only — secret values are never echoed (test asserts this).

  README gains a full **Webhook deployment** section under Reports with the click-by-click: create site → set env vars → trigger deploy → curl health → register in Resend → end-to-end smoke against ERP Industrials.

  POST behaviour unchanged.

## 0.10.0

### Minor Changes

- fa098a0: feat(recipes): `reddoor-maint init` — one-shot guided onboarding

  Runs the full onboarding chain (`convert-to-pnpm → onboard → sync-configs → svelte-codemods → a11y-fixtures-page → audit`) in sequence against a site. Thin orchestrator — every underlying recipe still creates its own branch, so the operator ends up with a stack of `maint/<recipe>-<ts>` branches to PR. `noop` results continue the chain; first `failed` recipe or uncaught error short-circuits.

  ```bash
  pnpm reddoor-maint init             # against cwd
  pnpm reddoor-maint init ./my-site   # explicit path
  pnpm reddoor-maint init --fleet airtable   # across the fleet
  ```

  Also adds a new `a11y-fixtures-page` recipe (included in `init`'s default sequence) that writes a starter `src/routes/dev/a11y-fixtures/+page.svelte` if the route doesn't exist. The `lighthouse` and `playwright-a11y` configs both target this URL; newly-onboarded sites need the route to exist for either audit to pass. Template is intentionally generic (semantic landmarks + headings + a relative link) — operator edits to an existing page are never clobbered.

  Library exports: `init`, `a11yFixturesPage`, `DEFAULT_INIT_STEPS`, `InitOptions`, `InitResult`, `InitStep`, `InitStepResult`.

  Closes 0.9.x scope item: `reddoor-maint init` + bootstrap `/dev/a11y-fixtures` route (per [docs/superpowers/plans/2026-05-27-0.9.0-scope.md](docs/superpowers/plans/2026-05-27-0.9.0-scope.md)).

## 0.9.0

### Minor Changes

- a93d84f: feat(audit): per-site lighthouse URL via `package.json#reddoor.lighthouseUrl`

  The lighthouse audit hardcoded `http://localhost:5173/dev/a11y-fixtures` — a hand-crafted Reddoor-fleet dev route. Newly-onboarded sites (e.g. CalTex) don't have that route and the audit failed with "no manifest written" before any scores could be collected. Sites can now override the URL in their own `package.json`:

  ```jsonc
  {
    "reddoor": {
      "lighthouseUrl": "http://localhost:5173/",
    },
  }
  ```

  Fallback unchanged when the field is missing, malformed, empty-string, or wrong type — existing Reddoor sites keep working without edits.

  Also bundled here: the lighthouse audit now gets a 5-minute spawn timeout (was 30 s, the shared default starved lhci on cold trees). This fix was originally pushed to PR #40 after the squash-merge so it never landed; folding it in alongside the related URL work.

## 0.8.0

### Minor Changes

- 2c0ca92: feat(workflow): 0.8.0 — close the operator workflow loop opened in 0.7.0.

  **New: `audit lighthouse --write-airtable [slug]`**

  Pushes the 4 Lighthouse scores directly to the matching Websites row in Airtable, plus a `Last lighthouse audit at` timestamp. Slug defaults to the cwd's `package.json#name` if not provided. Refuses to write if the lighthouse audit failed (won't overwrite good scores with garbage). Eliminates the manual paste step from the report-drafting flow.

  **New: `--fleet airtable`**

  Inventory keyword to read sites directly from the Airtable Websites table instead of a JSON file. Combined with `REDDOOR_FLEET_WORKDIR` env var (or `--workdir`), lets operators run `reddoor-maint audit --fleet airtable` against the full Airtable fleet. Excludes sites where both maintenance + testing freq are None.

  **Reports: orchestrator test coverage**

  `draftReportForSite`, `sendApprovedReports`, and `sendOne` now have real integration tests using a typed `Pick<AirtableBase, …>` fake at `tests/reports/_helpers/fake-airtable-base.ts`. Covers recipient resolution + fallback, Subject override, B1 attachment shape (header + bundled CIDs), B2 idempotencyKey, H4 non-clobbering stamp, missing-headerImage error, orphan-siteId error.

  **Reports: vendored CloudFront images**

  `check.png` and `blurredTests.jpg` are bundled in `src/reports/maintenance-email/assets/` and embedded inline via CID alongside the per-site header. The previous external dependency on `d3eq0h5l8sxf6t.cloudfront.net` is gone; emails are ~600 KB heavier on Maintenance variants and self-contained.

  **Reports: defensive cleanups**
  - `findDueReports` skips sites in status `deprecated` or `probably not our problem`.
  - `attachRenderedHtml` dead-code removed; `uploadHtmlAttachment` moved from `draft.ts` → generalized `uploadAttachment` in `airtable/attachments.ts`.
  - Webhook now imports `findReportByMessageId` + `setDeliveryStatus` from the shared module (was duplicating the query inline).
  - `STATUS_MAP` is single-source at `src/reports/webhook-events.ts` (was duplicated in the webhook test).

  **Perf: `audit --fleet` parallelizes across sites**

  Switched from a sequential for-loop to `runAuditsAcross`. Fleet of 30 sites × 5 audits each goes from ~30 min serial to roughly the longest single-site audit time.

  **Required env (unchanged):** `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `RESEND_API_KEY` (CLI); `RESEND_WEBHOOK_SECRET` (webhook only). New optional: `REDDOOR_FLEET_WORKDIR` (default workdir for `--fleet airtable`).

  **Still deferred to 0.9.0:** GA Data API integration, webhook deployment pipeline (Netlify site provisioning).

## 0.7.0

### Minor Changes

- d1218ac: feat(reports): add the `report` concept — per-site maintenance/testing email reports built from Lighthouse + Airtable, sent via Resend with per-client header inlined via CID. New CLI surface: `reddoor-maint report --due`, `reddoor-maint report <slug>`, `reddoor-maint report <slug> --preview`, `reddoor-maint report --send-ready`. Includes a Netlify webhook function for writing Resend delivery events back to Airtable's `Reports.Delivery status`.

  Operator flow: cron `--due` drafts overdue reports → operator reviews HTML attachment on Airtable mobile, fills in the two GA user-count fields, flips `Approved to send` → cron `--send-ready` sends → webhook updates `Delivery status`.

  Required env: `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `RESEND_API_KEY` (CLI); `RESEND_WEBHOOK_SECRET` (webhook only). See `.env.example`.

  Deferred to 0.7.1: GA Data API automation (manual entry in Airtable mobile for now).

## 0.6.8

### Patch Changes

- 4d43784: ### Internal: `withRecipe(...)` wrapper consolidates the boilerplate every recipe used to re-implement

  Closes debt item #15 from the deep-review backlog. Pure refactor — no behavior changes (every existing recipe test passes unchanged).

  Every recipe used to hand-roll: site-label resolution, working-tree clean check, branch name + branch creation, commit-with-message + SHA accumulation, and the `RecipeResult` object literal for each of `noop` / `failed` / `applied`. That pattern is now centralised in `src/recipes/_with-recipe.ts`:

  ```ts
  export async function syncConfigs(site, opts): Promise<RecipeResult> {
    // ... compute targets ...
    return withRecipe({
      name: "sync-configs",
      site,
      plan: async () => {
        const diffs = await planTemplateDiffs(...);
        if (nothing) return { kind: "noop", notes: "..." };
        return { kind: "apply", plan: { diffs } };
      },
      apply: async ({ diffs }, { commit }) => {
        for (const t of diffs) {
          await writeFile(...);
          await commit(`chore: sync ${t.config} ...`);
        }
        return { kind: "ok" };
      },
    });
  }
  ```

  Plan runs first — read-only by default, so most recipes can `noop` on a dirty tree without throwing. `bump-deps` opts into `checkTreeFirst: true` because its plan runs `pnpm install` to get an accurate `outdated` probe and would otherwise pollute a dirty tree silently.

  ### Numbers
  - 6 recipes refactored (`sync-configs`, `bump-deps`, `convert-to-pnpm`, `onboard`, `svelte-codemods`, `svelte-4-to-5`)
  - ~142 lines of duplicated boilerplate removed across recipe files
  - One new internal module (~114 lines) holding the shared logic
  - Net: smaller, more focused recipe modules; new recipes can be added with significantly less ceremony
  - 268 / 268 tests pass without modification — the existing per-recipe specs are the spec for this refactor

## 0.6.7

### Patch Changes

- 43d9fbe: MEDIUM-severity hygiene fixes + small debt cleanup from the deep-review backlog. No behavior changes for happy paths — everything in this release is either a safety improvement, an internal extraction, or new test coverage.

  ### Fixed: `branchName` is now millisecond-precision (item #D)

  Was second-precision. Two recipe invocations within the same second produced the same branch name and collided — rare for serial fleet runs, easy to hit when running from two terminals. ISO format now includes the millis fraction (`maint/recipe-20260526T120000123Z`); the collision window is one millisecond.

  ### Fixed: `removeDollarRestProps` no longer corrupts string literals (item #G)

  `dollar-props-class` previously used a single `/g` regex for both the existence check (`.test()`) and the iterating replace (`.replace()`), with a manual `lastIndex = 0` reset to paper over the statefulness. The `.test()` path now uses a stateless non-`/g` regex; the `/g` variant is reserved for the actual iteration. Pure hygiene — no behavior change.

  ### Fixed: security audit no longer reports false-pass on `metadata.vulnerabilities = {}` (item #I)

  A malformed audit output with `{ metadata: { vulnerabilities: {} } }` previously passed the existence check (`!{}` is `false`), counts defaulted to 0, and the audit silently reported "pass." Empty-object is now treated as a tool error and falls through to the other audit tool.

  ### New: `on:click|modifier` emits an `@migration-task` marker (item #E)

  Svelte 5 removed event modifier syntax entirely. The rewrite is non-trivial (`on:click|preventDefault={fn}` → `onclick={(e) => { e.preventDefault(); fn(); }}`) so the codemod doesn't attempt it automatically — but it now inserts a `<!-- @migration-task: ... -->` comment immediately above each offending element. The original attribute is preserved verbatim. The codemod stays idempotent: re-runs against output don't double-insert.

  ### Internal: bin.ts `runOrExit` helper (debt #14)

  The 7 command `.action()` bodies all duplicated the same try/catch + `process.exit(code)` pattern. Extracted to a `runOrExit(fn, opts)` helper; each `.action()` is now a one-liner.

  ### Internal: extracted shared utilities (debt #18)
  - `siteLabel(site)` was inlined identically in 11 files (every audit + every recipe). Moved to `src/util/site.ts`.
  - `findStringEnd(source, openIdx)` (formerly `findStringClose` / `findStringEnd` in two codemods) moved to `src/util/svelte-source.ts`.

  ### New: CLI tests for onboard, convert-to-pnpm, svelte-codemods (debt #16)

  These three CLI commands previously had no dedicated test files — only the underlying recipe tests. Added `--help` + flag-validation smoke tests mirroring the existing bump-deps / sync-configs / upgrade pattern.

## 0.6.6

### Patch Changes

- 4705694: Six recipe + CLI hygiene fixes from the deep-review backlog.

  ### Fixed: `writePackageJson` preserves source indent style (item #5)

  The helper hardcoded `JSON.stringify(pkg, null, 2)`, so any site using tabs or 4-space indent got reformatted on every recipe that touched `package.json` — noisy and irrelevant diffs in `convert-to-pnpm`, `onboard`, and the svelte-5 bump-versions step. The helper now sniffs the existing file's indent (tab vs N-space) and round-trips with the same style. New files default to two spaces, matching prior behavior.

  ### Fixed: `onboard` sources `AUDIT_DEPS` from `baseline-versions` (item #10)

  `AUDIT_DEPS` previously hardcoded `@lhci/cli`, `@playwright/test`, and `@axe-core/playwright` versions inline — the same staleness foot-gun that `DEFAULT_PACKAGE_VERSION` had before 0.6.2. The map now resolves each name from `src/configs/baseline-versions.ts` at module load, throwing immediately if any audit dep is missing from the baseline (programming-error check). A regression test guards against re-introduction of hardcoded literals.

  ### Fixed: `bump-deps` checks the working tree clean before running `pnpm install` (item #6)

  The pre-flight `pnpm install` (needed so `pnpm outdated` sees a fresh lockfile) ran _before_ the clean-tree check, so a desynced lockfile would be silently rewritten on top of whatever else was in the user's tree. The check is now first; `pnpm install` only runs once we know the tree is clean.

  ### New: `bump-deps` detects competing lockfiles and refuses to run (item #7)

  If `package-lock.json` or `yarn.lock` exists without a `pnpm-lock.yaml`, the recipe is now a fast `{ status: "failed", notes: "run convert-to-pnpm first" }` instead of emitting opaque pnpm errors. No pnpm commands are attempted in this case.

  ### Fixed: `sync-configs --only` rejects unknown config names (item #8)

  The CLI's `parseOnly` previously did `as ConfigName[]` and silently passed typos through, producing a confusing "noop" result. It now validates every name against `ALL_CONFIG_NAMES` (newly exported from `recipes/sync-configs.ts` alongside an `isConfigName` type guard, mirroring `ALL_AUDIT_NAMES`) and throws `{ exitCode: 2 }` with the offending name and the valid list. A type-test in `tests/types.test.ts` guards against drift between the runtime array and the `ConfigName` union.

  ### Fixed: `sync-configs --dry` reports gitignore drift (item #9)

  `dryPlan` previously iterated only the five template configs, so a missing or stale `.gitignore` was silently absent from the dry output even though a real run would create or merge one. The dry plan now also calls into the gitignore canonical-entries merge and reports `would create .gitignore` or `would update .gitignore (N canonical entries to add)` as appropriate. Respects `--only gitignore` to scope output.

## 0.6.5

### Patch Changes

- 4f95a23: Two codemod / recipe safety fixes from the deep-review backlog.

  ### Fixed: `convert-to-pnpm` removes `node_modules` before `pnpm install`

  Sharing a flat npm `node_modules` across package managers produces phantom-dep resolution issues — pnpm's nested layout disagrees with what's already on disk, and consumers downstream see unexpected resolution paths until the next clean install. The recipe now `rm -rf node_modules` between rewriting the lockfile/package.json and running `pnpm install`, so the new tree is a clean pnpm layout from the first install. node_modules is gitignored on every reddoor site so this doesn't dirty the working tree.

  ### New: `legacyReactiveToRunes` codemod emits `@migration-task` markers on block conversions

  `$: { … }` blocks are converted to `$effect(() => { … })` — which always compiles, but only stays reactive if the locals the block mutates were declared as `$state(…)` rather than plain `let`. Detecting that automatically would require scope analysis on the declaration sites (out of scope for this codemod), so the codemod now leaves a breadcrumb next to each converted block:

  ```js
  // @migration-task: $effect won't trigger UI updates on plain `let` bindings — refine mutated locals to $state or split into per-variable $derived.
  $effect(() => {
    justify = float;
    if (float === "left") justify = "start";
  });
  ```

  The marker only appears on `$: { … }` block conversions. Simple `$: var = expr` → `let var = $derived(expr)` conversions are reactive-safe (Svelte 5 `$derived` is reactive by construction) and don't get a marker. The codemod remains idempotent: re-running on output doesn't find any new `$:` blocks to convert, so no new markers get added.

## 0.6.4

### Patch Changes

- 39e0567: ### Fixed: `removeDollarRestProps` no longer emits references to an undeclared `rest`

  The codemod previously rewrote `<div {...$$restProps}>` → `<div {...rest}>` unconditionally, but never modified the script's `$props()` destructuring. The result was Svelte 5 source that referenced an undeclared identifier — a silent runtime breakage on any component using `$$restProps`.

  The codemod now:
  - **Injects `...rest` into an existing `$props()` destructuring** when `$$restProps` is used. For TypeScript components, the inline type annotation is widened with an `[key: string]: unknown` index signature so the rest binding actually captures excess attributes (without the widening, TS would infer `rest` as `{}` and the spread would forward nothing).

    ```ts
    // before
    let { name }: { name: string } = $props();
    // …
    <div {...$$restProps}>{name}</div>

    // after
    let { name, ...rest }: { name: string; [key: string]: unknown } = $props();
    // …
    <div {...rest}>{name}</div>
    ```

  - **Is idempotent.** A `$props()` destructuring that already collects `...rest` is left alone — no double-insert.
  - **Refuses to rewrite when no `$props()` call exists.** The rare Svelte 4 component that used `$$restProps` without `export let` to convert now passes through unchanged, leaving the user with the original `$$restProps` and a clear Svelte 5 build error to migrate by hand — rather than receiving broken output.

  ### Fixed: `removeDollarRestProps` no longer corrupts string literals

  The previous global `replace(/\$\$restProps/g, "rest")` also rewrote occurrences inside `'…'`, `"…"`, and backtick-delimited strings in the script body (e.g. a comment-style error message like `"$$restProps was removed in Svelte 5"` became `"rest was removed in Svelte 5"`). The codemod now masks script-level string literals before the rewrite and restores them afterwards.

## 0.6.3

### Patch Changes

- c03fb1e: ### Fixed: `state-effect-sync` codemod missed the multi-line `$effect` form with trailing semicolons

  The regex only matched `$effect(() => { x; name = expr })` — bare expression, no trailing `;` before the closing `}`. In practice every fleet site authored the effect across multiple lines with a semicolon after the assignment:

  ```js
  $effect(() => {
    data;
    content = data.page.data;
  });
  ```

  That form was silently skipped, leaving `$state + $effect` manual-sync pairs untouched on sites the codemod was supposed to clean up. The pattern now also matches an optional `;` after the assignment, so both forms convert to `$derived(...)`.

  ### New: end-to-end pipeline composition test

  Surfaced this bug, plus catches future regressions where individual recipes pass in isolation but break when chained. The fixture (`tests/fixtures/pre-onboarding/`) is a Svelte 5 site still on npm with every legacy pattern reddoor sites accumulated during their original 4→5 migration. The test runs the full onboarding sequence — `convert-to-pnpm → onboard → sync-configs → svelte-codemods` — and verifies both the green path and idempotency on a second pass. This mirrors the actual sequence we ran (manually) against caltex-landing and espada, where bugs like this one only appeared when recipes ran against each other's output.

## 0.6.2

### Patch Changes

- aabba87: Five critical fixes surfaced by an overnight deep review of the codebase after yesterday's `0.3.0 → 0.6.1` arc.

  ### Restored: `legacyReactiveToRunes` codemod

  The Svelte 4 `$:` reactive statement codemod was authored yesterday but never made it into the merged PR #20 — the merge fired against an earlier tip of the branch and the follow-up commit was lost. Fleet sites were patched via local `dist`, but `npm install @reddoorla/maintenance@0.6.1` did not include it. Restored from the orphan branch and registered in the codemod pipeline.

  ### Fixed: registration drift on the recipe registry

  `"svelte-codemods"` was in the `RecipeName` type union but missing from `ALL_RECIPE_NAMES` and the package's main entry. `isRecipeName("svelte-codemods")` silently returned `false`; library consumers couldn't `import { svelteCodemods }` at all. Now exported and registered. Added a type-test that the runtime array exactly matches the union.

  ### Fixed: `DEFAULT_PACKAGE_VERSION` was hardcoded at `^0.2.0`

  Three majors stale. Any fresh `onboard` was pinning new sites to a version of the maintenance package that predates `convert-to-pnpm`, `svelte-codemods`, and every codemod we shipped. The default now derives from this package's own `package.json` at runtime via the new `selfCaretRange(import.meta.url)` helper — no manual syncing at each minor bump.

  ### Fixed: `git clone` argv-injection on inventory `repoUrl`

  [src/cli/fleet/clone-if-needed.ts] previously passed `repoUrl` to `git clone` positionally, so a `repoUrl` starting with `-` was interpreted by git as a flag (CVE-2017-1000117 family — `--upload-pack=evil` is a known RCE primitive). Now validates the URL against a scheme allowlist (`https://`, `http://`, `ssh://`, `git://`, `file://`, or scp-style `user@host:path`) and passes `--` to `git clone` as a defense-in-depth separator.

  ### Bundled tests
  - New regression test in `types.test.ts` that the recipe registry doesn't drift again.
  - New `onboard.test.ts` case that pins use the live package version.
  - 5 new tests in `clone-if-needed.test.ts` covering argv-injection rejection, scheme validation, and the `--` separator.

## 0.6.1

### Patch Changes

- 421a757: Two codemod fixes surfaced by the caltex 0.6.0 pilot — sites failed to build with `Cannot use $$props in runes mode`.

  ### `dollarPropsClass` (new codemod)

  Converts the legacy `$$props.class` pattern (extra HTML class passed from a parent) to a Svelte 5 named-prop destructuring:

  ```svelte
  <!-- before -->
  <script lang="ts">
    let { foo }: { foo?: string } = $props();
  </script>
  <div class="other {$$props.class || ''}">x</div>

  <!-- after -->
  <script lang="ts">
    let { foo, class: className = "" }: { foo?: string; class?: string } = $props();
  </script>
  <div class="other {className || ''}">x</div>
  ```

  The original `svelte-migrate` tool flagged this with `@migration-task` comments because it can't safely combine `$$props` with named props in general. We can for the `class` case specifically — it's the dominant pattern across the reddoor fleet. The codemod also strips those stale `@migration-task` comments when the file's `$$props` issues are fully resolved.

  Conservative match — only transforms files that have BOTH a template `$$props.class` reference AND an existing `$props()` destructuring. Lazy regex backtracking on the destructuring body so default values containing braces (`click = () => {}`, `config = { x: 1 }`) and type annotations containing braces (`items: string[]|{label:string}[]`) don't truncate the match.

  ### `exportLetToProps` (relaxed)

  Previously only matched `<script lang="ts">` blocks. Now matches plain `<script>` too, emitting destructuring without a type annotation. Picks up Svelte 4 → 5 conversions the original migration skipped (caltex's `ArrowButton` was the immediate find).

  ### Re-running

  Sites that already had 0.6.0 codemods applied can safely re-run `reddoor-maint svelte-codemods` — the new codemods are additive and the existing ones are idempotent.

## 0.6.0

### Minor Changes

- 020f511: Add `svelte-codemods` recipe + `state_referenced_locally` codemod.

  Discovered during the caltex 0.5.0 pilot: Svelte 5's `state_referenced_locally` warning flags real reactivity bugs where `let X = $state(prop.expr)` captures a prop only at init time. The same shape appeared in 6+ caltex route files (and likely across the fleet) — a copy-pasted manual-sync pattern:

  ```js
  let { data } = $props();
  let content = $state(data.page.data);
  $effect(() => {
    data;
    content = data.page.data;
  });
  ```

  ### `stateEffectSyncToDerived` codemod

  New gotcha codemod that collapses the pattern above into the idiomatic Svelte 5 form:

  ```js
  let content = $derived(data.page.data);
  ```

  Joins the existing `onEventToHandler`, `exportLetToProps`, and `removeDollarRestProps` codemods in the gotchas pipeline. Conservative match: only transforms when the `$state(...)` initializer expression and the `$effect`'s assignment expression are textually identical (after trim). Intervening statements between the two block the match. Idempotent.

  ### `svelte-codemods` standalone recipe

  The full `svelte-4-to-5` recipe short-circuits sites already on `svelte ^5.x`. The new `svelte-codemods` recipe runs the same codemod pass on its own — useful when post-migration Svelte 5 strictness warnings emerge and the fleet needs a clean re-application.

  ```sh
  reddoor-maint svelte-codemods /path/to/site
  ```

  Creates a `maint/svelte-codemods-<ts>` branch with one commit: `refactor(svelte5): apply codemods (N files)`. Plans in memory first — no branch is created if the codemods would be a noop, so re-runs are cheap.

  ### Internal refactor

  `applyGotchaCodemods` now delegates to a new `planGotchaCodemods` that returns the change set without writing. `svelte-4-to-5`'s pipeline keeps the existing write-on-apply behavior; `svelte-codemods` uses the plan/apply split to short-circuit cleanly on noop.

## 0.5.0

### Minor Changes

- fb81d1c: `sync-configs` now manages `.gitignore` across the fleet and untracks build artifacts.

  A new canonical config target — `gitignore` — joins the five existing ones (`eslint`, `prettier`, `lighthouse`, `playwright-a11y`, `svelte`). Unlike the others, it **merges** rather than overwrites: the recipe layers in any missing canonical entries while leaving site-specific lines (custom dirs, editor files, OS junk) untouched.

  In the same commit, the recipe also runs `git rm -r --cached` for any tracked paths that fall under a canonical _directory_ entry — typically `build/`, `dist/`, `.svelte-kit/`, `coverage/`, `playwright-report/`, `test-results/`, `.lighthouseci/`, `.vercel/`, `.netlify/`, `node_modules/`. So sites that accidentally committed build output (espada has, caltex has) get cleaned up the next time sync-configs runs.

  ### Canonical entries

  ```gitignore
  node_modules/
  build/
  dist/
  .svelte-kit/
  coverage/
  .vitest-cache/
  playwright-report/
  test-results/
  .lighthouseci/
  .tsbuildinfo
  .env
  .env.*
  !.env.example
  .DS_Store
  *.log
  .vercel/
  .netlify/
  ```

  File-pattern entries (`.env`, `*.log`, `.DS_Store`, `.tsbuildinfo`) are **not** auto-untracked. They may contain user-meaningful data, and `git rm --cached` cannot scrub secrets from history regardless. Surfaced via the `.gitignore` rule itself; manual cleanup if needed.

  ### Merge semantics
  - Existing entries in any normalized form (`build`, `/build`, `build/`, `/build/`) count as present — no duplicates appended.
  - Blank lines and comments are preserved.
  - Missing canonical entries are appended under a `# canonical entries from @reddoorla/maintenance sync-configs` marker.
  - All-present → noop, no commit.

  ### Re-running against onboarded sites

  Sites previously synced under ≤ 0.4.0 will see one new commit: `chore: sync gitignore from @reddoorla/maintenance` — adds the rule, untracks any matching build artifacts. Idempotent: re-running is a noop.

  ### CLI

  ```sh
  # whole site (all six config targets)
  reddoor-maint sync-configs /path/to/site

  # just the gitignore + untrack pass
  reddoor-maint sync-configs /path/to/site --only gitignore
  ```

## 0.4.0

### Minor Changes

- 5e08fe0: Add `createSvelteConfig` helper and svelte.config.js to sync-configs templates.

  Discovered during the caltex pilot: Svelte 5 emits `element_invalid_self_closing_tag` for the `<div ... />` shorthand reddoor codebases use everywhere. Across a fleet this drowns out useful warnings; silencing it once per site was repetitive.

  ### `createSvelteConfig`

  New canonical helper exported from `@reddoorla/maintenance/configs/svelte`. Wraps a site's existing config and layers in the canonical `compilerOptions.warningFilter`, which silences `element_invalid_self_closing_tag`. Composes cleanly with any site-provided filter — both must allow a warning for it to show.

  ```js
  // svelte.config.js
  import { createSvelteConfig } from "@reddoorla/maintenance/configs/svelte";
  import adapter from "@sveltejs/adapter-auto";

  export default createSvelteConfig({
    kit: { adapter: adapter() },
  });
  ```

  ### sync-configs now includes svelte

  The recipe now writes a canonical `svelte.config.js` using `createSvelteConfig` + `adapter-auto`. Sites already on `adapter-auto` (most reddoor sites) get clean syncs. Sites using a different adapter need to edit after sync.

  The new template intentionally **drops** `preprocess: vitePreprocess()` since Svelte 5 no longer needs it. Sites carrying that legacy preprocess setting are quietly modernized during sync.

  ### Re-running sync-configs against onboarded sites

  Sites previously synced under ≤ 0.3.0 will see a new commit for `svelte.config.js` on the next run. Idempotent: re-running again is a noop.

## 0.3.0

### Minor Changes

- 00081f3: Add `onboard` recipe + CLI command for first-time fleet enrollment.

  After running `convert-to-pnpm` to get a site onto pnpm, the next missing piece was: how does the site actually get the deps it needs to run audits? Discovered during the espada pilot — running `sync-configs` against a site missing `@reddoorla/maintenance`, `@lhci/cli`, `@playwright/test`, or `@axe-core/playwright` would land template files that immediately broke at runtime.

  `onboard` closes that gap. It:
  - Adds `@reddoorla/maintenance` as a devDep at the current minor range (`^0.2.0`) if not present
  - Adds the canonical audit deps (`@lhci/cli`, `@playwright/test`, `@axe-core/playwright`) at baseline versions
  - Runs `pnpm install` with streaming output
  - Commits the resulting package.json + pnpm-lock.yaml as one logical change

  Idempotent: returns `noop` when everything is already declared. Refuses on dirty trees. Pre-flights for `pnpm-lock.yaml` and returns `failed` with `"run convert-to-pnpm first"` if absent.

  CLI: `reddoor-maint onboard [site]` with `--audits lighthouse,a11y` to subset (default = both) and `--fleet <inventory>` for batch onboarding.

  Library: `onboard(site, { audits?, packageVersion?, spawn? })` exported from the package.

  ### Recommended workflow for new fleet sites

  ```bash
  reddoor-maint convert-to-pnpm /path/to/site   # if site is on npm/yarn
  reddoor-maint onboard /path/to/site            # install deps
  reddoor-maint sync-configs /path/to/site       # write canonical configs
  reddoor-maint audit /path/to/site              # verify
  ```

## 0.2.0

### Minor Changes

- 366f389: Add `convert-to-pnpm` recipe + CLI command to migrate npm/yarn sites onto pnpm. Also fixes canonical configs to use portable start commands.

  ### New: `convert-to-pnpm` recipe

  For sites still using `package-lock.json` (or `yarn.lock`). Idempotent and branch-isolated like every other recipe:
  - Detects `pnpm-lock.yaml` → returns `noop`
  - Otherwise: removes `package-lock.json` + `yarn.lock`, pins `packageManager: "pnpm@<version>"` in `package.json`, rewrites `npm run X` → `pnpm run X` and `npx X` → `pnpm dlx X` in scripts, runs `pnpm install`, commits the resulting `pnpm-lock.yaml`.
  - Three commits per applied run (lockfile removal, packageManager + script rewrites, new pnpm-lock).
  - Returns `failed` (with the branch preserved for inspection) if `pnpm install` errors.

  CLI: `reddoor-maint convert-to-pnpm [site]` or with `--fleet` for batch conversion.

  Library: `convertToPnpm(site, { spawn?, pnpmVersion? })`.

  ### Fix: canonical configs use portable `npm run vite:dev`

  Both `src/configs/lighthouse.ts` (`startServerCommand`) and `src/configs/playwright-a11y.ts` (`webServer.command`) previously hardcoded `pnpm vite:dev`. After sync-configs landed on an npm site, lhci and Playwright would fail to start the dev server. `npm run vite:dev` works on both pnpm and npm sites with no downside.

  ### Script rewriter is conservative on purpose
  - Touches `npm run <name>` and `npx <token>` (identical semantics under pnpm)
  - Skips bare `npm install`, hyphenated names like `npm-check-updates`, and concurrently's `"npm:scriptName"` shorthand

## 0.1.3

### Patch Changes

- 4939cc5: Fix security audit silently reporting `pass` for npm-using sites (no pnpm-lock.yaml).

  When pnpm was installed but the project had no pnpm-lock.yaml, pnpm audit emitted an error envelope (`{ "error": { "code": "ERR_PNPM_AUDIT_NO_LOCKFILE", ... } }`) and exit code 1. The audit treated that as valid output, read `metadata.vulnerabilities` as undefined → defaulted every count to 0 → returned `pass`. Every npm-using site in a fleet was reported as security-clean.

  Discovered while piloting against an npm-using reddoor site (espada): the site has 9 real CVEs (3 high, 5 moderate, 1 low) including `@sveltejs/kit` and `devalue` advisories. The previous version reported `0 vulnerabilities`.

  The audit now:
  - Falls through to `npm audit` not just when pnpm is missing, but whenever pnpm returns an error envelope, non-zero/non-one exit code, unparseable JSON, or output without `metadata.vulnerabilities`.
  - Skips with a clear `cannot run audit — pnpm: <reason>; npm: <reason>` summary when both tools fail.

  Tests cover the error-envelope, missing-metadata, and both-tools-failed paths.

## 0.1.2

### Patch Changes

- 2391f77: Recipe + audit robustness pass surfaced by a second-deep code review. No public API breakage; one inventory schema tightening flagged below.

  **Recipe fixes:**
  - `svelte-4-to-5` no longer adds packages the site never declared. The step now uses a new `bumpDep(..., { mode: "bump-only" })` option that updates existing entries but skips packages that aren't already present. Sites that intentionally exclude e.g. `@sveltejs/adapter-netlify` stay clean.
  - `svelte.config.js` migration handles multi-name imports (`{ vitePreprocess, sveltePreprocess }` — only `vitePreprocess` is removed, the rest are preserved) and `vitePreprocess(options)` calls with balanced-paren matching instead of an empty-parens regex.
  - `bump-deps` now runs `pnpm install` before `pnpm outdated --json` so the outdated probe acts on a fresh lockfile rather than potentially stale data.
  - `bump-deps` streams `pnpm up` output to the parent so long upgrades show live progress rather than looking hung.
  - `$$Props` interface removal now uses brace counting so nested-brace or multi-line interface bodies are removed correctly.

  **Audit fixes:**
  - A11y spec now sets `test.setTimeout(5 * 60_000)` so multi-route scans don't trip Playwright's 30s per-test default.
  - Lint audit hands relative paths to ESLint (cwd is already set), avoiding symlink dereferencing on pnpm workspaces.
  - Security audit handles npm `via: "string"` chains, deduplicates transitive vulnerabilities to their root advisory, and normalizes `"info"` severity to `"low"` instead of defaulting to `"moderate"`.

  **Robustness:**
  - CLI version readout no longer crashes on Yarn PnP setups (where `node_modules/<pkg>/package.json` isn't a real file). Falls back to `"unknown"`.
  - `cloneIfNeeded` rejects inventory `name` values that contain path separators, absolute paths, or `..` traversal segments — closes a path-escape vector for untrusted inventories.
  - `fromJsonFile` rejects inventory entries with relative `path` values; absolute paths only.

  **New options:**
  - `bumpDep(pkg, name, version, { mode: "bump-only" })` — added.
  - `SpawnFn` options gained `streaming?: boolean` to inherit stdio. When true, the returned stdout/stderr will be empty.

## 0.1.1

### Patch Changes

- 15d81b2: Fix lighthouse and a11y audits to parse real tool output. Previously they discarded everything the tools wrote and synthesized results from spawn exit code alone, which made `details.summary` always empty for lighthouse and silently dropped per-impact axe violation data.
  - Lighthouse now reads `<site>/.lighthouseci/manifest.json` for per-category scores and `<site>/.lighthouseci/assertion-results.json` for which assertions failed at what level.
  - A11y now writes a Playwright spec that aggregates axe violations across all configured routes into `<site>/.reddoor-a11y/results.json` (via the `REDDOOR_A11Y_OUTPUT` env var); the audit reads that artifact regardless of test outcome.
  - Security audit now surfaces per-advisory details (module, severity, title, CVEs) in `details.advisories` alongside the existing counts.
  - Stale `.lighthouseci/` and `.reddoor-a11y/` directories are removed before each run so a failed spawn can't masquerade as success by leaving last run's data in place.

## 0.1.0

### Minor Changes

- daf5ec4: Initial public release: configs, audits, recipes, inventory, CLI.
