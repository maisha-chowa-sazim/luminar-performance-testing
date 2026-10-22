# Luminar k6 performance testing

Reusable API business flows, functional smoke tests, independent role-based load levels (5, 10, 20, 50 and 100 total VUs), and a configurable arrival-rate journey test.

Use Node.js 22+ and k6 (validated with 2.2.0). Configure local `.env` credentials, tenant IDs and seeded QA data as described in the [k6 run guide](k6/README.md). The npm runner loads `.env` automatically.

```bash
npm ci
npm run test:smoke
npm run test:load:5 # Opens the live dashboard and exports its HTML report
npm run test:load:100 # Requires 80 Merchandiser + 20 Inventory accounts
npm run test:load:arrival
# Explicitly enable the dashboard for any scenario:
npm run test:dashboard -- load-roles
# Export dashboard HTML without opening a live server (CI):
K6_WEB_DASHBOARD_PORT=-1 npm run test:load:5
# Any existing scenario, with automatic HTML reporting:
npm run test:performance -- full-journey
```

Each run through this runner creates an HTML report, run metadata and available k6 summary JSON under `k6/results/`. Failed runs keep their failure exit code and report status.
Load scenarios automatically open the k6 live dashboard at `http://localhost:5665` and save `k6-dashboard.html` in that run's results directory. Close the dashboard tab to let k6 finish and the runner complete its reports. Set `K6_WEB_DASHBOARD=false` to disable visualization, or `K6_WEB_DASHBOARD_OPEN=false` to open the URL manually.

The scenarios create persistent records and upload files. Use a disposable seeded QA environment, validate fixtures with smoke tests, and restore data between comparable runs. Role load levels use distinct business accounts and shared supporting approval accounts; the arrival-rate test reuses the legacy session pool. Acceptance targets remain provisional.

- [Setup, profile schedules and report instructions](k6/README.md)
- [Independent Merchandiser/Inventory scenarios, 100-VU cap, handoff and verification](docs/role-based-load-testing.md)
- [QA lead review, findings and outstanding risks](docs/k6-qa-review.md)
- Local tooling verification without API traffic: `npm run test:reporting`

## Named load scenarios

Use the Node runner so role coordination, preflight, dashboard export, and HTML reporting are enabled. Each command runs only the selected level.

| Command | Scenario file | Merchandiser + Inventory | Steady duration |
| --- | --- | --- | --- |
| `npm run test:load:5` | `k6/scenarios/load-5-users.js` | 4 + 1 | 10 min |
| `npm run test:load:10` | `k6/scenarios/load-10-users.js` | 8 + 2 | 15 min |
| `npm run test:load:20` | `k6/scenarios/load-20-users.js` | 16 + 4 | 20 min |
| `npm run test:load:50` | `k6/scenarios/load-50-users.js` | 40 + 10 | 15 min |
| `npm run test:load:100` | `k6/scenarios/load-100-users.js` | 80 + 20 | 10 min |

Durations above are steady-load periods. Defaults add 2-minute ramps, up to 10 minutes of producer grace, and 5 minutes of Inventory drain; Inventory then ramps down. Authentication/setup can add further time. Named files pin the user allocation and steady period; use generic `load-roles` for other custom schedules.

The report's **Requests per second (RPS)** counts regular application API traffic only, excluding techpack, authentication setup, and local coordination requests. It remains a whole-run elapsed-time rate: uploads and thinking still affect how many API requests the workflows produce. This is not a no-upload benchmark or maximum capacity. Historical runs without that scoped counter show N/A.
