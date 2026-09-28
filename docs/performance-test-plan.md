# Luminar Performance Test Plan

## Objective

Measure and improve the performance of core Luminar ERP workflows across the API layer to ensure the application remains responsive during normal business usage, seasonal surges, and operational peak load.

## Scope

The initial focus includes:

- Authentication and session establishment
- Style listing and detail retrieval
- BOM reading and approval workflows
- Purchase order lifecycle
- Work order and production tracking
- Inventory and GRN update patterns
- Dashboard aggregate queries

## Personas

- Merchandiser: searches styles, BOMs, costings, and dashboards
- Buyer: creates purchase orders and reviews approvals
- Production planner: works with work orders and scheduling
- Inventory controller: handles GRN, movements, and stock checks
- Executive user: reads summary dashboards and cross-functional KPIs

## Critical journeys

1. Login to the ERP
2. List styles and open a specific style
3. Fetch BOM details for a style
4. Review or create a purchase order
5. Approve a purchase order or work item
6. Retrieve order or production status
7. Check inventory and GRN reports

## Load model

- Normal business hours: 10–30 concurrent users
- Peak operations: 50–100 concurrent users
- Spike scenario: brief surges above normal capacity

## Success criteria

- No failed logins during normal test iterations
- Error rate remains below 1%
- p95 read response times stay within accepted SLA ranges
- Write-heavy flows remain stable under peak traffic
- No major degradation in dashboard response times

## Data considerations

- Use separate test users for each role
- Prefer realistic ERP-style IDs and statuses
- Keep the test environment isolated from production data
- Reset test data between runs when necessary

## Tooling

- k6 for load generation
- InfluxDB for performance metric storage
- Grafana for trend dashboards
- CI for smoke and regression execution
