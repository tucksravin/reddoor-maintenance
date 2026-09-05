/**
 * Re-runs the CURRENT check battery over the crawls we already stored, and
 * prints what changed.
 *
 * Every stored audit carries its whole `CrawlResult` — pages, extracts, headers,
 * DNS, HTTP probes — so the battery can be re-scored against real sites without
 * touching the network again. That makes the corpus a regression suite that no
 * fixture can be: fixtures contain the cases we thought of, and these contain
 * the ones we did not.
 *
 * The habit this serves is the one every measurement change has earned: a new
 * check's first live run has found an instrument bug every single time, and
 * every one of those bugs overstated the client's fault. Two shapes recur, and
 * this script is aimed at both:
 *
 *   1. A NEW FAIL ON OLD EVIDENCE. A check that reads a field older crawls do
 *      not carry must report `unmeasured`, never `fail` — our gap is not their
 *      defect. Any stored crawl that suddenly fails a check it predates is that
 *      bug until proven otherwise, so those are printed first and loudest.
 *
 *   2. A ROW THAT CANNOT MOVE. A check nothing ever fails is padding; one
 *      nothing can pass is measuring fashion. Neither earns a line in front of
 *      a stranger. The per-check table at the end is the greenability audit.
 *
 * The corpus is a hand-picked convenience sample — sites we chose to audit, not
 * a sample of the web. It can CHECK a claim about our checks. It cannot
 * establish a rate about anybody's website, and nothing printed here should be
 * quoted as one.
 *
 *   pnpm tsx scripts/replay-checks.mts
 *   pnpm tsx scripts/replay-checks.mts --key h1-not-name    # one check, every run
 *   pnpm tsx scripts/replay-checks.mts --all-runs           # not just newest per site
 *   pnpm tsx scripts/replay-checks.mts --fails              # every fail, with its receipt
 *   pnpm tsx scripts/replay-checks.mts --dir <path>         # report-shaped JSON on disk
 *
 * `--dir` reads the `OUT=` dumps `validate-checks.mts` writes, which is how a
 * freshly re-crawled corpus gets replayed before anything is persisted. The
 * stored audits in the database are OLD — `metas`, `links` and `scriptSrcs` are
 * absent from every one of them, and roughly twenty checks read those — so a
 * replay over the database alone can only ever exercise the half of the battery
 * that reads the fields we were already capturing.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openDb, readDbConfig } from "../src/db/client.js";
import { siteKey } from "../src/db/prospect-audits.js";
import { loadCredentialsIntoEnv } from "../src/util/credentials.js";
import { runSiteChecks, type SiteCheck } from "../src/prospect/site-checks.js";
import type { CheckStatus, ProspectAuditResult } from "../src/prospect/types.js";

loadCredentialsIntoEnv();

const args = process.argv.slice(2);
const onlyKey = ((): string | null => {
  const i = args.indexOf("--key");
  return i >= 0 ? (args[i + 1] ?? null) : null;
})();
const allRuns = args.includes("--all-runs");
const fromDir = ((): string | null => {
  const i = args.indexOf("--dir");
  return i >= 0 ? (args[i + 1] ?? null) : null;
})();
const showFails = args.includes("--fails");

const MARK: Record<CheckStatus, string> = {
  pass: "pass",
  fail: "FAIL",
  unmeasured: "????",
  "not-applicable": " -- ",
};

type Run = {
  id: string;
  url: string;
  site: string;
  createdAt: string;
  business: string | null;
  stored: SiteCheck[] | null;
  replayed: SiteCheck[];
};

function trim(s: string | null, n = 64): string {
  if (!s) return "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

type Row = {
  id: string;
  url: string;
  business: string | null;
  created_at: string;
  result_json: string;
};

/** The `OUT=` dumps, newest first, so the newest-per-site fold behaves the same
 *  way it does for database rows. */
function readDir(dir: string): Row[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const rows: Row[] = [];
  for (const f of files) {
    const path = join(dir, f);
    const json = readFileSync(path, "utf-8");
    let parsed: { url?: string; business?: string | null };
    try {
      parsed = JSON.parse(json) as { url?: string; business?: string | null };
    } catch {
      console.log(`  !! ${f}: unparseable`);
      continue;
    }
    rows.push({
      id: f,
      url: parsed.url ?? f.replace(/\.json$/, ""),
      business: parsed.business ?? null,
      created_at: new Date().toISOString(),
      result_json: json,
    });
  }
  return rows;
}

async function fromDatabase(): Promise<Row[]> {
  const db = await openDb(readDbConfig());
  try {
    return await db
      .selectFrom("prospect_audits")
      .select(["id", "url", "business", "created_at", "result_json"])
      .orderBy("created_at", "desc")
      .execute();
  } finally {
    await db.destroy();
  }
}

async function main(): Promise<void> {
  const rows: Row[] = fromDir ? readDir(fromDir) : await fromDatabase();

  const runs: Run[] = [];
  const unreadable: string[] = [];

  for (const row of rows) {
    let result: ProspectAuditResult;
    try {
      result = JSON.parse(row.result_json) as ProspectAuditResult;
    } catch (err) {
      unreadable.push(`${row.url}: unparseable result_json (${String(err)})`);
      continue;
    }
    const crawl = result.crawl?.data;
    if (!crawl || !Array.isArray(crawl.pages) || crawl.pages.length === 0) {
      unreadable.push(`${row.url}: no crawl in the stored result`);
      continue;
    }
    // The name the RUN resolved, not one we supply now. Two checks read it, and
    // handing them a better name than the audit had would replay a different
    // instrument than the one that shipped.
    const business = result.businessName ?? row.business ?? null;
    const checks = result.checks?.ok ? result.checks.data : null;
    const dns = result.dns?.ok ? result.dns.data : null;
    const http = result.http?.ok ? result.http.data : null;

    let replayed: SiteCheck[];
    try {
      replayed = runSiteChecks(crawl, checks, business, dns, http);
    } catch (err) {
      unreadable.push(
        `${row.url}: the battery THREW — ${err instanceof Error ? err.message : err}`,
      );
      continue;
    }

    runs.push({
      id: row.id,
      url: row.url,
      site: siteKey(row.url),
      createdAt: row.created_at,
      business,
      stored: result.siteChecks?.ok ? result.siteChecks.data : null,
      replayed,
    });
  }

  // Newest run per site unless asked otherwise: a site audited five times would
  // otherwise weigh five times as much in every count below.
  const newestPerSite = new Map<string, Run>();
  for (const r of runs) if (!newestPerSite.has(r.site)) newestPerSite.set(r.site, r);
  const counted = allRuns ? runs : [...newestPerSite.values()];

  const what = fromDir ? "crawls on disk" : "stored audits";
  console.log(`${rows.length} ${what} — ${runs.length} replayable, ${unreadable.length} not`);
  console.log(
    `${newestPerSite.size} distinct sites; counting ${counted.length} run(s) (${allRuns ? "all" : "newest per site"})\n`,
  );
  for (const u of unreadable) console.log(`  !! ${u}`);
  if (unreadable.length) console.log("");

  // ---- 1. What the current battery says that the stored one did not ----
  type Change = {
    run: Run;
    key: string;
    from: CheckStatus | "absent";
    to: CheckStatus;
    ev: string;
  };
  const changes: Change[] = [];
  for (const run of runs) {
    if (!run.stored) continue;
    const before = new Map(run.stored.map((c) => [c.key, c]));
    for (const now of run.replayed) {
      if (onlyKey && now.key !== onlyKey) continue;
      const was = before.get(now.key);
      const from: CheckStatus | "absent" = was ? was.status : "absent";
      if (from !== now.status) {
        changes.push({ run, key: now.key, from, to: now.status, ev: trim(now.evidence) });
      }
    }
  }

  // A brand-new check reporting `fail` against a crawl recorded before the
  // check existed is the bug shape this whole script exists to catch.
  const newFails = changes.filter((c) => c.from === "absent" && c.to === "fail");
  if (newFails.length > 0) {
    console.log(`## NEW CHECKS THAT FAIL ON OLD CRAWLS (${newFails.length}) — read these first`);
    console.log(
      "   A check added after a crawl was recorded cannot know what that crawl did not capture.",
    );
    console.log("   Each of these is an instrument bug until the evidence says otherwise.\n");
    for (const c of newFails) {
      console.log(`  ${c.key.padEnd(26)} ${c.run.site.padEnd(30)} ${c.ev}`);
    }
    console.log("");
  }

  const verdictFlips = changes.filter(
    (c) =>
      c.from !== "absent" &&
      (c.from === "pass" || c.from === "fail") &&
      (c.to === "pass" || c.to === "fail"),
  );
  if (verdictFlips.length > 0) {
    console.log(`## VERDICT REVERSALS (${verdictFlips.length}) — same evidence, opposite answer`);
    for (const c of verdictFlips) {
      console.log(
        `  ${c.key.padEnd(26)} ${c.run.site.padEnd(30)} ${c.from} -> ${c.to.toUpperCase()}  ${c.ev}`,
      );
    }
    console.log("");
  }

  const softened = changes.filter(
    (c) => c.from === "fail" && (c.to === "unmeasured" || c.to === "not-applicable"),
  );
  const hardened = changes.filter(
    (c) => (c.from === "unmeasured" || c.from === "not-applicable") && c.to === "fail",
  );
  if (softened.length || hardened.length) {
    console.log(`## RETRACTED (${softened.length}) / NEWLY CLAIMED (${hardened.length})`);
    for (const c of softened) {
      console.log(
        `  retracted  ${c.key.padEnd(26)} ${c.run.site.padEnd(30)} was a fail, now ${c.to}`,
      );
    }
    for (const c of hardened) {
      console.log(
        `  claimed    ${c.key.padEnd(26)} ${c.run.site.padEnd(30)} was ${c.from}, now a FAIL  ${c.ev}`,
      );
    }
    console.log("");
  }

  const dropped = new Set<string>();
  for (const run of runs) {
    if (!run.stored) continue;
    const now = new Set(run.replayed.map((c) => c.key));
    for (const c of run.stored) if (!now.has(c.key)) dropped.add(c.key);
  }
  if (dropped.size) console.log(`## GONE FROM THE BATTERY: ${[...dropped].join(", ")}\n`);

  // ---- 2. Greenability: can each row actually move? ----
  const perKey = new Map<
    string,
    { label: string; counts: Record<CheckStatus, number>; fails: string[] }
  >();
  for (const run of counted) {
    for (const c of run.replayed) {
      if (onlyKey && c.key !== onlyKey) continue;
      let e = perKey.get(c.key);
      if (!e) {
        e = {
          label: c.label,
          counts: { pass: 0, fail: 0, unmeasured: 0, "not-applicable": 0 },
          fails: [],
        };
        perKey.set(c.key, e);
      }
      e.counts[c.status] += 1;
      if (c.status === "fail") e.fails.push(run.site);
    }
  }

  console.log(`## EVERY CHECK OVER ${counted.length} SITES`);
  console.log(
    `${"key".padEnd(28)}${"pass".padStart(5)}${"fail".padStart(6)}${"????".padStart(6)}${" n/a".padStart(6)}   verdict`,
  );
  const sorted = [...perKey.entries()].sort((a, b) => b[1].counts.fail - a[1].counts.fail);
  for (const [key, e] of sorted) {
    const decided = e.counts.pass + e.counts.fail;
    let verdict = "";
    if (decided === 0) verdict = "NEVER REACHES A VERDICT";
    else if (e.counts.fail === 0) verdict = "nobody fails it";
    else if (e.counts.pass === 0) verdict = "NOBODY PASSES IT";
    console.log(
      `${key.padEnd(28)}${String(e.counts.pass).padStart(5)}${String(e.counts.fail).padStart(6)}${String(e.counts.unmeasured).padStart(6)}${String(e.counts["not-applicable"]).padStart(6)}   ${verdict}`,
    );
  }
  console.log("");

  const never = sorted.filter(([, e]) => e.counts.pass + e.counts.fail === 0);
  const noFails = sorted.filter(([, e]) => e.counts.fail === 0 && e.counts.pass > 0);
  const noPasses = sorted.filter(([, e]) => e.counts.pass === 0 && e.counts.fail > 0);
  console.log(
    `silent on every site: ${never.length}  |  nobody fails: ${noFails.length}  |  nobody passes: ${noPasses.length}`,
  );
  if (noPasses.length) {
    console.log(
      "\nNOBODY PASSES — each is either a real universal fault or a check measuring fashion:",
    );
    for (const [key, e] of noPasses)
      console.log(`  ${key.padEnd(28)} ${e.counts.fail} of ${counted.length}`);
  }

  // Every fail, with its receipt. The point is to read the EVIDENCE, not the
  // count: a check can be firing at a believable rate and still be firing on a
  // claim that does not follow from what it saw.
  if (showFails) {
    console.log("\n## EVERY FAIL, WITH ITS EVIDENCE");
    for (const [key, e] of sorted) {
      if (e.counts.fail === 0) continue;
      console.log(
        `\n${key}  (${e.counts.fail} of ${e.counts.pass + e.counts.fail} with a verdict)`,
      );
      for (const run of counted) {
        const c = run.replayed.find((x) => x.key === key);
        if (c?.status !== "fail") continue;
        console.log(`  ${run.site.padEnd(30)} ${trim(c.evidence, 90)}`);
      }
    }
  }

  // ---- 3. Per-run totals, so a run that collapsed is visible ----
  if (onlyKey) {
    console.log(`\n## ${onlyKey}, every counted run`);
    for (const run of counted) {
      const c = run.replayed.find((x) => x.key === onlyKey);
      console.log(
        `  ${MARK[c?.status ?? "unmeasured"]} ${run.site.padEnd(32)} ${trim(c?.evidence ?? null, 80)}`,
      );
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
