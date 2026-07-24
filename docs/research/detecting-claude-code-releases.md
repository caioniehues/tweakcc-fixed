# Detecting new @anthropic-ai/claude-code releases

> **Location note:** `docs/research/` is a new directory chosen for this report. The
> repo had no prior research convention; agent docs otherwise live under `docs/agents/`.
> **Investigated:** 2026-07-24. Live endpoints marked "verified via curl on 2026-07-24".

## TL;DR — recommendation

- **Mechanism:** GitHub Actions `schedule:` cron workflow that runs `npm view @anthropic-ai/claude-code version`
  (or curls the dist-tags endpoint), compares the `latest` tag against a version string committed in the
  repo, and on a mismatch triggers the pipeline (open a PR / dispatch the patch job).
- **Comparison state:** store the last-seen version in a tracked file (e.g. reuse the CC version already
  referenced in `README`/prompt-extraction metadata, or a dedicated `.last-cc-version`). Compare `latest`
  dist-tag → file. This is idempotent and survives across runs without external state.
- **Cadence:** poll **every 30 min** (`*/30 * * * *`). Median gap between releases is ~24h and there are
  ~27 releases per 30 days (roughly one per business day), so 30 min gives low latency at negligible cost.
  Do **not** rely on tight timing — GitHub cron is best-effort and drops jobs under load (see §4).
- **Source of truth:** poll **npm**, not GitHub Releases. npm is the leading edge; the GitHub Release for a
  version is published **~1.5 h after** the npm publish (verified, §3).
- **Cheap polling:** the abbreviated-metadata endpoint supports **ETag + conditional GET → 304** (verified,
  §1). The tiny `dist-tags` endpoint is uncached and always fresh — simplest thing to poll.

---

## 1. npm registry API

Docs: npm registry API — https://github.com/npm/registry/blob/master/docs/REGISTRY-API.md
and package-metadata format — https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md

**dist-tags endpoint** (smallest, always fresh) — verified via curl on 2026-07-24:

```
curl -sS https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags
```

Response (56 bytes):

```json
{ "stable": "2.1.206", "latest": "2.1.218", "next": "2.1.218" }
```

Three dist-tags exist: **`latest`**, **`stable`** (currently pinned behind latest, at 2.1.206),
and **`next`** (currently equal to latest). For "newest shipped version" poll **`latest`**.
Response headers: `content-length: 56`, `cf-cache-status: DYNAMIC` (i.e. **not CDN-cached**, no staleness),
and **no ETag** — so conditional GET is not available here, but the body is trivially small.

**Abbreviated metadata** (supports conditional polling) — verified via curl on 2026-07-24:

```
curl -sS -D - -o /dev/null \
  -H "Accept: application/vnd.npm.install-v1+json" \
  https://registry.npmjs.org/@anthropic-ai/claude-code
```

Key headers observed:

```
content-length: 421505           # ~412 KB (vs the full doc which is much larger)
cache-control: public, max-age=300   # CDN caches for 5 min
cf-cache-status: HIT              # served from Cloudflare edge; age up to ~145s observed
etag: "85c04f3cfae1362d7e24272b8dfa4d74"
last-modified: Wed, 22 Jul 2026 21:24:24 GMT
```

Conditional GET works — re-requesting with the ETag returns **304 Not Modified, 0 bytes** (verified):

```
curl -sS -o /dev/null -w "status=%{http_code} size=%{size_download}\n" \
  -H "Accept: application/vnd.npm.install-v1+json" \
  -H 'If-None-Match: "85c04f3cfae1362d7e24272b8dfa4d74"' \
  https://registry.npmjs.org/@anthropic-ai/claude-code
# -> status=304 size=0
```

**Staleness caveat:** the abbreviated/full doc is CDN-cached with `max-age=300`, so it can lag a fresh
publish by up to ~5 min at the edge. The `dist-tags` endpoint is `DYNAMIC` (uncached) and reflects a new
publish immediately. For minimum latency poll `dist-tags`; for cheap 304-based polling use the abbreviated
doc and accept ≤5 min edge lag.

## 2. `npm view` CLI

Verified locally on 2026-07-24 (npm resolves `latest` by default):

```
$ npm view @anthropic-ai/claude-code version
2.1.218

$ npm view @anthropic-ai/claude-code dist-tags --json
[ { "stable": "2.1.206", "latest": "2.1.218", "next": "2.1.218" } ]
```

Note the `--json` form wraps the object in an **array** (npm's multi-package output shape). For a scalar in
CI, `npm view @anthropic-ai/claude-code version` (no `--json`) prints the bare `latest` version — easiest to
capture. Docs: https://docs.npmjs.com/cli/v10/commands/npm-view

## 3. GitHub releases / tags / changelog

Repo: https://github.com/anthropics/claude-code — GitHub Releases **and** tags **are** published per npm
version. Verified via `gh api` on 2026-07-24:

```
$ gh api repos/anthropics/claude-code/releases --jq '.[0:3][] | {tag,published:.published_at}'
v2.1.218  2026-07-22T21:24:56Z
v2.1.217  2026-07-21T21:35:10Z
v2.1.216  2026-07-20T22:14:00Z

$ gh api "repos/anthropics/claude-code/tags?per_page=5" --jq '.[].name'
v2.1.218 v2.1.217 v2.1.216 v2.1.215 v2.1.214
```

- **Atom feed exists and is current:** `https://github.com/anthropics/claude-code/releases.atom`
  (HTTP 200; latest entry `v2.1.218`, `updated 2026-07-22T21:24:56Z`) — verified via curl.
- **CHANGELOG.md** at `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md` is
  current (top section `## 2.1.218`) — verified via curl.
- **Lag vs npm:** the GitHub Release for 2.1.218 published `2026-07-22T21:24:56Z`, but the **npm publish
  time** for 2.1.218 (from the registry `time` field, §5) is `2026-07-22T19:55:32Z` — GitHub trails npm by
  **~1h29m**. Conclusion: **poll npm**, not GitHub, to detect a release as early as possible. The atom feed
  is a fine human-facing supplement but not the trigger.

## 4. Push vs poll

- **npm registry hooks** (`npm hook`) — a real push option, but requires an authenticated npm account +
  a hosted HTTPS receiver with signature verification, and npm's public hooks have a history of being
  unreliable/limited. Overkill here. Docs: https://docs.npmjs.com/cli/v10/commands/npm-hook
- **npm replication feed** (CouchDB `_changes` at `https://replicate.npmjs.com/`) — firehose of _all_
  packages; not worth filtering for one package. Docs: https://github.com/npm/registry/blob/master/docs/REGISTRY-API.md#replication
- **No first-party push exists for a single package.** So **poll**.
- **GitHub Actions `schedule:` cron** is the pragmatic trigger. Official semantics
  (https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule):
  - "The shortest interval you can run scheduled workflows is once every 5 minutes."
  - "The `schedule` event can be delayed during periods of high loads of GitHub Actions workflow runs.
    High load times include the start of every hour. **If the load is sufficiently high enough, some queued
    jobs may be dropped.**" → avoid `0 * * * *` (top of hour); use an offset like `*/30` starting off-hour,
    and treat any single missed run as tolerable (next poll catches up).
  - Schedules only run from workflow files on the **default branch**.
- **`workflow_dispatch`** (manual/API/CLI trigger) and **`repository_dispatch`** (external API `POST` with a
  custom `event_type`) are the right way to _trigger the patch pipeline_ once a new version is detected —
  the scheduled poller detects, then dispatches the heavy job. Docs same page + repository_dispatch:
  https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event
- **Scheduled Claude Code cloud agents** can act as the consumer/executor of the dispatch (run the
  extraction/patch flow), or run the poll themselves on a cron — but the version _comparison_ should still
  be file-vs-`latest` for idempotency.

## 5. Release cadence (from registry `time` field)

Computed from the `time` map in the full registry doc
(`https://registry.npmjs.org/@anthropic-ai/claude-code`) on 2026-07-24:

- **474 total published versions.**
- **27 releases in the last 30 days; 58 in the last 60 days** (~roughly one per calendar day, clustering on
  business days).
- Most recent publishes (npm publish times, UTC):
  `2.1.214 07-18T00:13`, `2.1.215 07-19T00:53`, `2.1.216 07-20T20:19`, `2.1.217 07-21T19:55`,
  `2.1.218 07-22T19:55`.
- Inter-release gaps over the last 15 releases (hours):
  `6.4, 19.5, 22.3, 28.5, 71.1, 7.2, 14.9, 23.7, 23.9, 27.1, 1.8, 24.7, 43.4, 23.6, 24.0` →
  **median ≈ 24h**, occasional same-day double-publish (min 1.8h) and occasional multi-day gaps (max 71h).

**Implication:** a 30-minute poll detects a new release within ≤30 min of the npm publish while making
~48 tiny requests/day — trivial. Even hourly would be defensible; 30 min hedges against GitHub cron drops.

## 6. Prior art (npm-in-CI detection)

- **Dependabot** version-updates for the `npm` ecosystem polls the registry on a configured `schedule` and
  opens PRs when a newer version is available — the canonical "poll npm + open PR" pattern, first-party to
  GitHub. Docs: https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file
  (It tracks a _dependency_ in a manifest, though — not directly usable to watch a package this repo doesn't
  depend on, unless CC is added as a devDependency and Dependabot's PRs drive the pipeline.)
- **Renovate** similarly resolves the npm registry `latest`/dist-tags and raises update PRs on a schedule;
  its npm datasource reads the same `registry.npmjs.org` metadata described in §1.
  Docs: https://docs.renovatebot.com/modules/datasource/npm/
- **Minimal DIY pattern** (recommended here): `schedule:` → `npm view … version` → compare to a committed
  version file → `git`/PR or `repository_dispatch`. No external service, fully first-party, idempotent.

---

### Copy-paste starting point

```yaml
# .github/workflows/watch-claude-code.yml
on:
  schedule:
    - cron: '15,45 * * * *' # off-hour, twice hourly; avoids top-of-hour drops
  workflow_dispatch:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: v
        run: |
          latest=$(npm view @anthropic-ai/claude-code version)
          echo "latest=$latest" >> "$GITHUB_OUTPUT"
          prev=$(cat .last-cc-version 2>/dev/null || echo "")
          echo "changed=$([ "$latest" != "$prev" ] && echo true || echo false)" >> "$GITHUB_OUTPUT"
      - if: steps.v.outputs.changed == 'true'
        run: |
          echo "${{ steps.v.outputs.latest }}" > .last-cc-version
          # then: open a PR, or dispatch the patch pipeline (repository_dispatch)
```
