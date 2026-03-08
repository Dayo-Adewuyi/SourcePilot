# SourcePilot Monorepo

AI-powered autonomous procurement platform. See `SourcePilot.MD` for the product spec. This repository is organized as an optimized, scalable monorepo to support web, mobile, backend services, Chainlink CRE workflows, and smart contracts.



## Repo Layout

- `apps/web` — Next.js web app
- `apps/mobile` — React Native app
- `services/api` — Core API (Fastify/Express)
- `services/ai` — AI service (Claude integration)
- `services/scraper` — Scraper workers + queues
- `services/cre-workflows` — Chainlink CRE workflows
- `packages/shared` — Shared TS types, utilities
- `packages/config` — Shared configs (eslint/ts/prettier)
- `packages/contracts` — Solidity + Foundry workspace
- `docs` — Product + architecture docs

## Tooling

- Monorepo: pnpm workspaces + Turborepo
- Node: >= 20.11

## Quick Start

```bash
pnpm install
pnpm dev
```

## Build / Test

```bash
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

## Notes

- Each service/app is isolated with its own `package.json`.
- Shared code lives in `packages/shared`.
- Smart contracts live in `packages/contracts` and use Foundry.

## Deployed Addresses

SourcePilot#AgentRegistry - 0xfa318CDc59Df92c2dFC889649c426F4DB48f5dF1
SourcePilot#EscrowVault - 0xA7062Cf765Da227a7Cc246A63A2122410699536D
SourcePilot#PriceOracle - 0x388d0d905C8904D62B34aFc2B6AD403CD01D85f9
SourcePilot#DisputeResolver - 0xA2c4203e9B1F408DcD58de7513be13Cc6f43982D
SourcePilot#PurchaseOrder - 0xa3Ae14B2D3c6e5963e76ae9eC674Cb8635319d7a