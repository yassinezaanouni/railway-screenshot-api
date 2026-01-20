# Railway Screenshot API

A high-performance screenshot API built for Railway deployment. Features browser pooling, ad/cookie blocking, lazy-load handling, and batch processing.

## Features

- **Browser Pool** - Pre-warmed Chromium instances for fast response times
- **Ad & Cookie Blocking** - Blocks 65+ ad networks and cookie consent popups (enabled by default)
- **Smart Image Waiting** - Dynamically waits for images to load (5s timeout), viewport-aware for faster captures
- **Lazy-Load Handling** - Auto-scrolls full-page captures to trigger lazy-loaded content
- **Batch Processing** - Capture up to 20 URLs in parallel with partial failure support
- **Multiple Formats** - PNG, JPEG, and PDF (A4) output
- **Device Presets** - Desktop (1280×720), tablet (768×1024), and mobile (375×667) viewports
- **Zod Validation** - Clear error messages for invalid requests
- **Graceful Shutdown** - Clean browser cleanup on SIGTERM

## Quick Start

### Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/screenshot-api)

Or manually:

1. Fork this repository
2. Create a new project on [Railway](https://railway.app)
3. Connect your GitHub repo
4. Add environment variable: `API_KEY` (required)
5. Deploy

### Local Development

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Set environment variables
export API_KEY=your-secret-key
export POOL_SIZE=5

# Run in development
npm run dev

# Build and run production
npm run build && npm start
```

## API Reference

### Authentication

All endpoints (except `/` and `/stats`) require an API key:

```bash
# Header authentication
curl -H "x-api-key: YOUR_KEY" "https://your-api.railway.app/take?url=..."

# Query parameter authentication
curl "https://your-api.railway.app/take?url=...&api_key=YOUR_KEY"
```

### Endpoints

#### `GET /` - Health Check
```bash
curl https://your-api.railway.app/
# {"status":"ok","message":"Railway Screenshot API running"}
```

#### `GET /stats` - Pool Statistics
```bash
curl https://your-api.railway.app/stats
# {"status":"ready","pool":{"total":10,"available":8,"inUse":2}}
```

#### `GET /take` - Single Screenshot

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | required | URL to capture |
| `type` | string | `png` | Output format: `png`, `jpeg`, `pdf` |
| `fullPage` | boolean | `false` | Capture entire scrollable page |
| `quality` | number | `80` | JPEG quality (1-100) |
| `width` | number | `1280` | Viewport width (1-3840) |
| `height` | number | `720` | Viewport height (1-2160) |
| `delay` | number | `0` | Additional wait seconds after load (0-30) |
| `device` | string | - | Preset: `desktop`, `tablet`, `mobile` |
| `blockAds` | boolean | `true` | Block ads and cookie popups |

**Response Headers:**
- `Content-Type`: `image/png`, `image/jpeg`, or `application/pdf`
- `X-Duration-Ms`: Time taken to capture the screenshot

**Examples:**

```bash
# Basic screenshot
curl "https://your-api.railway.app/take?url=https://example.com&api_key=KEY" > screenshot.png

# Full page JPEG
curl "https://your-api.railway.app/take?url=https://example.com&fullPage=true&type=jpeg&quality=90&api_key=KEY" > page.jpg

# Mobile viewport
curl "https://your-api.railway.app/take?url=https://example.com&device=mobile&api_key=KEY" > mobile.png

# PDF export
curl "https://your-api.railway.app/take?url=https://example.com&type=pdf&api_key=KEY" > page.pdf

# Without ad blocking
curl "https://your-api.railway.app/take?url=https://example.com&blockAds=false&api_key=KEY" > with-ads.png
```

#### `POST /batch` - Batch Screenshots

Capture multiple URLs in parallel (max 20).

**Request Body:**
```json
{
  "urls": ["https://example.com", "https://github.com"],
  "options": {
    "type": "png",
    "fullPage": false,
    "quality": 80,
    "device": "desktop",
    "blockAds": true
  }
}
```

**Response:**
```json
{
  "count": 2,
  "successCount": 2,
  "failedCount": 0,
  "durationMs": 3500,
  "avgMs": 1750,
  "results": [
    {"url": "https://example.com", "success": true, "image": "base64...", "type": "png"},
    {"url": "https://github.com", "success": true, "image": "base64...", "type": "png"}
  ]
}
```

**Partial Failure Example:**
```json
{
  "count": 2,
  "successCount": 1,
  "failedCount": 1,
  "durationMs": 5000,
  "avgMs": 2500,
  "results": [
    {"url": "https://example.com", "success": true, "image": "base64...", "type": "png"},
    {"url": "https://invalid-url.test", "success": false, "error": "net::ERR_NAME_NOT_RESOLVED"}
  ]
}
```

**Example:**
```bash
curl -X POST "https://your-api.railway.app/batch" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{"urls":["https://example.com","https://github.com"],"options":{"fullPage":true}}'
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_KEY` | Yes | - | Authentication key for API access |
| `PORT` | No | `3000` | Server port |
| `POOL_SIZE` | No | `10` | Number of pre-warmed browser pages |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Express Server                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │  /take      │  │  /batch     │  │  Zod Validation │ │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────┘ │
│         │                │                              │
│         └───────┬────────┘                              │
│                 ▼                                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │           Screenshot Service                     │   │
│  │  • Ad/Cookie Blocking (route interception)      │   │
│  │  • Smart Image Waiting (viewport-aware)         │   │
│  │  • Scroll-to-bottom (lazy-load handling)        │   │
│  │  • PNG/JPEG/PDF capture                         │   │
│  └──────────────────────┬──────────────────────────┘   │
│                         ▼                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Browser Pool                        │   │
│  │  • Single Chromium instance                     │   │
│  │  • Pre-warmed isolated contexts                 │   │
│  │  • Age-based page recycling (5 min)             │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Blocked Domains

Ad blocking intercepts requests to 65+ domains including:

- **Ad Networks:** Google Ads, Facebook, Criteo, Taboola, Outbrain, Amazon Ads
- **Cookie Popups:** OneTrust, Cookiebot, CookiePro, TrustArc, Iubenda
- **Analytics:** Hotjar, FullStory, Mixpanel, Segment, Amplitude

Disable with `blockAds=false` if you need original page content.

## Performance

- **Cold start:** ~2-3s (browser launch + pool warmup)
- **Warm request:** ~1-3s depending on page complexity
- **Pool efficiency:** Pages reuse contexts, minimal memory overhead
- **Concurrent capacity:** Equal to `POOL_SIZE` (default 10)

## Railway Configuration

The included `railway.toml` configures:

```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/"
healthcheckTimeout = 300
startCommand = "npm start"
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

## License

MIT
