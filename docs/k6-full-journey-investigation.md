# Full-journey investigation — 2026-09-29

The supplied five-VU run reached the API but encountered tech-pack/style HTTP 502 responses, a purchase-order HTTP 500 and a work-order HTTP 409 reporting an unavailable reserved number. The user interrupted the run at about two minutes. The errors affected separate journey attempts; the log does not establish that every flow failed.

## Changes

- Purchase-order shipment date now defaults to 30 days ahead instead of the stale `2026-09-28`. `LUMINAR_SHIPMENT_DATE` can override it with an approved date. This removes a fixture issue; it does not establish the cause of the HTTP 500.
- Work-order creation now checks that reservation returns a nonempty ID before posting the order. No retry was added to hide reservation conflicts or server failures.
- Full-journey completion is checked in `finally`, so early exits and exceptions record a failed completion check instead of potentially passing on preceding successful checks alone.

## Requested verification

Executed only the `full-journey` scenario with one VU and one iteration using `npm run test:performance -- full-journey`. The first sandbox attempt could not resolve the QA hostname; the network-enabled execution completed successfully.

Actual QA run: `k6/results/2026-09-29T13-20-32-229Z-full-journey-9457fac4/`.

- Full journey completed through item receipt: 1 pass, 0 failures.
- HTTP requests: 24; HTTP failure rate: 0%.
- Checks: 60 passed, 0 failed.
- Execution: approximately 18.6 seconds including setup.
- HTTP p95: 3759.46 ms. This exceeds the load suite's provisional 3000 ms target; the functional scenario gates checks, not latency.
- PDF generated and verified as a three-page PDF.

## Outstanding investigation

The sequential success does not resolve or reproduce the concurrent failures. The repository contains the k6 client suite, not the API/gateway implementation or server logs. Investigate API exceptions for purchase creation, upstream health/timeouts for the 502s, and reservation ownership/atomicity for the work-order 409. Shared role accounts are a possible contributor to reservation contention, not a confirmed cause. Each journey uploads roughly 23 MB of fixture files; correlate upload traffic and load-generator resources with server telemetry. Do not claim a five-VU capacity pass from this single-user result. No load profile was rerun.
