# SourcePilot AI Service

Minimal AI service to satisfy CRE workflow calls.

## Endpoints

- `GET /health`
- `POST /analyze-suppliers`
- `POST /assess-risk`

## Run

```bash
pnpm -C services/ai install
pnpm -C services/ai dev
```

## Config

Create `services/ai/.env`:

```
PORT=4090
LOG_LEVEL=info
```

## Notes

- This is a rule-based baseline implementation so workflows run end-to-end.
- Replace scoring logic with Anthropic calls when ready.
