# Luminar k6 performance testing

Reusable API business flows, functional smoke tests, independent role-based load levels (5, 10, 20 and 50 total VUs), and a configurable arrival-rate journey test.

Use Node.js 22+ and k6 (validated with 2.2.0). Configure local `.env` credentials, tenant IDs and seeded QA data as described in the [k6 run guide](k6/README.md). The npm runner loads `.env` automatically.

```bash
npm ci
npm run test:smoke
npm run test:load:5 # Opens the live dashboard and exports its HTML report
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
- [Independent Merchandiser/Inventory scenarios, 50-VU cap, handoff and verification](docs/role-based-load-testing.md)
- [QA lead review, findings and outstanding risks](docs/k6-qa-review.md)
- Local tooling verification without API traffic: `npm run test:reporting`
