---
name: perf-test
description: Run all k6 performance tests, upload results to Firestore, and compare against the previous run for that environment. Use when the user says "perf-test" or asks to run performance tests and generate a report.
disable-model-invocation: true
---

# Performance Test Runner

Run all k6 scenarios against a Virtual Care environment, upload the results to Firestore, and compare them against the previous run stored in Firestore for that same environment.

## Invocation

The user will say: `perf-test dev`, `perf-test uat`, or `perf-test local`

The argument specifies which environment to target. If no environment is provided, ask the user.

## Environment Configuration

Credentials and base URLs are defined in `k6/config/env.js`. The file exports `BASE_URL`, `USERNAME`, and `PASSWORD` based on the target environment.

| Environment | BASE_URL | Credentials |
|---|---|---|
| `local` | `http://localhost:3000` | Same defaults as dev; override if local DB differs |
| `dev` (default) | `https://ca.walkin.dev.gcp.trchq.com` | Defaults in `env.js` |
| `uat` | `https://uat-test.virtualcare.thinkresearch.com` | Defaults in `env.js` |

When running tests, pass the environment via the `ENV` variable:

```bash
k6 run -e ENV=local k6/scenarios/login-load.js
k6 run -e ENV=dev k6/scenarios/login-load.js
k6 run -e ENV=uat k6/scenarios/full-journey.js
```

If no environment is provided, default to `local`.

For `ENV=local`, ensure the Rails back-end is running on port 3000 before starting tests.

To stop system to use system env vars add the following after k6 run statement,

`k6 run --include-system-env-vars=false ...`

## Workflow

Firestore is the single source of truth for previous results. Every run's "previous" values come from the most recent `performance_runs` document for the target environment in Firestore, never from a local file.

### Step 1: Run Tests

Run these two commands sequentially from the `vc-performance` project root:

```bash
cd /path/to/vc-performance

# 1. Login-load (dev profile, gives login feature data)
k6 run -e ENV={env} --summary-export=login-summary.json k6/scenarios/login-load.js

# 2. Full-journey with smoke profile (gives homepage, dashboard, chat, appointment, forms)
k6 run -e ENV={env} -e PROFILE=smoke --summary-export=full-journey-summary.json k6/scenarios/full-journey.js
```

Use `block_until_ms: 120000` for each run — tests can take up to 90s.

k6 exits non-zero (e.g. exit code 99) whenever a threshold is crossed — this is expected and does **not** mean the workflow failed. Threshold breaches are the signal this skill exists to surface. Only treat a run as failed if it errors out before writing the `--summary-export` JSON file (e.g. connection refused, script/compile error).

### Step 2: Upload Metrics and Compare Against the Previous Firestore Run

After both k6 runs complete, run:

```bash
node scripts/upload-metrics.js {env} login-summary.json full-journey-summary.json
```

This script:

1. Reads the two `--summary-export` JSON files and maps per-feature `avg` and `p(95)` values for the current run.
2. Queries Firestore for the most recent `performance_runs` document where `environment == {env}` — this is the **previous** run for this environment. Its current values become this run's "previous" values.
3. Determines pass/fail per feature by comparing current p95 against the thresholds in `scripts/thresholds.js`.
4. Writes a new `performance_runs` document to Firestore with both previous and current values per feature.
5. Prints a comparison table (previous vs. current, per feature) to the terminal, built entirely from the previous Firestore document and this run's results.

The live dashboard at [https://virtualcare-performance.web.app/](https://virtualcare-performance.web.app/) reflects this run immediately — its RUN DATE dropdown (per environment) lists every past run, so past runs remain browsable, not just the latest. Firestore project: `virtualcare-internal`.

If the upload/query fails (e.g. no service account configured), report the error to the user — there is no local fallback, since previous results only exist in Firestore.

If the printed comparison table shows `—` for **Current** Avg/p95 on features that the k6 run actually exercised, that indicates `upload-metrics.js` failed to parse the `--summary-export` JSON (e.g. a k6 version whose summary format changed) — not that there is no data. Investigate the script's parsing logic against the actual JSON shape rather than assuming the feature simply wasn't measured.

### Step 3: Present the Comparison

Relay the comparison table printed by the script in the chat response — do not write it to a file. Present it as a markdown table with columns: Feature | p95 Threshold | Previous Avg | Previous p95 | Current Avg | Current p95 | Status (`{PREV} → **{CURR}**`).

Follow with a short **Insights** section (3–5 bullets) covering regressions, improvements, threshold breaches, and any features not measured — derived only from the previous vs. current values sourced from Firestore in Step 2.

