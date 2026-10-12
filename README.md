# SOTW public semantic checker

This standalone software tests a small, declared part of
[Statistics of the World](https://statisticsoftheworld.com). It contains only
the public checker, its offline fixtures and a manual GitHub-hosted workflow.
It does not contain SOTW's private application, database credentials or source
capture archive. It is not a general hosting/monitoring service or an uptime
guarantee.

The checker makes four bounded GETs to SOTW's own public software: GDP latest,
core data coverage, recorded GDP and an exact-pin replay. It preserves valid
zero/missing/withheld source states, fails malformed replies, and hashes exact
response bytes and source observations while saving no raw response bodies or
values. Real check clocks/elapsed durations and failures are retained as CI
artifacts. No source-provider requests, retries or SOTW write credentials are
used. Offline tests need only Node22: `node scripts/check-external-quality-observer.mjs`.

The workflow is manual-only and has not been activated or published by this
package preparation. It restricts execution to the repository default branch,
uses immutable official action pins, contents-read permissions, a standard
Ubuntu runner and a three-minute timeout. The observation CLI runs only in
GitHub-hosted schedule/manual context. Uploads use unique run/attempt names,
30-day retention and SHA256-bound manifests; originals are not overwritten by
reruns. Failed/cancelled artifact uploads remain unobserved.

GitHub's [standard public-runner free-use conditions](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
and [software-project usage terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions)
still apply. This is the software-testing project associated with SOTW's public
data product, not unrelated compute or an Actions resale service.

A future schedule must have an explicit prospective policy start. Candidate
cadence is `17 */2 * * *` UTC, but this package enables no schedule. GitHub can
[delay/drop scheduled jobs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
and supplies no exact nominal schedule instant. Observations belong to actual
first-start two-hour buckets; manual checks and reruns do not fill scheduled
coverage. Missing/incomplete/ambiguous buckets stay visible and the summary
never emits an uptime percentage. Original outside-host failure artifacts can
be recovered after a SOTW outage only while GitHub retains them; verified copies
must be archived before expiry if longer history is needed.

Artifacts are untrusted data. A consuming system must independently verify
GitHub repository/workflow/default-ref/commit/run-attempt identity, GitHub
artifact archive digest, safe members and the report manifest/script SHA.
`validateObservationReport` validates shape, not GitHub provenance. Use a narrow
read-only importer; no push token is provided to the checker.

`public-results/local-qualification.json` records only a bounded desktop parser
qualification against public SOTW GETs. It is explicitly local-qualification,
not a GitHub-hosted observation, cannot fill scheduled coverage and establishes
no sustained operating history. The package manifest binds all included bytes.
