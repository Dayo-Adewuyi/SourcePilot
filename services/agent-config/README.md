# SourcePilot Agent Config Service

MVP production-ready service for agent policy storage and retrieval.

## Run

```bash
pnpm -C services/agent-config install
pnpm -C services/agent-config migrate
pnpm -C services/agent-config seed
pnpm -C services/agent-config dev
```

## Endpoints

- `GET /health`
- `POST /agents` (create or upsert)
- `GET /agents/:id`
- `PUT /agents/:id`
- `DELETE /agents/:id`

All endpoints (except `/health`) require `x-api-key` header.

## Example

```bash
curl -s http://localhost:4100/agents \
  -H 'content-type: application/json' \
  -H 'x-api-key: change-me-please-32-chars-minimum' \
  -d '{
    "id": "amara-agent-1",
    "name": "Amara - Phone Accessories",
    "active": true,
    "config": {
      "sources": ["alibaba"],
      "categories": ["phone-cases", "screen-protectors", "charging-cables"],
      "limit": 20,
      "currency": "USD",
      "preferences": { "minOrderSize": 50, "maxOrderSize": 10000 }
    }
  }'
```
