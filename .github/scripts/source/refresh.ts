import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { collect } from "./collect";
import { generate, selectJobs, REPOSITORIES, snapshotSchema, postingPolarity, type Snapshot } from "./generator";
export { collect, generate, selectJobs, REPOSITORIES, snapshotSchema, postingPolarity };

export async function refresh({ out, snapshotInput, fetcher, scheduled = false }: {
  out: string; snapshotInput?: unknown; fetcher?: typeof fetch; scheduled?: boolean;
}) {
  if (resolve(out) === process.cwd()) throw new Error("Use a staging directory, never the repository root");
  const snapshot: Snapshot = snapshotInput === undefined ? await collect({ fetcher }) : snapshotSchema.parse(snapshotInput);
  const repo = REPOSITORIES[0];
  const selection = selectJobs(snapshot, repo);
  let readme = generate(snapshot)[repo.slug];
  if (scheduled) {
    if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Scheduled status requires actual GitHub Actions execution");
    readme = readme.replace("Local snapshot; automatic daily refresh is not active. / 本文件为本地快照，尚未启用每日自动更新。",
      "Refreshed by GitHub Actions; a daily schedule is configured. / 已由 GitHub Actions 更新，并已配置每日更新计划。");
  }
  const relevant = { ...snapshot, searches: snapshot.searches.filter((s) => s.repository === repo.slug),
    details: snapshot.details.filter((d) => selection.search.candidates.includes(d.job.slug)) };
  const source = JSON.stringify(relevant, null, 2) + "\n";
  const manifest = JSON.stringify({ version: 1, repository: repo.slug, capturedAt: snapshot.capturedAt,
    inspected: selection.search.candidates.length, eligible: selection.eligible, rows: selection.rows.length,
    excluded: selection.excluded, sourceSha256: createHash("sha256").update(source).digest("hex"),
    readmeSha256: createHash("sha256").update(readme).digest("hex") }, null, 2) + "\n";
  await mkdir(resolve(out, "data"), { recursive: true });
  for (const [path, body] of [["README.md", readme], ["data/source-snapshot.json", source], ["data/manifest.json", manifest]]) {
    const dest = resolve(out, path); const tmp = dest + ".tmp";
    await writeFile(tmp, body, "utf8"); await rename(tmp, dest);
  }
  return { repository: repo.slug, rows: selection.rows.length, inspected: selection.search.candidates.length };
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: "string", default: ".github-refresh" },
    snapshot: { type: "string" }, scheduled: { type: "boolean" } } });
  const snapshotInput = values.snapshot ? JSON.parse(await readFile(resolve(values.snapshot), "utf8")) : undefined;
  console.log(JSON.stringify(await refresh({ out: values.out!, snapshotInput, scheduled: values.scheduled })));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error("Refresh failed; staging was not approved for publication. Existing repository README was not replaced."); process.exitCode = 1; });
}
