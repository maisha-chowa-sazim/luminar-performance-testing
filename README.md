# Luminar k6 performance testing project

This repository is structured around Luminar business-flow performance testing rather than endpoint-by-endpoint benchmarking.

## Current structure

- `k6/config/` — environment and scenario configuration
- `k6/helpers/` — shared auth and HTTP helpers
- `k6/flows/` — business flow actions such as login and style creation
- `k6/scenarios/` — smoke, load, spike, breakpoint, and full-journey scripts
- `docs/` — testing plan and QA notes
- `slice_1_openapi.yml` — shared API inventory used to map flow coverage

## Current smoke test

The first smoke path covers:

1. merchandiser login
2. create purchase order

Run it with:

```bash
source .env
npm run test:smoke
```

Or directly:

```bash
source .env
k6 run k6/scenarios/smoke.js
```

## Environment variables

The project uses the workspace .env file and reads values from `__ENV` inside k6.

Example values:

```bash
BASE_URL=https://qa.luminar.sazimlabs.com
MERCHANDISER_EMAIL=merchandiser@email.com
MERCHANDISER_PASSWORD=Password123
LUMINAR_FACTORY_ID=2f7e5d9a-3c1b-4e8f-9a6d-1b2c3d4e5f60
LUMINAR_ORGANIZATION_ID=0e3c4b48-c231-4252-9be7-aafb4a647d05
LUMINAR_BUYER_ID=6a8e1b95-8e8d-4fee-b7ed-93703577d6d9
LUMINAR_GARMENT_SIZE_TEMPLATE_ID=f6dd8954-bf38-4196-b831-969007eff9a5
```

## Next phases

- add style approval flow
- add BOM flow
- add costing flow
- add PO flow
- add work order flow
- add inventory receive flow
- add load, spike, breakpoint, and end-to-end scenarios
