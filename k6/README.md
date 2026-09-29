# Luminar k6 project structure

This project follows the flow-based pattern used in the example k6 project:

- `config/` contains environment and scenario profiles
- `helpers/` contains shared auth and HTTP utilities
- `flows/` contains business-flow actions such as login, style, tech pack, BOM, costing, sample, PO, and work order
- `scenarios/` contains smoke, load, spike, breakpoint, and full-journey scripts

## Smoke scenarios

Each smoke scenario runs one iteration with one VU. The BOM, costing, sample, and tech-pack scenarios create a fresh style first. The receive-item scenario logs in as merchandiser, senior merchandiser, then inventory.

Run the scenarios independently:
```bash
k6 run k6/scenarios/sample-smoke.js
k6 run k6/scenarios/bom-smoke.js
k6 run k6/scenarios/pre-costing-smoke.js
k6 run k6/scenarios/tech-pack-smoke.js
k6 run k6/scenarios/style-to-pre-costing-flow.js
k6 run k6/scenarios/work-order-and-receive-item-flow.js
```

## Environment variables

This project reads values from the workspace .env file and exposes them to k6 via `__ENV`.

Example values:

```bash
BASE_URL=https://qa.luminar.sazimlabs.com
MERCHANDISER_EMAIL=merchandiser@email.com
MERCHANDISER_PASSWORD=Password123

LUMINAR_FACTORY_ID=2f7e5d9a-3c1b-4e8f-9a6d-1b2c3d4e5f60
LUMINAR_ORGANIZATION_ID=0e3c4b48-c231-4252-9be7-aafb4a647d05
LUMINAR_BUYER_ID=6a8e1b95-8e8d-4fee-b7ed-93703577d6d9
LUMINAR_STYLE_ID=<existing-style-uuid>
```

Run with:

```bash
set -a
source .env
set +a
k6 run k6/scenarios/sample-smoke.js
```
