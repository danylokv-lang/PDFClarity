# PDFClarify — Infrastructure Setup Guide

## Prerequisites

```bash
npm install -g wrangler
wrangler login
```

---

## 1. Cloudflare D1 (Database)

### Create the database

```bash
wrangler d1 create pdfclarify-db
```

Save the output `database_id` — you'll need it for `wrangler.toml`.

### Apply the schema

```bash
# Local dev
wrangler d1 execute pdfclarify-db --local --file=db/schema.sql

# Production
wrangler d1 execute pdfclarify-db --remote --file=db/schema.sql

# Password auth migration
wrangler d1 execute pdfclarify-db --remote --file=db/migrations/001_add_password_columns.sql
```

### Schema (`db/schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'free',
  docs_used   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  filename    TEXT NOT NULL,
  file_size   INTEGER,
  page_count  INTEGER,
  storage_key TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS summaries (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL,
  result      TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_summaries_doc  ON summaries(document_id);
```

---

## 2. Cloudflare KV (Anonymous Session Tracking)

### Create the namespace

```bash
# Production
wrangler kv namespace create SESSIONS

# Dev/preview
wrangler kv namespace create SESSIONS --preview
```

Save both IDs from the output.

### How it works

- On first anonymous upload → generate UUID, set `HttpOnly` cookie, store count in KV
- On each upload → read cookie → check KV → enforce free limit (3 docs/mo)
- On sign-up → migrate KV data to D1 `users.docs_used`, delete KV entry

### KV entry structure

```json
{
  "docs_used": 2,
  "reset_at": 1748736000
}
```

Key: `anon:<session_id>` · TTL: 30 days

---

## 3. Cloudflare R2 (PDF Storage)

### Create the bucket

```bash
wrangler r2 bucket create pdfclarify-pdfs
```

### Usage rules

- PDFs are uploaded to R2 before processing
- After analysis completes → **delete the PDF from R2** (privacy policy promise)
- Only the analysis result stays in D1 `summaries` table
- Never make the bucket public — use signed URLs if you need temporary access

---

## 4. Secrets (API Keys)

### Set Gemini API key

```bash
wrangler secret put GEMINI_API_KEY
# paste your key when prompted
```

For local dev, create `.env.local` (already gitignored):

```
GEMINI_API_KEY=your_key_here
```

**Never commit API keys to git.**

---

## 5. `wrangler.toml` (Full Config)

```toml
name = "pdfclarify"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = ".vercel/output/static"

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "pdfclarify-db"
database_id = "PASTE_D1_ID_HERE"

# R2 Storage
[[r2_buckets]]
binding = "STORAGE"
bucket_name = "pdfclarify-pdfs"

# KV Sessions
[[kv_namespaces]]
binding = "KV"
id = "PASTE_KV_PRODUCTION_ID_HERE"
preview_id = "PASTE_KV_PREVIEW_ID_HERE"
```

---

## 6. TypeScript Env Types (`env.d.ts`)

```ts
declare global {
  interface CloudflareEnv {
    DB: D1Database;
    STORAGE: R2Bucket;
    KV: KVNamespace;
    GEMINI_API_KEY: string;
  }
}

export {};
```

---

## 7. Next.js on Cloudflare Pages

### Install adapter

```bash
npm install -D @cloudflare/next-on-pages
```

### `package.json` scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "pages:build": "npm_config_legacy_peer_deps=true next-on-pages",
    "pages:dev": "npm_config_legacy_peer_deps=true next-on-pages --watch & wrangler pages dev .vercel/output/static --d1=DB --kv=KV --r2=STORAGE",
    "pages:deploy": "npm run build && npm run pages:build && wrangler pages deploy .vercel/output/static --project-name=pdfclarify"
  }
}
```

### `next.config.ts`

```ts
import { setupDevPlatform } from '@cloudflare/next-on-pages/next-dev';

if (process.env.NODE_ENV === 'development') {
  await setupDevPlatform();
}
```

---

## 8. Deploy

### Option A — Git-connected (recommended)

1. Push repo to GitHub
2. Cloudflare Dashboard → **Pages → Create project** → connect repo
3. Build settings:
  - Build command: `npm run build && npm run pages:build`
   - Output directory: `.vercel/output/static`
4. Add bindings in **Settings → Functions**:
   - D1: `DB` → `pdfclarify-db`
   - KV: `KV` → `SESSIONS`
   - R2: `STORAGE` → `pdfclarify-pdfs`
5. Add env variable: `GEMINI_API_KEY` (encrypted)

### Option B — Manual deploy

```bash
npm run pages:build
wrangler pages deploy .vercel/output/static --project-name=pdfclarify
```

---

## 9. Production Checklist

### Security
- [ ] `GEMINI_API_KEY` set via `wrangler secret` (not in code)
- [ ] `.env.local` in `.gitignore`
- [ ] R2 bucket is **not** public
- [ ] Session cookie is `HttpOnly; Secure; SameSite=Strict`
- [ ] API routes validate `user_id` owns `document_id` before returning results

### Data / Privacy
- [ ] PDF files deleted from R2 after processing
- [ ] User can delete their data from dashboard
- [ ] Using **Vertex AI** (not AI Studio) for production — no training on user data

### Infra
- [ ] D1 schema applied to production (`--remote`)
- [ ] KV namespace created (production + preview)
- [ ] R2 bucket created
- [ ] All 3 bindings connected in Cloudflare Pages dashboard
- [ ] `GEMINI_API_KEY` env variable set in Pages dashboard

### DNS / Domain
- [ ] Custom domain added in Cloudflare Pages → Custom Domains
- [ ] SSL enabled (automatic with Cloudflare)

---

## Free Tier Limits (Reference)

| Service   | Free limit                         |
|-----------|------------------------------------|
| D1        | 5M reads/day · 100K writes/day · 5GB |
| KV        | 10M reads/day · 1M writes/day · 1GB  |
| R2        | 10GB storage · 1M Class B ops/mo     |
| Pages     | 500 builds/mo · unlimited requests   |
| Workers   | 100K requests/day                     |
