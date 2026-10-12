# SOTW public semantic checker

This public software tests a small, declared part of
[Statistics of the World](https://statisticsoftheworld.com). It contains the
checker, offline fixtures and a GitHub-hosted workflow. It contains no private
application, database credentials, source capture archive or SOTW write token.

The first [manual GitHub-hosted run](https://github.com/dregon03/sotw-status/actions/runs/38255310564)
passed all four checks on 12 October 2026, from source commit
`8a6bf2e5db4fe8824caaadc6fbf55e071d8bcafd`. Its original artifact ID is
`11749831608`, archive SHA256
`bd7e03813a4a3cf195ef23b724ae9df610615cef1e0fbd92cabce12645d5bb3e`.
That run used the original manual-only workflow and 30-day artifact retention.
It establishes one successful observation, not sustained operating history.

The checker makes four bounded GETs to SOTW's public software: GDP latest,
core data coverage, recorded GDP and an exact-pin replay. It preserves valid
zero/missing/withheld source states, fails malformed replies, and hashes exact
response bytes and source observations while saving no raw bodies or values.
No source-provider requests or retries are used. Offline tests need only Node22:

```
node scripts/check-external-quality-observer.mjs
node scripts/check-external-quality-publisher.mjs
```

## Prospective routine checks

Routine checks were configured on 12 October 2026 at 14:15 UTC for the
prospective policy beginning at 14:17 UTC. The configured cadence is
`17 */2 * * *` UTC. At the read-only audit on 12 October 2026 at 19:16 UTC,
GitHub exposed no scheduled runs; scheduled operation remains unverified.
Scheduled jobs require `SOTW_EXTERNAL_ENABLED=true` and a valid prospective
`SOTW_EXTERNAL_POLICY_START`. Before that timestamp, the policy skips
observation and publication. Manual runs do not fill scheduled coverage.
There are no pull-request or push triggers.

GitHub can [delay or drop scheduled jobs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
It supplies no exact nominal schedule instant. Observations belong to their
actual first-start two-hour buckets; manual checks and reruns cannot replace
the first scheduled attempt or fill a gap. Missing, incomplete and ambiguous
buckets stay visible. The checker emits no uptime percentage or service guarantee.
One external vantage and four sampled checks do not measure the whole platform,
source-publisher availability, release latency or every data definition.

Both jobs use standard Ubuntu runners, immutable official action pins, Node22,
no dependency installs/cache and a three-minute timeout each. The observation
job has contents-read access. It exports a report of at most 64 KiB and its
manifest of at most 4 KiB as base64 job outputs, without any publishing token.
The separate publisher job alone has contents-write permission, and exposes its
short-lived token only to the publisher step. Metadata GETs are unauthenticated
and public; the token is sent only to narrowly allowed Git-data mutations at
`api.github.com`. No private application or deployment credential is used.

## Report preservation and provenance

Routine runs create no Actions artifacts. The publisher atomically adds these
three files in one public Git commit under
`public-results/runs/<GitHub-run-id>/<attempt>/`:

- `observation.json`: exact original observation/checkpoint bytes, including failures.
- `manifest.json`: exact original observer manifest binding those report bytes.
- `publication.json`: run, source-commit and code-hash coordinates, plus file hashes.

The publisher validates closed report shapes, budgets, hashes and GitHub
repository/workflow/default-ref/run-attempt identity. It refuses any existing
attempt path, including partial attempts. It uses a non-force branch update;
concurrent changes fail without retry, rebase, replacement or deletion. Blob,
tree or commit failures before the branch update cannot partially publish a
report. Failed report transfer, publication, cancellation or missing checkpoint
leaves that attempt unobserved. GitHub may redact job outputs it suspects are
secrets; a missing output is not reconstructed or counted as success.

A trusted consuming system must independently verify:

1. The public repository ID `1415634723`, owner/name `dregon03/sotw-status`,
   workflow ID `382172461`, path `.github/workflows/external-quality.yml`,
   default ref `refs/heads/main`, source commit, event, run ID and attempt.
2. The actual GitHub run attempt and trusted source-code bytes at its source
   commit. The observation script SHA256 remains
   `cb7186235d527fe2bba617172e36b5379869ebbec20c34e26153e89c05eefb24`.
3. The immutable publication commit/tree and the three exact safe paths added
   together, then the report and manifest byte lengths/SHA256 values and the
   publication code hashes. Ref names alone are not immutable evidence.
4. The observation report's semantics and policy start. Shape validation alone
   does not establish GitHub provenance. Accept recorded failures and incomplete
   checkpoints honestly; do not replace them with later reruns.

Repository administrators can alter branches or remove history; consumers
should archive verified commit-bound copies for their own retention needs.
These public reports contain hashes and qualified counts, not underlying raw
response bodies or source prices. `public-results/local-qualification.json`
is an earlier desktop parser check, explicitly outside GitHub-hosted coverage.
`PACKAGE-MANIFEST.json` binds only seven reviewed static project files. It
excludes itself and all future `public-results/runs/**` report files; each run
has its own independently bound manifest and publication coordinates.

## Free-use boundary

GitHub's [standard public-runner free-use conditions](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
and [software-project usage terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions)
apply. This is SOTW's public software-testing project, with four bounded product
checks, not unrelated compute or an Actions resale service. No larger runner,
cache, paid service or routine artifact upload is configured. Artifact-storage
billing was not independently proven free, so routine reports use public Git
instead. The first manual artifact remains subject to its original retention.

Each routine report publication is bounded below 80 KiB, at 12 scheduled slots
per day (at most about 343 MiB/year of scheduled added report bytes at that
limit, excluding Git overhead and manual/rerun attempts). Real reports are
usually smaller. GitHub repository size and acceptable-use limits still apply;
this is not a promise of unlimited permanent free storage. No global account
budget or authorization scope is changed by this project.
