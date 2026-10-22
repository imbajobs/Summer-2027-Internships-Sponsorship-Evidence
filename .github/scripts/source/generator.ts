import { z } from "zod";
const JOB_TYPES = ["internship", "new_grad", "experienced"] as const;
const SPONSOR_STATUSES = ["sponsors", "no_sponsor", "unconfirmed"] as const;

export const REPOSITORIES = [{"slug": "Summer-2027-Internships-Sponsorship-Evidence", "type": "internship", "q": "summer 2027", "sponsor": "all"}] as const;
export type Repository = (typeof REPOSITORIES)[number];
const date = z.iso.datetime({ offset: true });
const safeUrl = z.url().refine((s) => {
  const u = new URL(s);
  return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password;
}, "Expected a public HTTP(S) URL without credentials");
const count = z.number().int().nonnegative();
const historySchema = z.object({
  filer: z.boolean(), match: z.enum(["exact", "override"]),
  latestFullYear: z.object({ fy: z.number().int(), totalApprovals: count }).nullable(),
  possiblyIncompleteFrom: z.number().int().nullable(), source: safeUrl,
});
export const jobSchema = z.object({
  id: z.string().min(1), slug: z.string().regex(/^[a-z0-9-]+$/), title: z.string().min(1),
  company: z.object({ name: z.string().min(1), slug: z.string().regex(/^[a-z0-9-]+$/), h1b: historySchema.nullable() }),
  location: z.string().nullable(), country: z.string(), jobType: z.enum(JOB_TYPES),
  sponsorStatus: z.enum(SPONSOR_STATUSES), sponsorEvidence: z.string().nullable(),
  postedAt: date, firstSeenAt: date, lastSeenAt: date, isActive: z.boolean(),
  descriptionText: z.string().nullable(), sourceUrl: safeUrl.nullable(), url: safeUrl,
});
export type ListJob = z.infer<typeof jobSchema>;
export const snapshotSchema = z.object({
  version: z.literal(1), capturedAt: date, baseUrl: safeUrl,
  candidateLimit: z.number().int().min(1).max(100), rowLimit: z.number().int().min(1).max(100),
  maxAgeDays: z.number().int().min(1).max(30),
  searches: z.array(z.object({ repository: z.string(), url: safeUrl, fetchedAt: date, total: count, candidates: z.array(z.string()) })),
  details: z.array(z.object({ url: safeUrl, fetchedAt: date, job: jobSchema })),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const normalize = (s: string) => s.normalize("NFC").replace(/\s+/gu, " ").trim();
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const href = (s: string) => new URL(s).href.replace(/[<>|\s]/gu, (c) => encodeURIComponent(c));

/** Quotes keep their original words and polarity. The ellipsis is part of the 120-code-point cap. */
export function excerpt(s: string): string {
  const chars = Array.from(normalize(s));
  return chars.length <= 120 ? chars.join("") : `${chars.slice(0, 119).join("")}…`;
}

/** Escape raw HTML, Markdown links, pipes, and line breaks from employer-controlled text. */
export function cell(s: string): string {
  return normalize(s).replace(/&/g, "&amp;").replace(/[\\|`*_{}\[\]()<>#~!]/g, (c) => `&#${c.codePointAt(0)};`);
}

export function trackedJobUrl(baseUrl: string, slug: string, repository: string): string {
  const u = new URL(`/jobs/${encodeURIComponent(slug)}`, baseUrl);
  u.search = new URLSearchParams({ utm_source: "github", utm_medium: "list", utm_campaign: repository }).toString();
  return u.href;
}

/** Narrow rules: a start year alone does not establish a graduation year. */
export function cohortEvidence(job: ListJob, repository: Repository): string | null {
  if (repository.type === "all") return null;
  if (job.jobType !== repository.type) return null;
  const text = normalize(`${job.title}. ${job.descriptionText ?? ""}`);
  const patterns = repository.type === "new_grad" ? [
    /\b(?:class of|graduating in|graduation (?:year|date)(?: of| is|:)?|graduates? of)\s+2027\b/i,
    /\b2027\s+(?:new[- ]grad(?:uate)?s?|graduates?)\b/i,
    /\b(?:new[- ]grad(?:uate)?s?|graduates?)\s*[-–:(]?\s*2027\b/i,
  ] : [/\bsummer\s*[-–,:]?\s*2027\b/i, /\b2027\s+summer\b/i];
  return patterns.map((re) => text.match(re)?.[0]).find(Boolean) ?? null;
}

/** Publication gate independent of the stored classifier flag. Ambiguity is excluded, never repaired. */
export function postingPolarity(evidence: string): "sponsors" | "no_sponsor" | "unconfirmed" {
  const text = normalize(evidence).replace(/[‘’]/g, "'");
  const no = [
    /\b(?:unable|cannot|can't|won't|will not|do not|does not|not able|not)\b.{0,100}\b(?:sponsor\w*|work visas?|employment authorization|immigration(?: related)? support)\b/i,
    /\b(?:no|without|ineligible for|not eligible for)\b.{0,70}\b(?:visa\s+)?sponsorship\b/i,
    /\b(?:visa\s+)?sponsorship\s+(?:is\s+)?(?:not available|unavailable|not offered|not supported)\b/i,
    /\b(?:u\.?s\.? citizenship|u\.?s\.? persons?)\b.{0,80}\b(?:required|only|due to)\b/i,
    /\b(?:must be|only hire|only employ|only consider)\b.{0,35}\b(?:u\.?s\.? persons?|u\.?s\.? citizens?)\b/i,
    /\bonly\s+u\.?s\.? citizens?\b/i,
  ].some((re) => re.test(text));
  // Negative/restricted language wins even if a later clause also contains a positive phrase.
  if (no) return "no_sponsor";
  const yes = [
    /\b(?:we|employer|company)\b.{0,35}\bsponsors?\b.{0,65}\b(?:visas?|international candidates|work permits?|employment authori[sz]ation)\b/i,
    /\b(?:we|company|employer)\b.{0,30}\b(?:offer|provide)\b.{0,25}\b(?:visa|immigration|h-?1-?b)\s+sponsorship\b/i,
    /\b(?:visa|immigration|h-?1-?b|work permit)\s+sponsorship\b.{0,45}\b(?:available|offered|provided|supported)\b/i,
    /\brelocation (?:support|assistance) and visa sponsorship\b/i,
    /\bsponsorship (?:is|may be) available for (?:this role|current visa holders)\b/i,
  ].some((re) => re.test(text));
  return yes ? "sponsors" : "unconfirmed";
}

export function exclusion(job: ListJob, snapshot: Snapshot, repository: Repository): string | null {
  const now = Date.parse(snapshot.capturedAt);
  if (!job.isActive) return "inactive";
  if (job.country !== "US") return "outside_us";
  if (Date.parse(job.lastSeenAt) > now || Date.parse(job.postedAt) > now || Date.parse(job.firstSeenAt) > now) return "future_date";
  if (now - Date.parse(job.lastSeenAt) > snapshot.maxAgeDays * 86_400_000) return "stale";
  if (!job.sourceUrl) return "missing_posting_source";
  if (new URL(job.url).origin !== new URL(snapshot.baseUrl).origin || new URL(job.url).pathname !== `/jobs/${job.slug}`) return "invalid_job_link";
  if (job.sponsorStatus !== "unconfirmed" && (!job.sponsorEvidence || !job.descriptionText ||
    !normalize(job.descriptionText).includes(normalize(job.sponsorEvidence)))) return "unverified_posting_evidence";
  if (job.sponsorStatus !== "unconfirmed" && postingPolarity(job.sponsorEvidence!) !== job.sponsorStatus) return "unsupported_posting_polarity";
  if (repository.type === "all" && job.sponsorStatus !== "sponsors") return "not_posting_yes";
  if (repository.type !== "all" && !cohortEvidence(job, repository)) return "unvalidated_cohort";
  return null;
}

export function selectJobs(snapshot: Snapshot, repository: Repository) {
  const search = snapshot.searches.find((s) => s.repository === repository.slug);
  if (!search) throw new Error(`Missing source search: ${repository.slug}`);
  const detailMap = new Map(snapshot.details.map((d) => [d.job.slug, d.job]));
  const excluded: Record<string, number> = {};
  const eligible: ListJob[] = [];
  const seen = new Set<string>();
  const seenSources = new Set<string>();
  for (const slug of search.candidates) {
    const job = detailMap.get(slug);
    if (!job) throw new Error(`Missing detail for ${slug}`);
    const reason = exclusion(job, snapshot, repository);
    if (reason) { excluded[reason] = (excluded[reason] ?? 0) + 1; continue; }
    eligible.push(job);
  }
  const rows = eligible.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt) || compare(a.slug, b.slug)).filter((job) => {
    const source = new URL(job.sourceUrl!); source.hash = "";
    for (const key of [...source.searchParams.keys()]) if (key.startsWith("utm_")) source.searchParams.delete(key);
    source.searchParams.sort();
    if (seen.has(job.id) || seen.has(job.slug) || seenSources.has(source.href)) { excluded.duplicate = (excluded.duplicate ?? 0) + 1; return false; }
    seen.add(job.id); seen.add(job.slug); seenSources.add(source.href); return true;
  });
  return { search, rows: rows.slice(0, snapshot.rowLimit), eligible: rows.length, excluded };
}

export function history(job: ListJob, capturedAt: string): string {
  const h = job.company.h1b;
  if (!h?.latestFullYear) return "Unknown / 未知";
  const y = h.latestFullYear;
  // The plan asks for last FY. Never substitute an older year or current partial quarter.
  const d = new Date(capturedAt);
  const lastFy = d.getUTCFullYear() + (d.getUTCMonth() >= 9 ? 0 : -1);
  if (y.fy !== lastFy) return `Unknown for FY${lastFy}; latest available FY${y.fy}: ${y.totalApprovals}`;
  const gap = h.possiblyIncompleteFrom !== null && h.possiblyIncompleteFrom <= y.fy;
  return `${y.totalApprovals} · FY${y.fy}${gap ? " · may be incomplete / 可能不完整" : ""}`;
}

export function renderReadme(snapshot: Snapshot, repository: Repository): string {
  const { search, rows, eligible, excluded } = selectJobs(snapshot, repository);
  const yearSpecific = repository.type !== "all";
  const scope = yearSpecific ? (repository.type === "new_grad"
    ? "Requires an explicit 2027 graduation/class/new-grad phrase. A 2027 start date alone is insufficient."
    : "Requires an internship classification and explicit Summer 2027 text; this is the internship season, not the graduation year.")
    : "Only posting says yes. Employer history alone never qualifies a row. Refreshed daily when scheduled; this is not a claim that every role was posted today.";
  const legend = `## Legend / 图例

- **Posting says yes / 原文表示支持**: the quote explicitly supports sponsorship and was found in the captured description. Conditions may apply; this is no promise for every candidate. 引文明确表示支持签证担保，并已与快照中的岗位正文核对；可能附有条件，不保证适用于每位申请人。
- **Posting says no / 原文表示不支持**: the posting declines sponsorship or states a citizenship/export-control restriction. Employer history never overrides it. 岗位声明不提供签证担保，或设有公民身份、出口管制限制；雇主历史不能改变此标记。
- **Unconfirmed / 未确认**: no confirmed posting-level answer. **Unconfirmed, employer history only / 未确认，仅有雇主历史** means the employer meets Imba's H-1B filer threshold; it says nothing about this role. 未能确认此岗位的签证担保政策；有雇主 H-1B 历史也不代表此岗位支持签证。
- Quotes are original-language excerpts of at most 120 Unicode characters, including an ellipsis if shortened. Read the full linked source for conditions. 引文保留原文，最多 120 个 Unicode 字符；截短处标有省略号，请查看完整原文。
- H-1B approvals are employer-wide USCIS history (initial + continuing), separate from posting evidence. Last FY is explicitly named; unavailable years stay unknown. H-1B 批准数为雇主历史（初次及续期），不代表此岗位支持签证；缺失年份保持未知。
- Posted is the API/ATS date and may fall back to ingestion time; it is not an independently verified employer publication date. First seen, last seen and source retrieval are separate UTC dates. 发布日期可能回退为入库日期，不等于已独立核实的雇主发布日期；首次、最近发现及抓取日期单独列出。`;
  const header = `# ${repository.slug}

Maintained from Imba Jobs public data. Board: free, no account required. / 来源：Imba Jobs 公开岗位数据，免费浏览。

Snapshot / 数据快照: **${snapshot.capturedAt}** (UTC). US roles only / 仅美国岗位。

Local snapshot; automatic daily refresh is not active. / 本文件为本地快照，尚未启用每日自动更新。

${scope}

Bounded sample: ${search.candidates.length} of ${search.total} search matches inspected (newest API results); ${eligible} eligible, ${rows.length} shown. Not an exhaustive market count. Missing matches can exist outside this sample.

API search matches title/company, not description; cohort checks use the captured detail text. / API 仅按标题或公司名称搜索，年份核验再使用快照中的岗位详情。

${legend}

## Jobs / 岗位
`;
  const table = rows.length ? `
| Company / 公司 | Title / 岗位（Imba） | Location / 地点 | Posting sponsorship evidence / 原文签证证据 | H-1B approvals last FY / 上财年雇主历史 | Posted / 发布（UTC） | First seen / 首次发现 | Last seen / 最近发现 | Cohort evidence / 年份证据 | Posting source / 岗位原文 |
|---|---|---|---|---|---|---|---|---|---|
${rows.map((job) => {
    const status = job.sponsorStatus === "sponsors" ? "Posting says yes / 原文表示支持" : job.sponsorStatus === "no_sponsor" ? "Posting says no / 原文表示不支持"
      : job.company.h1b?.filer ? "Unconfirmed, employer history only / 未确认，仅有雇主历史" : "Unconfirmed / 未确认";
    const quote = job.sponsorStatus !== "unconfirmed" && job.sponsorEvidence ? `: “${cell(excerpt(job.sponsorEvidence))}”` : "";
    const cohort = cohortEvidence(job, repository);
    return `| ${cell(job.company.name)} | [${cell(job.title)}](${trackedJobUrl(snapshot.baseUrl, job.slug, repository.slug)}) | ${cell(job.location ?? "Unknown / 未知")} | ${status}${quote} | ${cell(history(job, snapshot.capturedAt))} | ${job.postedAt} | ${job.firstSeenAt} | ${job.lastSeenAt} | ${cohort ? `“${cell(excerpt(cohort))}”` : "Not filtered / 未按年份筛选"} | [Original / 原文](<${href(job.sourceUrl!)}>) |`;
  }).join("\n")}
` : `
No validated rows in this bounded sample. ${yearSpecific ? "The retrieved data did not establish the required cohort and evidence checks; no graduation year was inferred from dates or employer history." : "No active, recent posting with verified positive evidence passed validation."}

当前有限样本中没有通过核验的岗位。未根据发布日期或雇主历史推断毕业年份。
`;
  return `${header}${table}
## Sources and method / 来源与方法

- [Public search](<${href(search.url)}>) retrieved ${search.fetchedAt}; total is the API search count at retrieval, not a count of validated jobs.
- Each row's public detail API (/api/jobs/SLUG) was retrieved within this snapshot; exact retrieval timestamps and descriptions are in the accompanying source snapshot when distributed.
- [USCIS H-1B Employer Data Hub](https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub), via Imba's matched employer record. No fresh USCIS lookup was performed. Public API does not expose the history import date; snapshot date is not a USCIS data update date.
- Job links use utm_source=github, utm_medium=list, utm_campaign=${repository.slug}.
- Active in Imba and last seen within ${snapshot.maxAgeDays} days of snapshot. Employer openings can close after capture; original employer pages were not independently revalidated by this generator.
- Exclusions in inspected sample: ${Object.keys(excluded).sort().map((k) => `${k}=${excluded[k]}`).join(", ") || "none"}.
- Sponsorship and cohort labels require posting evidence; employer history and posting dates never establish them. 签证担保及年份标记须有岗位原文依据，不根据雇主历史或发布日期推断。
`;
}

/** Reject incomplete snapshots rather than turn failed collection into an empty success. */
export function generate(snapshotInput: unknown): Record<string, string> {
  const snapshot = snapshotSchema.parse(snapshotInput);
  return Object.fromEntries(REPOSITORIES.map((repo) => [repo.slug, renderReadme(snapshot, repo)]));
}
