import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refresh, generate, REPOSITORIES, selectJobs, postingPolarity } from "./refresh.mjs";
const snapshot = JSON.parse(await readFile(new URL("../../data/source-snapshot.json", import.meta.url), "utf8"));

test("bundle owns exactly this repository and deterministic snapshot output", () => {
  assert.equal(REPOSITORIES.length, 1);
  assert.equal(REPOSITORIES[0].slug, snapshot.searches[0].repository);
  assert.deepEqual(generate(snapshot), generate(JSON.parse(JSON.stringify(snapshot))));
});
test("offline dry run writes a complete generation to staging", async () => {
  const dir = await mkdtemp(join(tmpdir(), "github-evidence-test-"));
  try {
    const a = join(dir, "a"), b = join(dir, "b");
    await refresh({ out: a, snapshotInput: snapshot });
    await refresh({ out: b, snapshotInput: snapshot });
    for (const file of ["README.md", "data/source-snapshot.json", "data/manifest.json"]) {
      assert.equal(await readFile(join(a, file), "utf8"), await readFile(join(b, file), "utf8"));
    }
    const text = await readFile(join(a, "README.md"), "utf8");
    assert.ok(text.includes("utm_source=github"));
    assert.ok(text.includes("automatic daily refresh is not active"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("API failure preserves existing staged README and produces no successful result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "github-evidence-failure-"));
  try {
    await writeFile(join(dir, "README.md"), "last known good");
    await assert.rejects(refresh({ out: dir, fetcher: async () => new Response("unavailable", { status: 503 }) }));
    assert.equal(await readFile(join(dir, "README.md"), "utf8"), "last known good");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("a valid empty result is explicit and incomplete capture fails closed", () => {
  const empty = structuredClone(snapshot); empty.details = [];
  empty.searches.forEach((s) => { s.candidates = []; s.total = 0; });
  assert.match(generate(empty)[REPOSITORIES[0].slug], /No validated rows in this bounded sample/);
  const incomplete = structuredClone(snapshot); incomplete.details = [];
  assert.throws(() => generate(incomplete), /Missing detail/);
});
test("stale or inactive detail can never reach a displayed row", () => {
  const inactive = structuredClone(snapshot); inactive.details.forEach((d) => { d.job.isActive = false; });
  assert.equal(selectJobs(inactive, REPOSITORIES[0]).rows.length, 0);
});
test("local runs cannot claim an activated GitHub Actions refresh", async () => {
  const dir = await mkdtemp(join(tmpdir(), "github-evidence-status-"));
  const old = process.env.GITHUB_ACTIONS;
  try {
    delete process.env.GITHUB_ACTIONS;
    await assert.rejects(refresh({ out: dir, snapshotInput: snapshot, scheduled: true }), /actual GitHub Actions/);
  } finally {
    if (old === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = old;
    await rm(dir, { recursive: true, force: true });
  }
});

test("stored polarity errors cannot enter the public list", () => {
  const cases = [
    ["sponsors", "At this time, Capital One will not sponsor a new applicant for employment authorization."],
    ["sponsors", "Provide immigration process guidance and explain sponsorship program and timelines."],
    ["no_sponsor", "Security Clearance Type:"],
  ];
  for (const [status, quote] of cases) assert.notEqual(postingPolarity(quote), status);
});
