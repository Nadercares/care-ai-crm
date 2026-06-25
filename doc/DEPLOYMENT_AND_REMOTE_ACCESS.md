# CARE AI CRM — Deployment & Remote Access Guide

A practical guide for getting CARE AI CRM running on the firm's servers and onto every approved device (Mac, Windows, iPhone, iPad, Android).

This document covers:

1. What CARE AI CRM actually is
2. Hosting it (Railway-based deployment that already exists in this repo)
3. Connecting it to Supabase (database + auth + storage)
4. Configuring the AI assistant
5. Inviting staff
6. Installing on every approved device (desktop + mobile, as a PWA)
7. Security checklist for remote access
8. Backups, audit, and incident response

> **Compliance note.** CARE AI CRM stores claim, policy, and insured PII. Treat the production instance as you would any other regulated system: SSO if possible, MFA on every account, role-based access, encrypted backups, and an offboarding checklist. The AI features provide decision support only — they are not a substitute for licensed adjusters, attorneys, or compliance review.

---

## 1. What CARE AI CRM is

CARE AI CRM is a customised fork of Atomic CRM built specifically for public-adjusting workflows:

| Layer | Tech |
| --- | --- |
| Frontend | React 19 + Vite + Tailwind v4, shadcn-admin-kit UI |
| Backend | Supabase (Postgres + PostgREST API + Auth + Storage + Edge Functions) |
| AI assistant | Floating chat panel calling Claude via OpenRouter; system prompt loaded with PA domain vocabulary, escalation playbook, and hard compliance rules |
| Deployment | Railway (Nixpacks build) |

Domain resources currently in the app:

- **Contacts** — insureds, leads, referral sources
- **Companies** — referring contractors / law firms
- **Deals** — sales pipeline (Kanban)
- **Claims** — every reported loss (status pipeline: intake → settled/closed)
- **Policies** — coverage records per insured
- **Carriers** — insurance company directory (with NAIC codes)
- **Carrier adjusters** — staff/IA adjusters with license numbers
- **Estimates** + line items, **Settlements** — supporting tables (UI to come)
- **Sales** — staff accounts

The `claims_summary` view joins claims with the insured, carrier, adjuster, policy, and settlement so the Claims list shows everything at a glance.

---

## 2. Deploying the web app on Railway

This repo already has `railway.json` configured for Nixpacks build + serve.

### One-time setup

1. Create a Railway account at https://railway.app and a new project.
2. Add the GitHub repo as the source. Pick the branch you want to deploy from (`main` for prod, `claude/ai-agent-public-adjuster-v2RHR` for the current feature branch).
3. Set the build & start commands (already in `railway.json`):
   - Build: `npm run build`
   - Start: `npm start`
4. Add the environment variables in the next section.
5. (Recommended) Attach a custom domain — e.g. `app.careclaims.com`. Railway terminates TLS automatically.

### Environment variables

Add these in Railway → Variables:

| Variable | Purpose | Where to find it |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase project REST endpoint | Supabase → Project Settings → API |
| `VITE_SB_PUBLISHABLE_KEY` | Supabase publishable (anon) key | Supabase → Project Settings → API |
| `VITE_OPENROUTER_API_KEY` | OpenRouter key powering the AI chat | https://openrouter.ai (rotate periodically) |
| `VITE_GOOGLE_WORKPLACE_DOMAIN` | (Optional) Restrict Google SSO to your domain | Your Google Workspace admin |
| `VITE_DISABLE_EMAIL_PASSWORD_AUTHENTICATION` | Set to `true` to force SSO-only | — |

Railway redeploys automatically on push.

### Verifying the deployment

After a successful deploy:

- Visit the Railway URL.
- You should see the CARE AI CRM login page (dark navy + gold theme).
- Sign in (or sign up the first account — it becomes the admin).
- The floating gold chat bubble (bottom-right) should open a chat panel that streams Claude responses.

---

## 3. Connecting to Supabase

### Production project

1. Create a project at https://supabase.com.
2. Run all migrations: from your laptop, `npx supabase db push` against the linked project, or apply `supabase/migrations/*.sql` via the Supabase SQL editor in order.
3. Confirm the new claims-domain tables exist: `carriers`, `carrier_adjusters`, `policies`, `claims`, `estimates`, `estimate_line_items`, `settlements`, and the view `claims_summary`.
4. Confirm Row-Level Security is **on** for every table and the policies created in migration `20260624120000_claims_domain.sql` apply.
5. Create the `attachments` storage bucket (for policy PDFs and note attachments) — see `supabase/schemas/07_storage.sql`.

### Edge functions

Deploy the included edge functions:

```bash
npx supabase functions deploy mcp
npx supabase functions deploy users
npx supabase functions deploy update_password
npx supabase functions deploy postmark
npx supabase functions deploy delete_note_attachments
npx supabase functions deploy merge_contacts
npx supabase functions deploy extract-policy
npx supabase functions deploy chat
npx supabase functions deploy compare-estimates
```

The `mcp` function is a Model Context Protocol server (OAuth-gated, SQL-validated) for external MCP clients — Claude Desktop and similar — that want to query the CRM directly.

The `extract-policy` function powers the AI policy-PDF extractor in the Policy edit page.

The `compare-estimates` function powers the AI estimate-comparison card on the Claim show page: it loads every estimate plus the policy and asks Claude to diff totals, identify missing line items, surface depreciation issues and policy red flags, and propose escalation moves.

The `chat` function is the server-side agent backing the in-app chat widget. It runs an Anthropic agentic loop with a single `query_crm` tool (read-only SELECT, validated). Required secrets:

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# optional overrides (default model is claude-sonnet-4-6)
npx supabase secrets set ANTHROPIC_MODEL=claude-sonnet-4-6
npx supabase secrets set ANTHROPIC_CHAT_MODEL=claude-sonnet-4-6
```

The Anthropic key is read **only inside the edge functions** and never reaches the browser. Once the `chat` function is deployed, the old `VITE_OPENROUTER_API_KEY` is no longer used and should be removed from the Railway / hosting environment.

**Chat security trade-off (read this).** The `chat` function runs SQL with a service-level database connection, which bypasses Row-Level Security. Every authenticated CRM user therefore has read access to all CRM tables via chat. This is acceptable for a small-team firm where every signed-in user is staff; if you ever invite outside users (insureds, partners, contractors) into Supabase auth, lock chat down before doing so (per-role connections, or move queries through PostgREST).

### State-law compliance KB

The new `state_law_summaries` table is the firm's curated per-(state, topic) compliance knowledge base. Every seeded row ships with `status = 'draft'` and is a **research checklist**, not an authoritative answer.

Before any seeded row appears on a Claim page in production:

1. The firm's compliance lead reviews the draft and either:
   - Rewrites the `summary` with verified, current content and adds the live statute number to `source_citation`, then sets `status = 'active'` and `reviewed_by_sales_id` to their own sales user id, OR
   - Sets `status = 'retired'` if the row is irrelevant.
2. The "State law cheat sheet" card on the Claim page only shows `active` rows by default. Staff can toggle "Show drafts too" to see research checklists during research, but those carry a draft badge.
3. The chat agent has been instructed to **only** quote active rows. If asked a state-law question with no active row, it tells the user "Route to the firm's compliance lead." It will not fall back to its training memory of statutes.

Seeded Florida draft topics: `pa_licensing`, `pa_fee_caps`, `pa_contract_requirements`, `pa_solicitation_rules`, `statute_of_limitations`, `appraisal_clause`, `mediation_program`, `bad_faith_standard`, `matching_law`, `anti_concurrent_causation`. Add more states by inserting rows under the same topic keys.

### Auth

Enable the providers you need under Supabase → Authentication → Providers:

- **Email + password** (default).
- **Google** if you use Google Workspace — set `VITE_GOOGLE_WORKPLACE_DOMAIN` to restrict signups to your domain.
- Optionally **SAML / SSO** via Supabase's enterprise SSO if you're on a paid tier.

Enforce MFA from Supabase's auth dashboard once accounts are created.

---

## 4. Configuring the AI assistant

The chat panel currently uses **OpenRouter** as a gateway to Claude. To swap models (cheaper, faster, or self-hosted) edit `src/api/chat.ts`:

```ts
body: JSON.stringify({
  model: 'anthropic/claude-3-haiku', // change here
  ...
})
```

The **system prompt** lives in the same file. It encodes:

- Domain vocabulary (insured, carrier, policy form, etc.)
- The PA escalation ladder (re-inspection → supplement → appraisal → mediation → litigation)
- Hard compliance rules: decision-support only, never advise the insured directly, never invent statutes
- State-specific caveats (licensing, fee caps in declared-emergency claims, time-bars)

**Edit the system prompt as your firm's playbook evolves.** Treat it like an internal SOP — it's the single biggest lever for assistant quality.

> **Important.** Right now the assistant cannot query CRM data directly. It reasons about whatever the staff pastes into chat or describes verbally. The `mcp` edge function is the wiring for grounded tool use; that integration is the next planned milestone.

### Future AI integrations (already scoped, not yet built)

- Policy PDF upload → AI extracts coverages, exclusions, deductibles, endorsements into the `policies` row
- Estimate comparison (carrier vs PA) with line-item diff + policy-grounded notes on each gap
- 50-state knowledge base for compliance, appraisal, time-bars
- Carrier/adjuster pattern dashboards (settlement amounts by carrier, by method, by adjuster license)
- Gmail / Calendar / Dropbox / ClaimWizard sync

---

## 5. Inviting staff

1. Sign in as an admin.
2. Open the user menu (top right) → **Users**.
3. Click **New User**. They'll receive a password-set email.
4. Mark the box if they should be an administrator.
5. To remove someone who leaves the firm, set their account to **Disabled** rather than deleting. Disabled accounts can't log in, but their claim records and audit trail remain intact.

> User deletion is intentionally not supported. Disabled is the offboarding path.

---

## 6. Installing on every approved device (PWA)

CARE AI CRM works in any modern browser. For a "looks-like-an-app" experience on each device, install it as a **Progressive Web App (PWA)**.

### Mac (Chrome, Edge, or Safari)

1. Open `https://app.careclaims.com` in Chrome.
2. Click the **install icon** in the address bar (or the three-dot menu → **Install CARE AI CRM**).
3. The app appears in `/Applications` and on the Dock. Pin it.

### Windows 11 (Chrome or Edge)

1. Open the app URL.
2. Three-dot menu → **Apps → Install this site as an app**.
3. The app appears in the Start menu and can be pinned to the taskbar.

### iPhone / iPad (Safari)

1. Open the app URL in Safari.
2. Tap **Share** → **Add to Home Screen**.
3. Tap **Add**. The CARE AI icon appears on the home screen.

### Android (Chrome)

1. Open the app URL.
2. Three-dot menu → **Add to Home Screen** (or **Install app** if prompted).
3. Confirm.

### Desktop client (optional, advanced)

If you want a fully separate desktop app window (not just a Chrome tab), Microsoft Edge → Apps → Install gives you that. For a fully native wrapper consider Tauri / Electron later — out of scope for this guide.

---

## 7. Security checklist for remote access

Treat this as the firm's minimum standard for any device that touches CARE AI CRM.

**Device**
- Full-disk encryption on (FileVault on macOS, BitLocker on Windows).
- Screen lock under 5 minutes.
- OS and browser auto-update enabled.
- Mobile device management (MDM) if available — Jamf, Intune, Google Endpoint Management.

**Account**
- MFA required (TOTP app or hardware key). Enforce from Supabase auth.
- No shared accounts. Each staff member has their own login.
- Strong password (passphrase) — at least 14 chars; password manager required.
- Annual access review: confirm every active account is still employed and has the right role.

**Network**
- For VPN access to backoffice systems use Tailscale or the firm's existing VPN. The CRM itself is over HTTPS and doesn't require VPN, but VPN gives you a single point to revoke if a laptop is lost.
- Block CARE AI CRM access from un-trusted countries at the Supabase auth / Cloudflare layer if you don't operate there.

**App**
- The OpenRouter API key in `VITE_OPENROUTER_API_KEY` is **visible in the browser bundle**. Today this is acceptable because it has a tight monthly cap; the long-term plan is to proxy AI calls through the `mcp` edge function so the key never leaves Supabase. Add this to the next milestone if your usage grows.
- Rotate OpenRouter and Supabase service-role keys every 90 days.
- Backups of the database (see §8) stored encrypted with limited access.

---

## 8. Backups, audit, and incident response

- **Backups.** Supabase Pro plan includes point-in-time recovery (PITR). Turn it on. Take a logical dump (`pg_dump`) weekly to encrypted offsite storage (e.g. Backblaze, S3 with KMS).
- **Audit log.** Supabase logs every auth event and every DB query under a paid plan. Review monthly for unusual access (volume of queries from one account, off-hours, geo).
- **AI audit log.** Track every AI suggestion that influenced a claim decision. The recommended pattern: write a note on the claim record any time AI output is acted on, with a short description and timestamp. This becomes your defensible record if a recommendation is later questioned.
- **Incident response.** Maintain a one-page runbook covering: lost device → disable account in Supabase + revoke Google session; suspected breach → rotate all keys, force password resets, review audit log; client data subject request → SQL queries to extract a contact's data (instructions in `doc/`).

---

## 9. Day-to-day operator commands (cheat-sheet)

From a workstation with this repo cloned:

```bash
# Apply new migrations to local DB
npx supabase migration up --local

# Push schema to remote production
npx supabase db push

# Regenerate registry (auto on commit, but manually if you skip the hook)
make registry-gen

# Run unit tests
make test

# Run TypeScript type check
make typecheck

# Build prod bundle locally to sanity-check before pushing
make build
```

Railway redeploys on every push to the watched branch. To roll back, redeploy a previous Railway build (one click in the Railway UI).

---

## 9b. Gmail integration (Phase 9)

CARE AI can read each staff member's Gmail inbox, classify every thread by claim relevance and urgency, and link messages to the right CRM record. This is a per-user OAuth connection — each staffer connects their own Gmail.

### One-time Google Cloud setup

1. Go to **console.cloud.google.com → APIs & Services → Credentials**. Create (or reuse) a project for the firm.
2. Enable APIs: **Gmail API** and **Google Calendar API** (Phase 9 only uses Gmail; Calendar is in the next phase).
3. Configure the **OAuth consent screen**:
   - User type: **Internal** if your firm is on Google Workspace (recommended — no Google verification needed). Otherwise External + add staff emails as test users.
   - Authorized domains: the domain that hosts your CRM (e.g. `careai.example`).
   - Scopes: add `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/userinfo.email`.
4. Create an **OAuth 2.0 Client ID** of type **Web application**.
   - Name: `CARE AI CRM — Gmail`
   - Authorized redirect URI (EXACT match required):
     `https://<your-supabase-project-ref>.supabase.co/functions/v1/gmail-oauth-callback`
   - Save the **Client ID** and **Client secret**.

### Supabase function secrets

```bash
npx supabase secrets set GOOGLE_OAUTH_CLIENT_ID=<client-id>
npx supabase secrets set GOOGLE_OAUTH_CLIENT_SECRET=<client-secret>
npx supabase secrets set GMAIL_OAUTH_REDIRECT_URI=https://<your-project-ref>.supabase.co/functions/v1/gmail-oauth-callback
npx supabase secrets set APP_URL=https://crm.careai.example   # where to bounce users back after OAuth
```

### Frontend env var (publishable — exposed in the bundle)

```bash
# .env or Railway env
VITE_GOOGLE_OAUTH_CLIENT_ID=<client-id>
```

The OAuth **client ID** is safe to expose in the browser; the **client secret** stays server-side in Supabase secrets only.

### Deploy

```bash
npx supabase db push                          # creates gmail_connections + email_triage
npx supabase functions deploy gmail-oauth-callback
npx supabase functions deploy gmail-triage
```

### How staff connect

1. Open **/email-triage** in the CRM.
2. Click **Connect Gmail**.
3. Pick the Google account, accept the consent screen.
4. You're bounced back to /email-triage with the connection saved.
5. Click **Run triage now** to classify the most recent 25 inbox threads.

### What gets stored

- **gmail_connections**: one row per staffer, with the Gmail refresh token and the connected email. Refresh tokens are stored in plaintext in the row — protected only by RLS (owner-only read/write). For higher-security firms, swap the column for a `pgsodium` encrypted equivalent before going live.
- **email_triage**: one row per Gmail thread with AI classification (`claim_correspondence` / `new_lead` / `admin` / `marketing` / `spam` / `unknown`), urgency (`high` / `medium` / `low`), summary, suggested_action, ai_confidence, ai_rationale, and AI-detected links to `claim_id` / `contact_id` / `carrier_id` / `carrier_adjuster_id`. Bodies are NOT stored — only a ~4 KB excerpt for context.

### Scope limits and known gaps

- **Read-only.** The deployed scope is `gmail.readonly`. Drafting replies (next session) needs `gmail.modify` — re-consent with the new scope before that ships.
- **No cron yet.** Triage runs only on-demand via the "Run triage now" button. A scheduled runner via Supabase `pg_cron` or an external scheduler comes in the next session.
- **Lookup pack is capped** at the 500 most recent carriers / contacts / carrier_adjusters and the 200 most recent claims. Larger firms need pagination or vector retrieval. Documented as a known limit.
- **AI-detected CRM links are advisory.** The model can return null IDs when uncertain. Staff should verify before treating the link as authoritative.

---

## 10. Roadmap (what's next)

Sequenced by priority — each item is its own focused build:

1. **AI chat tool-use** — wire the chat panel to the `mcp` edge function so the assistant can directly answer "show me all FL claims pending appraisal" with real data.
2. **Policy PDF review** — upload a carrier policy, AI extracts coverages/deductibles/exclusions/endorsements into the `policies` row, surfaces gaps and unusual endorsements.
3. **Estimate comparison** — side-by-side carrier vs PA estimate line-item diff with policy-grounded notes.
4. **State law / compliance KB** — curated, source-cited per-state rules (PA licensing, fee caps, time-bars, appraisal). Surfaced contextually in claim and policy views.
5. **Carrier/adjuster pattern analytics** — dashboards on settlement velocity by carrier, by adjuster, by method (negotiation / appraisal / mediation / litigation).
6. **Integrations** — Gmail, Google Calendar, Dropbox file sync, ClaimWizard import (one workstream each).

If anything in this guide breaks, file an issue against this repo and tag the platform owner.
