# SourcePilot Architecture

This doc maps the product spec to the monorepo structure.

## Layers -> Code Locations

- Presentation
  - Web app: `apps/web`
  - Mobile app: `apps/mobile`
- Intelligence
  - AI service: `services/ai`
  - Shared models: `packages/shared`
- Orchestration
  - CRE workflows: `services/cre-workflows`
- Settlement
  - Smart contracts: `packages/contracts`

## Data Layer

- Supplier APIs + Scraper: `services/scraper`
- Caching/queues: `services/scraper`
- Core API: `services/api`

## Shared Code

- Types & SDK helpers: `packages/shared`
- Shared config: `packages/config`
