# Luminar k6 project structure

This project follows the flow-based pattern used in the example k6 project:

- `config/` contains environment and scenario profiles
- `helpers/` contains shared auth and HTTP utilities
- `flows/` contains business-flow actions such as login, style, BOM, PO, work order
- `scenarios/` contains smoke, load, spike, breakpoint, and full-journey scripts

## Smoke scenario

The current smoke scenario performs:

1. login as merchandiser
2. create style

Run it with:

```bash
k6 run k6/scenarios/smoke.js
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
LUMINAR_GARMENT_SIZE_TEMPLATE_ID=f6dd8954-bf38-4196-b831-969007eff9a5
```

Run with:

```bash
source .env
k6 run k6/scenarios/smoke.js
```
