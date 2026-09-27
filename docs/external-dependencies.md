# External dependencies

Every third-party service/API this project talks to, what it's for, and where its credentials live. Update this whenever a new external call is added.

| Service | What it's for | Credential | Where stored |
|---|---|---|---|
| Anthropic API (`api.anthropic.com/v1/messages`, direct — not via OpenRouter) | The actual maths-grading AI (hybrid Sonnet+Opus per project memory) | `ANTHROPIC_API_KEY` | Cloudflare Secrets Store (`secrets_store_secrets` binding in `wrangler.toml`, store id `50b964b41eeb46d3bd4be77e059d3324`) |
| Cloudflare Workers KV (`RATE_LIMIT_KV`) | Rate limiting `/api/grade` | n/a | KV namespace binding, id `8fab716bacfc44279350b85806d98701` |
| Cloudflare Workers Assets (`ASSETS`) | Serves `./website` static files | n/a | `[assets]` binding in `wrangler.toml` |

## Known operational trap (documented in `wrangler.toml` itself)

This Worker auto-deploys from git. Cloudflare bindings added only via the dashboard are NOT version-controlled — every new deployment resets bindings to exactly what `wrangler.toml` declares. `RATE_LIMIT_KV` was once dashboard-only and got silently wiped by commits (confirmed 2026-09-17: 20 rapid malformed requests to `/api/grade` produced zero 429s). It's now declared in `wrangler.toml` and must stay that way — never re-add a binding via the dashboard alone.

No `package.json` dependencies — this Worker has none.
