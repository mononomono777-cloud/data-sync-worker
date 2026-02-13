# data-sync-worker

Automated data aggregation pipeline using Playwright and Supabase.

## Setup

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
node fetch_stats.js
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TARGET_SIDS` | Comma-separated list of target IDs |
| `SUPABASE_URL` | Database endpoint |
| `SUPABASE_KEY` | Database key |

## License

Private use only.
