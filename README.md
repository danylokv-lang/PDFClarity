# PDFClarify

PDFClarify is a Cloudflare-hosted PDF analysis app with a static HTML frontend, Next.js API routes, D1 for data, KV for sessions, and R2 for file storage.

## Project Structure

```text
app/                 Next.js app shell and API routes
db/
	migrations/        Incremental D1 migrations
	schema.sql         Base schema for a fresh database
docs/                Setup notes and project context
lib/
	auth/              Session and password helpers
public/              Static website pages served by Pages
```

## Main URLs

- `/` and `/index.html` - landing page
- `/login.html` - sign in and registration
- `/app.html` - authenticated dashboard
- `/demo.html` - interactive product demo

## Development

```bash
npm install
npm run build
npm run pages:build
```

For Cloudflare local preview:

```bash
npm run pages:dev
```

## Deployment

```bash
npm run pages:deploy
```

## Database

Create a fresh database with:

```bash
wrangler d1 execute pdfclarify-db --remote --file=db/schema.sql
```

Apply the password-auth migration with:

```bash
wrangler d1 execute pdfclarify-db --remote --file=db/migrations/001_add_password_columns.sql
```

## Notes

- Cloudflare config lives in `wrangler.toml`
- Runtime env types live in `env.d.ts`
- Extra setup details are in `docs/SETUP.md`
