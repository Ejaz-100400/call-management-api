# Call management API

NestJS + Prisma backend connected to your Supabase Postgres instance, with
Supabase-JWT authentication, role-based access control, full CRUD across all
resources, reports, Excel/PDF export, and a BullMQ-based async worker that
does speech-to-text + AI extraction.

## What's included

- `src/prisma` — Prisma client, global Nest module
- `src/auth` — `SupabaseAuthGuard` + `RolesGuard` (RBAC via `@Roles('admin' | 'manager' | 'viewer')`), applied globally. `@Public()` opts a route out. `GET /auth/me` returns the current user.
- `src/calls` — list/filter, detail, edit extraction, delete, recording URL, **plus AI control-plane routes**: `POST /:id/reprocess`, `GET /:id/processing-status`, `POST /:id/extraction/regenerate-summary`
- `src/customers` — list/filter, detail, call history, edit, fuzzy duplicate detection (`GET /customers/duplicates`), merge
- `src/employees` — full CRUD (delete blocked if the employee has call history — deactivate instead)
- `src/products` — full CRUD (delete blocked if referenced in `call_products` — deactivate instead)
- `src/follow-ups` — list/filter (status, assignee, due date), status updates
- `src/reports` — summary counts, calls-by-period, follow-up breakdown, top car models, top products
- `src/export` — `GET /export/calls.xlsx` and `.pdf`, same filters as `/calls`, audit-logged
- `src/business-numbers` — the two configured lines
- `src/webhooks` — `POST /webhooks/call-completed`, public, now **enqueues a processing job** after creating the call row
- `src/queue` — BullMQ producer (`QueueService`), global module
- `src/worker` — **separate process**, not part of the NestJS app. Consumes the queue: downloads the recording, uploads to object storage, transcribes (Deepgram), extracts structured data + summary + sentiment (Claude), writes it all back to Postgres
- `src/health` — `GET /health`, public

## Not included yet

- Real object storage calls in `src/worker/providers/storage.provider.ts` — currently throws with a clear TODO; wire up R2/S3 there
- Telephony-provider-specific webhook field mapping and signature verification (payload field names in `webhooks.service.ts` are placeholders)
- Mapping `call_extractions.products_discussed` (raw AI text) onto the normalized `call_products` join table — flagged as a TODO in the worker
- The frontend

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```
   This now includes Puppeteer, which downloads a bundled Chromium (~300MB) — expect the install to take a few minutes longer than before.

2. **Environment variables** — `cp .env.example .env`, then fill in:
   - `DATABASE_URL`, `SUPABASE_URL` — as before
   - `CAR_GLASSES_NUMBER` / `CAR_MODIFICATIONS_NUMBER` — your two business numbers
   - `REDIS_URL` — needed now, for the job queue between the API and the worker. Easiest local option: `docker run -p 6379:6379 redis`
   - `ANTHROPIC_API_KEY` — from console.anthropic.com
   - `DEEPGRAM_API_KEY` — from console.deepgram.com
   - `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` — only strictly needed once you implement the storage provider; the app runs fine without them until a call actually gets processed

   Auth setup (JWT Keys / JWKS) is unchanged from before — see the comment block in `src/auth/guards/supabase-auth.guard.ts` if you need the legacy-secret fallback.

3. **Prisma client**
   ```bash
   npx prisma db pull   # optional, see the note at the top of schema.prisma
   npx prisma generate
   ```

4. **Run the API**
   ```bash
   npm run start:dev
   ```
   `http://localhost:3000/health` should return `{"status": "ok", ...}`.

5. **Run the worker** (separate terminal — this does NOT start automatically with the API)
   ```bash
   npm run worker:dev
   ```
   You should see `[worker] listening for call-processing jobs...`. Without Redis running, this will fail to connect — start Redis first if you haven't.

## Testing

All the auth/token-getting steps from before still apply (see the PowerShell
and bash examples in earlier setup) — get a token, then:

```powershell
# List calls
Invoke-RestMethod -Uri "http://localhost:3000/calls" -Headers @{ "Authorization" = "Bearer $token" }

# Who am I?
Invoke-RestMethod -Uri "http://localhost:3000/auth/me" -Headers @{ "Authorization" = "Bearer $token" }

# Reports
Invoke-RestMethod -Uri "http://localhost:3000/reports/summary" -Headers @{ "Authorization" = "Bearer $token" }

# Export (saves the file directly)
Invoke-WebRequest -Uri "http://localhost:3000/export/calls.xlsx" -Headers @{ "Authorization" = "Bearer $token" } -OutFile "calls.xlsx"
```

**Testing the full pipeline end to end** — this will fail at the storage
step until you implement `storage.provider.ts`, but you can watch it get
that far:
1. Send the same test webhook as before (see earlier PowerShell example)
2. Watch the worker's terminal — it should pick up the job within a second or two
3. It'll fail at `fetchFromProviderUrl()` with a clear "not implemented yet" error — that's expected until object storage is wired up
4. Check `GET /calls/:id/processing-status` — should show `status: "failed"` with that message in `failureReason`

Once storage, Deepgram, and Anthropic keys are all real, the same flow
should carry a call all the way through to `status: "completed"` with a
transcript and extraction in the database.
