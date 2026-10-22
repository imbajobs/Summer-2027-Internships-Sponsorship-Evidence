import { z } from "zod";
import { jobSchema, REPOSITORIES, snapshotSchema, type Snapshot } from "./generator";

const searchSchema = z.object({
  items: z.array(z.object({ slug: z.string().regex(/^[a-z0-9-]+$/) })),
  total: z.number().int().nonnegative(), page: z.literal(1),
});
export type CollectOptions = {
  baseUrl?: string; candidateLimit?: number; rowLimit?: number; maxAgeDays?: number;
  fetcher?: typeof fetch; clock?: () => Date; pause?: (ms: number) => Promise<void>;
};

/** Read-only public API collection. Hard failures never produce publishable empty lists. */
export async function collect(options: CollectOptions = {}): Promise<Snapshot> {
  const base = new URL(options.baseUrl ?? "https://imbajobs.com");
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Base URL must be an HTTPS origin without credentials, path, query, or fragment");
  }
  const candidateLimit = options.candidateLimit ?? 30;
  const rowLimit = options.rowLimit ?? 20;
  const maxAgeDays = options.maxAgeDays ?? 7;
  if (![candidateLimit, rowLimit].every((n) => Number.isInteger(n) && n >= 1 && n <= 100) ||
    !Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 30) throw new Error("Invalid collection limits");
  const fetcher = options.fetcher ?? fetch;
  const clock = options.clock ?? (() => new Date());
  const pause = options.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  async function read(url: string): Promise<{ value: unknown; fetchedAt: string }> {
    // Below the public endpoint's 120/minute limit, including worker overlap headroom.
    await pause(600);
    const response = await fetcher(url, { signal: AbortSignal.timeout(30_000), redirect: "error", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Public API request failed with HTTP ${response.status}`);
    return { value: await response.json(), fetchedAt: clock().toISOString() };
  }
  const searches: Snapshot["searches"] = [];
  for (const repo of REPOSITORIES) {
    const url = new URL("/api/jobs", base);
    url.search = new URLSearchParams({ country: "US", type: repo.type, q: repo.q, sponsor: repo.sponsor, limit: String(candidateLimit), page: "1" }).toString();
    const response = await read(url.href);
    const result = searchSchema.parse(response.value);
    if (result.items.length > candidateLimit || result.total < result.items.length || (result.total > 0 && result.items.length === 0)) {
      throw new Error("Inconsistent search result; refusing an apparent empty/truncated response");
    }
    searches.push({ repository: repo.slug, url: url.href, fetchedAt: response.fetchedAt, total: result.total, candidates: result.items.map((i) => i.slug) });
  }
  const details: Snapshot["details"] = [];
  const slugs = [...new Set(searches.flatMap((s) => s.candidates))].sort();
  for (const slug of slugs) {
    const url = new URL(`/api/jobs/${slug}`, base).href;
    const response = await read(url);
    const job = jobSchema.parse(response.value);
    if (job.slug !== slug) throw new Error("Detail response does not match requested slug");
    details.push({ url, fetchedAt: response.fetchedAt, job });
  }
  return snapshotSchema.parse({ version: 1, capturedAt: clock().toISOString(), baseUrl: base.origin, candidateLimit, rowLimit, maxAgeDays, searches, details });
}
