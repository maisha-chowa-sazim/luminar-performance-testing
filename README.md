# Luminar k6 performance testing

Reusable API business flows, functional smoke tests and five ramped full-journey load profiles (5, 10, 20, 50 and 100 concurrent VUs).

Use Node.js 22+ and k6 (validated with 2.2.0). Configure local `.env` credentials, tenant IDs and seeded QA data as described in the [k6 run guide](k6/README.md). The npm runner loads `.env` automatically.

```bash
npm ci
npm run test:smoke
npm run test:load:5
# Any existing scenario, with automatic PDF reporting:
npm run test:performance -- full-journey
```

Each run through this runner creates a stakeholder PDF, HTML report, run metadata and available k6 summary JSON under `k6/results/`. Failed runs keep their failure exit code and report status. Direct `k6 run` commands do not generate PDFs.

The scenarios create persistent records and upload files. Use a disposable seeded QA environment, validate fixtures with smoke tests, and restore data between comparable runs. The load profiles use shared role accounts and provisional SLOs; review these assumptions before interpreting capacity.

- [Setup, profile schedules and report instructions](k6/README.md)
- [QA lead review, findings and outstanding risks](docs/k6-qa-review.md)
- Local tooling verification without API traffic: `npm run test:reporting`
