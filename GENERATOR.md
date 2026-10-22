# Refresh integration

This folder is a complete repository payload. Initial README is a dated local snapshot. Daily refresh becomes configured only when the coordinator publishes the workflow on the repository default branch with Actions enabled; no external activation occurred during artifact generation.

Files: `README.md`, `data/source-snapshot.json`, `data/manifest.json`, `.github/workflows/refresh.yml`, `.github/scripts/refresh.mjs`, `.github/scripts/refresh.test.mjs`, `.github/scripts/build.json`, `.github/scripts/source/{refresh,collect,generator}.ts`, `.gitignore`, and `THIRD_PARTY_NOTICES.txt`.

The prebuilt ESM bundle runs on Node.js 24 with no npm install, PAT, private checkout, or private database access. Zod 4.6.7 is bundled; versions and bundle SHA-256 are recorded in build.json. Source files are included for review. Rebuild in the original development repository with its installed esbuild 0.25.12, bundle `.github/scripts/source/refresh.ts` for `platform=node`, `target=node24`, `format=esm`, and update the recorded hash.

```sh
node --test .github/scripts/refresh.test.mjs
node .github/scripts/refresh.mjs --snapshot data/source-snapshot.json --out .github-refresh
# Live read-only dry run, writes staging only:
node .github/scripts/refresh.mjs --out .github-refresh
```

One live run makes at most 31 sequential public API reads: one search capped at 30 candidates and at most 30 detail requests, spaced by 600 ms. Output is capped at 20 rows. The job's stored flag, quote polarity, original description, cohort text and dates must agree. Failures do not overwrite the repository README. Empty validated samples are valid results, with explicit empty-state copy.

Workflow runs daily at 37 minutes past 13:00 UTC, plus manual dispatch; GitHub can delay or disable scheduled runs. It uses only this repository's default GITHUB_TOKEN with contents:write, serial concurrency and a 10-minute limit. Collection/tests must succeed before files are copied from runner staging, and git diff skips the commit when staged content is unchanged. No token is printed or embedded in these artifacts.

Coordinator activation: publish this entire folder including hidden `.github` files, confirm the workflow is on the default branch and Actions write permissions are allowed, trigger and inspect one manual run, and confirm README/data hashes and the next scheduled run. The `--scheduled` status is accepted only inside real GitHub Actions; local dry runs keep the inactive status. A successful workflow render says it was refreshed by Actions with a daily schedule configured. Never describe this as active before that activation check.
