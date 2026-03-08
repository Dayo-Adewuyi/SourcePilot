
SourcePilot
AI-Powered Autonomous Procurement Platform

Technical Architecture & Product Specification



Version 1.0  |  February 2026
Built on Chainlink CRE  |  Powered by Anthropic Claude
CONFIDENTIAL

1. Executive Summary
SourcePilot is an AI-powered autonomous procurement platform that deploys intelligent agents to find, negotiate, and execute supply deals on behalf of businesses globally. Each agent operates 24/7, scanning supplier networks, comparing prices across marketplaces, and executing purchases through on-chain escrow — with every operation cryptographically verified via Chainlink’s Runtime Environment (CRE).
Unlike existing procurement tools that require manual RFQs, spreadsheet comparisons, and trust-based supplier relationships, SourcePilot automates the entire pipeline: discovery, verification, negotiation, payment, and delivery tracking. The platform generates revenue through SaaS subscriptions and transaction fees on escrow-settled deals.

Core Value Proposition
Save businesses 15-35% on procurement costs through AI-powered supplier discovery, consensus-verified pricing, and trustless escrow settlement — accessible to anyone, anywhere.

1.1 Why This Matters
The global B2B procurement market exceeds $5.3 trillion annually. Yet most small and medium businesses still source goods through WhatsApp messages, manual Alibaba searches, and trust-based wire transfers. This process is slow, opaque, and riddled with fraud: fake suppliers, inflated pricing, phantom invoices, and shipments that never arrive.
SourcePilot solves this by combining three technologies that have never been unified for procurement: AI agents that think and negotiate autonomously, Chainlink CRE that provides cryptographic verification for every data point and transaction, and on-chain escrow that eliminates counterparty risk.

2. System Architecture
2.1 High-Level Overview
SourcePilot is composed of four layers that work together to deliver autonomous procurement:
Layer
Components
Purpose
Presentation
Web App, API, Mobile
User interface for agent management, deal approval, and dashboards
Intelligence
Claude AI, ML Models
Supplier analysis, price prediction, negotiation strategy, risk scoring
Orchestration
Chainlink CRE Workflows
Consensus-verified data fetching, on-chain execution, delivery tracking
Settlement
Smart Contracts (Base)
Escrow, purchase orders, payment release, dispute resolution

2.2 CRE Workflow Architecture
The platform runs three core CRE workflows per agent, each triggered independently and executed across Chainlink’s Decentralized Oracle Network with BFT consensus:

Workflow 1: Price Scanner
Component
Detail
Trigger
Cron — every 30 minutes (configurable per agent)
HTTP Client
Hits supplier APIs (Alibaba Open Platform, 1688, IndiaMART) + SourcePilot scraper service for non-API sources
Compute
Claude AI analyzes results: ranks by price, MOQ fit, supplier rating, shipping cost, delivery reliability
EVM Write
Updates on-chain price oracle contract with top deals; emits DealFound event
Consensus
Every API response is verified by multiple DON nodes — no single point of failure on pricing data

Workflow 2: Deal Executor
Component
Detail
Trigger
EVM Log — fires when user approves a deal (DealApproved event from escrow contract)
HTTP Client
Confirms real-time stock availability with supplier; books freight via logistics API
EVM Write
Locks USDC in escrow, mints Purchase Order NFT with deal metadata, updates agent state
HTTP Client
Sends order confirmation to supplier webhook; triggers shipping label generation

Workflow 3: Delivery Verifier
Component
Detail
Trigger
Cron — every 6 hours for active shipments
HTTP Client
Polls ShipEngine/EasyPost tracking APIs for shipment status updates
Compute
Verifies delivery confirmation against expected timeline; flags anomalies
EVM Write
On confirmed delivery: releases escrow to supplier, records completion on-chain

3. Supplier Data Layer
The supplier data layer is the backbone of SourcePilot. It aggregates pricing, availability, and supplier reputation data from multiple sources into a normalized format that CRE workflows can consume via HTTP Client calls.
3.1 Data Source Tiers
Tier 1: Direct API Integrations (MVP)
Source
Data Provided
Access Model
Priority
Alibaba Open Platform
Product listings, MOQs, pricing, supplier ratings
API Key (free tier)
P0 — MVP
1688.com
Domestic Chinese wholesale prices (often 30-50% lower)
Partnership + scraper
P0 — MVP
IndiaMART
Indian manufacturing and wholesale
API partnership
P1
Made-in-China.com
Alternative Chinese supplier pool
API partnership
P1
Amazon Product API
Retail pricing benchmarks, availability
Free (associate acct)
P1

Tier 2: Logistics & Verification APIs
Source
Data Provided
Access Model
Priority
Freightos WebCargo
Real-time sea/air/land freight quotes
API (free tier)
P0 — MVP
ShipEngine / EasyPost
Multi-carrier rates & tracking
API Key
P0 — MVP
ExchangeRate-API
Real-time FX rates for cross-border pricing
Free
P0 — MVP
Dun & Bradstreet
Supplier credit/risk scoring
Paid API
P2
ImportGenius / Panjiva
Import/export records, verify legitimacy
Paid
P2

Tier 3: SourcePilot Scraper Service
For suppliers and marketplaces without public APIs, SourcePilot operates a scraper microservice that normalizes web data into a standard JSON format. CRE workflows call this service via HTTP Client, and the results are consensus-verified like any other API call.
	•	Hosted scraper crawls Alibaba product pages, DHGate, TradeKey, Global Sources
	•	Normalizes into standard schema: product name, unit price, MOQ, supplier rating, location, shipping options
	•	Runs on a separate infrastructure (not on CRE) but exposed as a REST API
	•	Rate-limited and cached to respect source site ToS

4. Smart Contract Architecture
All contracts are deployed on Base (Coinbase L2) for low gas costs and fast finality. The contract suite handles escrow, purchase order tracking, agent management, and dispute resolution.
4.1 Contract Overview
Contract
Responsibility
Key Interactions
EscrowVault.sol
Holds USDC deposits; locks funds per deal; releases on delivery confirmation or dispute resolution
CRE Workflows, Users
PurchaseOrder.sol
ERC-721 NFT representing each deal. Metadata: supplier, qty, price, terms, shipment status
EscrowVault, CRE
AgentRegistry.sol
Tracks agent configurations, owner mappings, product categories, and performance metrics
Frontend, CRE
PriceOracle.sol
On-chain price feed updated by Price Scanner workflow; stores top deals per product category
CRE Price Scanner
DisputeResolver.sol
Handles disputes via time-locked resolution: auto-refund if supplier doesn’t respond within 7 days
Users, Admin

4.2 Escrow Flow
The escrow mechanism is the trust layer that eliminates counterparty risk. Here is the lifecycle of funds through a single deal:
	•	User approves a deal found by their agent and signs the approval transaction
	•	EscrowVault.sol locks the deal amount (USDC) in a deal-specific vault
	•	CRE Deal Executor workflow confirms supplier stock and places the order
	•	PurchaseOrder NFT is minted with full deal metadata
	•	CRE Delivery Verifier tracks shipment via logistics APIs
	•	On confirmed delivery, CRE triggers escrow release: supplier receives USDC minus platform fee
	•	If delivery fails or is disputed, funds enter the dispute resolution flow

4.3 Fee Structure (On-Chain)
Fee Type
Amount
When Collected
Transaction Fee
2.5% of deal value
On escrow release
Dispute Filing Fee
$5 USDC (refundable if won)
On dispute creation
Express Settlement
0.5% premium
On instant release request

5. AI Intelligence Layer
The AI layer is powered by Anthropic’s Claude and handles all cognitive tasks that require reasoning, analysis, and decision-making. It operates as a service called by CRE workflows via HTTP Client.
5.1 AI Service Endpoints
Endpoint
Function
Called By
/analyze-suppliers
Ranks suppliers by composite score: price, MOQ fit, rating, shipping cost, delivery history, fraud signals
Price Scanner WF
/predict-price
Forecasts price trends based on historical data, seasonal patterns, and market signals
Price Scanner WF
/assess-risk
Evaluates supplier fraud risk: new account flags, inconsistent pricing, review patterns
Deal Executor WF
/generate-rfq
Creates negotiation messages optimized for supplier communication patterns
Deal Executor WF
/anomaly-detect
Flags shipment anomalies: unusual delays, route deviations, customs holds
Delivery Verifier WF

5.2 Supplier Scoring Model
Claude evaluates suppliers using a weighted composite score. The weights are tunable per agent based on user preferences:
Factor
Weight
Data Source
Unit Price (landed)
30%
Supplier API + Freightos shipping quote + FX rate
Supplier Rating
20%
Marketplace rating + ImportGenius trade history
MOQ Fit
15%
Supplier API vs. user’s configured order size
Delivery Reliability
15%
Historical on-time rate from SourcePilot database
Fraud Risk (inverse)
10%
Claude risk assessment + D&B credit score
Shipping Speed
10%
Freightos/ShipEngine estimated transit time

6. User Journey
The following walkthrough illustrates the complete user experience from onboarding through deal completion, using a representative persona.

Persona: Amara — SMB Owner, Nairobi
Amara runs a phone accessories shop. She currently sources from Alibaba manually, spending 8+ hours per week comparing suppliers. She’s been scammed twice by fake suppliers and lost $1,200. She wants cheaper goods, reliably delivered, without the hassle.

Step 1: Onboarding
Amara visits SourcePilot.ai and creates an account. She connects her wallet (or uses email signup with an embedded wallet). She fills out a simple product profile specifying: product categories (phone cases, screen protectors, charging cables), typical order size ($500–2,000), preferred sourcing regions (China, India), and budget currency (USDC). The platform creates her agent with default configurations and activates the three CRE workflows.
Step 2: Agent Discovery (Autonomous)
Within 30 minutes, the Price Scanner workflow executes its first scan. It hits Alibaba’s API, the 1688 scraper, and Freightos for shipping quotes. Claude analyzes 70+ supplier results and ranks them. Amara receives a notification with the top 5 deals, each showing: unit price, total landed cost, supplier rating, estimated delivery time, and a risk score.
Step 3: Deal Approval
Amara reviews the deals on her dashboard. She selects an iPhone 16 silicone case deal: $0.38/unit from a 4.8-star supplier in Shenzhen, 500 units, $317 total landed cost via sea freight. She taps “Approve Deal” and confirms the transaction. Her USDC is locked in escrow.
Step 4: Automated Execution
The Deal Executor workflow fires immediately on her approval event. It confirms stock availability with the supplier’s API, books freight through Freightos, sends order confirmation to the supplier, and mints a Purchase Order NFT containing all deal terms. Amara sees a confirmation with her PO number and estimated delivery date.
Step 5: Delivery Tracking
The Delivery Verifier workflow polls shipment status every 6 hours. Amara sees real-time updates: “Shipment departed Shenzhen,” “Cleared Mombasa customs,” “Delivered to Nairobi.” If anomalies are detected (unusual delays, route changes), Claude flags them and Amara is notified immediately.
Step 6: Settlement
On confirmed delivery, the CRE workflow triggers escrow release. The supplier receives $309.08 (deal value minus 2.5% platform fee). Amara’s agent records the supplier’s performance for future scoring. The Purchase Order NFT is updated with completion status.
Step 7: Compounding Value
Over time, Amara’s agent learns which suppliers deliver on time and which have quality issues. Its recommendations improve. Amara scales from $500 orders to $5,000 orders. She adds a second agent for beauty products. Her procurement costs drop 28% compared to her manual process.

7. Revenue Model
SourcePilot operates a hybrid SaaS + transaction fee model designed to capture value at every stage of the procurement lifecycle.
7.1 Subscription Tiers
Tier
Price
Agents
Features
Free
$0/mo
1 agent
3 scans/day, manual deal execution, basic dashboard
Pro
$49/mo
3 agents
Unlimited scans, auto-execution, priority supplier matching, analytics
Business
$199/mo
10 agents
Team access, bulk procurement, custom AI tuning, API access
Enterprise
Custom
Unlimited
Dedicated infrastructure, SLA, custom integrations, white-label option

7.2 Transaction Revenue
	•	2.5% fee on all escrow-settled deals (collected on release)
	•	0.5% premium for express settlement (instant release without delivery confirmation)
	•	$5 dispute filing fee (refundable to winning party)

7.3 Revenue Projections (Conservative)
Metric
Year 1
Year 2
Year 3
Active Users
2,000
15,000
80,000
GMV (deals settled)
$5M
$60M
$500M
SaaS Revenue
$240K
$3.6M
$24M
Transaction Revenue
$125K
$1.5M
$12.5M
Total Revenue
$365K
$5.1M
$36.5M

8. Technology Stack
Layer
Technology
Rationale
Frontend
Next.js 14, TypeScript, TailwindCSS
SSR for SEO, type safety, rapid UI development
Backend API
Node.js, Express/Fastify, TypeScript
Consistent stack with frontend, async-first
Database
PostgreSQL + Redis
Relational data + caching/queuing for scraper jobs
AI Service
Anthropic Claude API (claude-sonnet-4-5)
Best-in-class reasoning for supplier analysis
Orchestration
Chainlink CRE (TypeScript SDK)
Consensus-verified execution, multi-chain support
Blockchain
Base (Coinbase L2)
Low gas, fast finality, USDC native support
Smart Contracts
Solidity, Foundry, OpenZeppelin
Battle-tested libraries, modern tooling
Scraper
Playwright + BullMQ workers
Headless browser scraping, queue-based execution
Infrastructure
AWS (ECS, RDS, ElastiCache, S3)
Scalable, reliable, global
Payments
USDC on Base + Paystack (fiat on-ramp)
Crypto-native + accessibility for non-crypto users

9. MVP Roadmap
Phase 1: Foundation (Weeks 1–4)
	•	Smart contracts: EscrowVault, PurchaseOrder, AgentRegistry, PriceOracle on Base testnet
	•	CRE Workflow #1: Price Scanner with Alibaba API + Freightos integration
	•	Scraper service: Alibaba product page scraper with normalized JSON output
	•	AI service: /analyze-suppliers endpoint with Claude integration
	•	Basic frontend: agent creation, product profile setup, deal feed
Phase 2: Execution (Weeks 5–8)
	•	CRE Workflow #2: Deal Executor with escrow locking and PO minting
	•	CRE Workflow #3: Delivery Verifier with ShipEngine tracking
	•	User dashboard: deal history, shipment tracking, spend analytics
	•	Notification system: email + in-app alerts for deals and delivery updates
	•	Testnet deployment and internal testing
Phase 3: Launch (Weeks 9–12)
	•	Base mainnet deployment with audited contracts
	•	Fiat on-ramp integration via Paystack (USDC purchase flow)
	•	Additional supplier sources: 1688 scraper, IndiaMART API
	•	Subscription billing (Stripe for SaaS tiers)
	•	Public beta launch targeting 200 initial users
Phase 4: Scale (Months 4–6)
	•	Multi-agent support per user
	•	Supplier negotiation automation (Claude-powered RFQ generation)
	•	Mobile app (React Native)
	•	API access for enterprise integrations
	•	Expansion to additional supplier marketplaces and logistics providers

10. Competitive Landscape
Feature
SourcePilot
Alibaba/TradeAssurance
Coupa / SAP Ariba
AI Sourcing
Autonomous 24/7 agents
Manual search
Basic recommendations
Price Verification
CRE consensus-verified
Self-reported
Self-reported
Payment
On-chain escrow (instant)
Trade Assurance (slow)
Invoice-based (30-90 days)
Target Market
Global SMBs
Importers
Enterprise only
Min Deal Size
$50+
$200+
$50,000+
Cost
Free tier + 2.5% tx fee
Free + bank fees
$50K+/year license

Key Differentiator
SourcePilot is the only platform that combines AI-powered autonomous sourcing with cryptographically verified pricing data and trustless escrow settlement. No other solution provides consensus-verified supplier data — this is the moat that CRE enables.

11. Risks & Mitigations
Risk
Severity
Mitigation
Supplier API access revoked
High
Multi-source redundancy; scraper fallback; partnership agreements with key platforms
Smart contract exploit
Critical
Professional audit (Cyfrin/Trail of Bits); bug bounty program; upgradeable proxy pattern
CRE early-stage risk
Medium
CRE is backed by Chainlink; design system to be CRE-portable; fallback to centralized execution if needed
Delivery disputes
Medium
Time-locked auto-resolution; human arbitration for complex cases; dispute fee to prevent spam
Regulatory (crypto payments)
Medium
USDC is regulated stablecoin; Paystack fiat on-ramp for non-crypto users; KYC for large transactions
Data accuracy
Medium
CRE consensus verification; AI anomaly detection; user feedback loop for supplier scoring

12. Next Steps
SourcePilot sits at the intersection of three converging trends: the global shift to AI-powered automation, the maturation of on-chain payment infrastructure, and the democratization of cross-border trade. By building on Chainlink CRE, we gain a cryptographic trust layer that no competitor can replicate with traditional infrastructure.
The immediate priorities are:
	•	Deploy and test CRE workflows on Chainlink’s early access program
	•	Build and audit the smart contract suite on Base testnet
	•	Establish API partnerships with Alibaba Open Platform and Freightos
	•	Launch closed beta with 50 SMB users in Nigeria, Kenya, and India
	•	Apply to Chainlink BUILD program and Base ecosystem grants

— End of Document —
