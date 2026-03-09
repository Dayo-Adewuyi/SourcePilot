# SourcePilot CRE Workflows

Three Chainlink Runtime Environment workflows powering autonomous procurement on SourcePilot.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Chainlink DON (BFT Consensus)                │
│                                                                 │
│  ┌──────────────────┐  ┌─────────────────┐  ┌───────────────┐  │
│  │  Price Scanner    │  │  Deal Executor  │  │   Delivery    │  │
│  │  (Cron: 30min)   │  │  (EVM Log)      │  │   Verifier    │  │
│  │                  │  │                 │  │  (Cron: 6hr)  │  │
│  │ Scraper → AI →   │  │ Stock Check →   │  │ Track API →   │  │
│  │ PriceOracle      │  │ Risk → Confirm  │  │ Confirm →     │  │
│  │ (EVM Write)      │  │ → Ship (Write)  │  │ Release Escrow│  │
│  └──────────────────┘  └─────────────────┘  └───────────────┘  │
│          │                      │                    │          │
│          ▼                      ▼                    ▼          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Base L2 Smart Contracts                      │  │
│  │  PriceOracle │ EscrowVault │ AgentRegistry │ PurchaseOrder│  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
  SourcePilot Scraper      ShipEngine / Freightos
  (POST /scrape)           (Logistics APIs)
```

## Workflows

### 1. Price Scanner (`price-scanner.ts`)
- **Trigger**: Cron — every 30 minutes
- **Does**: Scrapes supplier prices → AI ranks them → writes top deals to PriceOracle on-chain
- **Consensus**: `consensusIdenticalAggregation` with HTTP cacheSettings ensuring DON-wide consistency
- **Writes to**: `PriceOracle.batchUpdatePrices()`

### 2. Deal Executor (`deal-executor.ts`)
- **Trigger**: EVM Log — `DealCreated` event from EscrowVault
- **Does**: Verifies stock → AI risk assessment → confirms deal → books freight → marks shipped
- **Safety**: Risk threshold (7500 bps) rejects suspicious suppliers before confirmation
- **Writes to**: `EscrowVault.confirmDeal()`, `EscrowVault.markShipped()`

### 3. Delivery Verifier (`delivery-verifier.ts`)
- **Trigger**: Cron — every 6 hours
- **Does**: Scans all Shipped deals → polls tracking APIs → confirms delivery → releases escrow → records agent stats
- **Anomaly detection**: Flags shipment exceptions for buyer notification
- **Writes to**: `EscrowVault.confirmDelivery()`, `AgentRegistry.recordDealCompletion()`

## Setup

```bash
# Prerequisites
# 1. CRE CLI installed: https://docs.chain.link/cre/getting-started/cli-installation
# 2. CRE account: https://cre.chain.link
# 3. Bun runtime installed

# Initialize
cre init SourcePilot-workflows --language typescript
cd SourcePilot-workflows

# Copy workflow files into your CRE project
cp -r src/ <your-cre-project>/src/
cp -r config/ <your-cre-project>/config/

# Install dependencies
bun install
bun add viem zod

# Configure
# 1. Update config/*.config.json with your deployed contract addresses
# 2. Update config/secrets.yaml with API keys
# 3. Set CRE_ETH_PRIVATE_KEY in .env

# Simulate each workflow
cre workflow simulate price-scanner --target staging-settings
cre workflow simulate deal-executor --target staging-settings
cre workflow simulate delivery-verifier --target staging-settings

# Deploy (Early Access required)
cre workflow deploy price-scanner --target production-settings
cre workflow deploy deal-executor --target production-settings
cre workflow deploy delivery-verifier --target production-settings
```

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| API key exposure | Stored in CRE Secrets, accessed via `nodeRuntime.getSecret()` |
| Duplicate HTTP calls | `cacheSettings` ensures single execution across DON nodes |
| Non-determinism | No `Date.now()`, no `Math.random()`, sorted iterations, `runtime.now()` for timestamps |
| Deal state corruption | Status checks before every transition (Locked→Confirmed→Shipped→Delivered) |
| Supplier fraud | AI risk scoring gate (>7500 bps = automatic rejection) |
| Consensus failure | All HTTP responses cached, identical data across nodes |

## File Structure

```
SourcePilot-cre/
├── src/
│   ├── workflows/
│   │   ├── price-scanner.ts        # Workflow 1: Cron → Scrape → AI → PriceOracle
│   │   ├── deal-executor.ts        # Workflow 2: EVM Log → Verify → Confirm → Ship
│   │   └── delivery-verifier.ts    # Workflow 3: Cron → Track → Deliver → Release
│   ├── contracts/
│   │   └── abi/
│   │       └── index.ts            # Minimal ABIs for all 5 contracts
│   └── lib/
│       ├── config.ts               # Zod schemas for workflow configs
│       └── types.ts                # Shared types (scraper, tracking, etc.)
├── config/
│   ├── price-scanner.config.json
│   ├── deal-executor.config.json
│   ├── delivery-verifier.config.json
│   └── secrets.yaml
└── README.md
```
