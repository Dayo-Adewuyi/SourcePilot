# SourcePilot Scraper Service

Robust, cache-backed scraper service that normalizes supplier listings across multiple sources.

## Features

- Pluggable adapters per source (API or browser)
- Normalized product schema
- Rate-limited concurrency queue
- Redis-backed cache (optional)
- Batch scrape endpoint
- BullMQ queue + worker for optimized throughput
- Custom site scraping with selectors

## Endpoints

- `GET /health`
- `POST /scrape`
- `POST /scrape/batch`
- `GET /jobs/:id`

### Example

```bash
curl -s http://localhost:4080/scrape \
  -H 'content-type: application/json' \
  -d '{"source":"alibaba","query":"iphone case","limit":10}'
```

### Custom site example

```bash
curl -s http://localhost:4080/scrape \
  -H 'content-type: application/json' \
  -d '{"source":"custom","query":"iphone case","targetUrl":"https://jumia.com/search?q=iphone%20case","selectors":{"item":".product","title":".title","price":".price","url":"a","image":"img"}}'
```

## Environment

Create `services/scraper/.env` or export env vars:

```
PORT=4080
REDIS_URL=redis://localhost:6379
START_WORKER=true
CACHE_TTL_SECONDS=900
CONCURRENCY=4
DEFAULT_CURRENCY=USD
REQUEST_TIMEOUT_MS=20000
JOB_TIMEOUT_MS=60000
BROWSER_WAIT_MS=1200
BROWSER_SCROLLS=2
DEBUG_SCRAPER=false
DEBUG_DIR=tmp/scraper-debug

ALIBABA_API_BASE=https://api.example.com
ALIBABA_APP_KEY=your_key
ALIBABA_APP_SECRET=your_secret
ALIBABA_API_METHOD=alibaba.product.search
ALIBABA_SIGN_METHOD=md5
ALIBABA_API_VERSION=2.0
ALIBABA_API_FORMAT=json
ALIBABA_QUERY_KEY=keywords
ALIBABA_LIMIT_KEY=pageSize
ALIBABA_EXTRA_PARAMS={"format":"json"}
ALIBABA_SESSION=

INDIAMART_API_BASE=https://api.example.com
INDIAMART_API_KEY=your_key

MADEINCHINA_API_BASE=https://api.example.com
MADEINCHINA_API_KEY=your_key

AMAZON_PA_API_BASE=https://api.example.com
AMAZON_PA_ACCESS_KEY=your_key
AMAZON_PA_SECRET_KEY=your_secret
AMAZON_PA_PARTNER_TAG=your_tag
AMAZON_PA_REGION=us-east-1
AMAZON_PA_HOST=webservices.amazon.com
AMAZON_PA_MARKETPLACE=www.amazon.com
AMAZON_PA_SEARCH_INDEX=All
```

## Notes

- The browser adapter uses Playwright and generic selectors. Tune selectors per site for accuracy.
- Some providers require signed requests. Implement signature logic in adapter files.
- Enable `DEBUG_SCRAPER=true` to write HTML + screenshot files when zero items are matched.
