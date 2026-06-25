# CARE AI CRM

A public-adjusting workspace built on top of [Atomic CRM](https://github.com/marmelab/atomic-crm). The base CRM gives you contacts, companies, deals, notes, and tasks. CARE AI adds the claims domain, the integrations a PA firm actually runs on (Gmail / Calendar / Dropbox / HailTrace), and a coordinated AI agent that reads from all of it.

This document is the entry point for everything on the `claude/ai-agent-public-adjuster-v2RHR` branch / PR #2. For Atomic CRM itself see [`README.md`](./README.md). For full deployment steps see [`doc/DEPLOYMENT_AND_REMOTE_ACCESS.md`](./doc/DEPLOYMENT_AND_REMOTE_ACCESS.md).

---

## What's in the box

| Area | What you get |
|---|---|
| **Claims domain** | Carriers, carrier adjusters (with license # + state), policies (Coverages A–F, all deductible types, endorsements, exclusions, summary, document URL), claims (status workflow intake → settled), estimates + line items, settlements (method, attorney involvement, days-to-settle, PA role) |
| **AI policy PDF extraction** | Upload a policy PDF on a Policy edit page → Claude reads it and patches the form fields (coverages, deductibles, endorsements, exclusions, plain-language summary, confidence notes) |
| **AI estimate comparison** | One click on any Claim → loads every estimate + policy → Claude returns headline, totals diff, items missing from carrier, price discrepancies, depreciation issues, policy red flags, recommended leverage moves |
| **State-law compliance KB** | Curated per-(state, topic) summaries with a hard `draft → active` workflow gated by the firm's compliance lead. FL ships pre-seeded as research checklists; chat agent refuses to invent statute citations |
| **Storm verification** | Per-claim `claim_storm_verifications` records (hail size, wind speed, distance, confidence, report URL). Manual entry works today; HailTrace API integration is wired and lights up once your firm sets the secrets |
| **AI chat agent** | Floating chat panel, server-side Claude with one read-only SQL tool (`query_crm`), domain-aware system prompt, full schema cheat sheet covering every CARE AI table |
| **Gmail triage + reply drafting** | OAuth-connect → AI classifies inbox threads by urgency / claim relevance / next action / CRM-record match (claim, carrier, adjuster, contact). Per-row "Draft reply" generates a context-grounded markdown reply saved as a real Gmail draft. Never sends |
| **Google Calendar** | "Schedule inspection" dialog on every Claim creates a real Google Calendar event with the claim/carrier/policy context baked into the description; auto-invites the insured + carrier adjuster. Calendar sync pulls existing events and AI-matches them to claims |
| **Dropbox** | Per-claim folder linking → live file listing with kind badges. "Classify with AI" runs a smarter pass over ambiguous filenames using filename + path + claim context |
| **Patterns dashboard** | `/patterns` — settlement velocity, method mix (negotiation / appraisal / mediation / litigation / denied), attorney involvement, escalation rate, broken down per carrier AND per adjuster (with license #) |
| **Daily morning briefing** | `/briefing` — Claude composes a fixed-section markdown briefing from today's calendar + last-24h urgent emails + stale claims + carrier escalation shifts. Optional save-to-Gmail-drafts. Cron-schedulable for 7am delivery |
| **Integrations page** | `/integrations` — single status board showing which integrations are connected per-user (Gmail, Dropbox) and which server-side env vars are set (Anthropic, HailTrace, Cron, Google OAuth, Dropbox OAuth). Inline setup hints when something's missing |

## How the AI parts compose

```
                    ┌─────────────────────────────────────┐
                    │      /briefing  (daily agent)       │
                    │  reads → calendar + email_triage    │
                    │           + claims_summary +        │
                    │           carrier_patterns          │
                    │  writes → markdown + Gmail draft    │
                    └─────────────────────────────────────┘
                                  ▲
                                  │ reads
                                  │
       ┌──────────────┬───────────┴────────────┬───────────────┐
       │              │                        │               │
 calendar_events  email_triage           claims_summary   carrier_patterns_summary
   ▲                ▲                       ▲ (view)         ▲ (view)
   │ writes         │ writes                │ writes         │ writes
   │                │                       │                │
schedule-      gmail-triage              CRUD via      every settlement
inspection     (cron + UI)               claims/       row aggregates
(UI button)                              estimates/    automatically
                                         settlements
```

Every per-user agent (gmail-triage, calendar-sync, daily-briefing) has a paired `*-runner` endpoint with `X-CRON-Secret` auth so one pg_cron job covers every connected staffer.

## First 10 minutes (local)

```bash
# Prereqs: make, Node 22, Docker
make install              # frontend + Supabase local stack
make start                # http://localhost:5173 (CRM), :54323 (Supabase studio)
```

1. Sign up at `http://localhost:5173` — first signup becomes the admin.
2. **Seed realistic test data** in another shell: `make seed-care-ai` — drops 6 carriers, ~21 adjusters, 30 FL insureds, 30 policies, ~50 claims with mixed statuses, carrier + PA estimates, settlements with carrier-specific patterns (Citizens settles fast with high attorney involvement; State Farm appraisal-heavy; Heritage high denial), and storm verifications for hail/wind claims. Safe to re-run — it wipes prior `seed:%` rows first.
3. Open `/integrations`. Everything will be red except Anthropic-status and Cron. That's expected for first run.
4. Add `ANTHROPIC_API_KEY` to `supabase/functions/.env` (`echo "ANTHROPIC_API_KEY=sk-ant-..." >> supabase/functions/.env`) and run `npx supabase functions serve --env-file supabase/functions/.env` to light up every AI feature.
5. Open `/patterns` — Citizens / State Farm / Heritage etc. should each show a distinct method-mix bar and attorney %. That's the seed working.
6. Open `/briefing` → Generate today's briefing. With seeded stale claims and carrier escalations, you'll get a real one.
7. Open any seeded **Claim** → poke the **AI estimate comparison** (the seed gives most claims both a carrier and a PA estimate), the **Storm verification** card (already populated for hail claims), and the **State law cheat sheet** (FL drafts visible with "Show drafts too").
8. Test the **chat agent**: floating gold circle, bottom right. Ask things like *"which carriers escalate most often?"* or *"show me stale claims with State Farm"*. It runs real SELECTs against the seed data.

## Going live — order of operations

Each step assumes you've finished the previous one. Full setup details are in [`doc/DEPLOYMENT_AND_REMOTE_ACCESS.md`](./doc/DEPLOYMENT_AND_REMOTE_ACCESS.md) by phase number.

1. **Host the CRM** — Railway deploy already configured in this repo (Phase 3 of the deployment guide). Sets the public URL staff use.
2. **Set up Supabase project + push migrations** (Phase 7) — `npx supabase db push` after pointing the CLI at your project.
3. **Deploy edge functions** — the deploy commands are listed under "Edge functions" in the deployment guide. There's also a single block in `## 9b` onward that lists every function in one place.
4. **Anthropic key** (Phase 4/5) — `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...` and remove the old browser-exposed `VITE_OPENROUTER_API_KEY` from your hosting env.
5. **Google Cloud + Gmail connect** (Phase 9 in the guide). Once one staffer connects, the calendar scope rides along — schedule + sync on Claim pages start working immediately.
6. **Dropbox app + connect** (Phase 11). Per-claim folder linking happens contextually on Claim pages.
7. **Cron** (Phase 9 + 13 + 16). Set `CRON_SECRET`, then one pg_cron block from the deploy guide schedules Gmail triage, calendar sync, and the morning briefing.
8. **HailTrace** (Phase 14). Email `developers@hailtrace.com` for API credentials, set three secrets, the Verify-with-HailTrace button on every Claim lights up.
9. **State-law KB** (Phase 8). Your compliance lead reviews each seeded FL draft, rewrites with verified content + statute citations, flips `status` to `active`.

After step 9 the chat agent, briefing, comparison, and patterns are all answering grounded questions about real data — that's "fully live."

## Hardware / device access

The CRM is a PWA. Once the firm's URL is live:

- **Mac / Windows / Linux desktops**: open the URL in Chrome / Edge / Safari. Install via the address-bar install button (or Chrome → Cast/Save/Share → Install).
- **iPhone / iPad**: Safari → Share → Add to Home Screen.
- **Android**: Chrome → menu → Install app.

The PWA caches the shell so the UI loads instantly on subsequent opens; real data still requires network. Auth is Supabase email + password (or Google Workspace SSO if you flip it on). MFA can be enforced from the Supabase auth dashboard.

## Known gaps (honest list)

These are tracked in the deployment guide too but consolidated here:

- **State law content is YOUR job.** Every seeded FL row is a research checklist, not legal content. AI never invents statute numbers. Your compliance lead has to fill these in before staff rely on the `/patterns` advice or chat answers about state law.
- **Chat tool RLS bypass.** The chat function runs SQL with a service-level DB connection — every authenticated CRM user can read every CRM table via chat. Fine while every user is firm staff; lock it down before inviting non-staff into Supabase auth.
- **Refresh tokens are plaintext** (Gmail, Dropbox) under RLS. Acceptable for a small firm; high-security firms should swap to `pgsodium` encrypted columns before going live.
- **HailTrace endpoint shape is best-guess.** The response parser tries multiple field-name aliases (`event_date | date | occurred_at`, etc.). If HailTrace returns names that don't match any alias, raw response is stored in `raw_response` for diagnosis; adjust `normalizeEvent()` in `supabase/functions/verify-storm/index.ts` if needed.
- **No AI file content reading.** Dropbox classification uses filenames + paths + claim context only. Reading file contents (e.g. peek at the first page of a PDF) is a future add.
- **Cron secret in `alter database … set`** is readable by anyone with DB admin access. Move to Supabase Vault for high-sensitivity setups.
- **Briefing history isn't backfilled.** Briefings persist starting from when Phase 15 deployed; older runs aren't recoverable.
- **One folder per claim in Dropbox.** Subfolders work (click through), but only the top folder is linked.

## What's in the source tree (CARE AI specific)

```
src/components/atomic-crm/
├── claims/                       # ClaimCalendarCard, ClaimDropboxCard,
│                                 # ClaimStormCard, EstimateComparator,
│                                 # StateLawChecklist, ScheduleInspectionDialog
├── policies/                     # PolicyExtractor
├── carriers/, carrier_adjusters/ # carrier + adjuster CRUD
├── email-triage/                 # ConnectGmailCard, EmailTriageList,
│                                 # EmailReplyDialog
├── patterns/                     # PatternsPage
├── briefing/                     # BriefingPage
├── integrations/                 # IntegrationsPage
├── care-ai/                      # Floating chat panel (ChatPanel)
└── ...

src/api/
└── chat.ts                       # client for the server-side chat agent

supabase/functions/
├── extract-policy/               # Phase 5
├── compare-estimates/            # Phase 7
├── chat/                         # Phase 6 — server-side AI chat agent
├── lookup-state-law (removed)    # Phase 8 — superseded by direct supabase-js query
├── gmail-oauth-callback/, gmail-triage/, gmail-triage-runner/
├── draft-email-reply/            # Phase 9
├── schedule-inspection/, calendar-sync/, calendar-sync-runner/
├── dropbox-oauth-callback/, dropbox-list/
├── classify-dropbox-files/       # Phase 16
├── verify-storm/                 # Phase 14
├── daily-briefing/, daily-briefing-runner/   # Phase 13
├── system-health/                # Phase 15
└── mcp/                          # existing MCP server (separate use case)

supabase/schemas/
├── 01_tables.sql                 # source of truth for every table CARE AI added
├── 03_views.sql                  # claims_summary, carrier_patterns_summary,
│                                 # adjuster_patterns_summary
└── 05_policies.sql               # RLS policies for everything CARE AI added

supabase/migrations/
└── 20260624–20260625*            # CARE AI migrations in date order

doc/
└── DEPLOYMENT_AND_REMOTE_ACCESS.md   # ~700 lines, full setup by phase
```

## Phases shipped

Every phase is one git commit on the `claude/ai-agent-public-adjuster-v2RHR` branch / PR #2. Each commit message has the full design notes.

| # | Title |
|---|---|
| 1 | Claims domain schema + carriers/policies/claims CRUD + deployment guide |
| 2 | Policy PDF upload + Claude-powered extraction |
| 3 | Server-side chat agent with live CRM access (replaces browser-exposed OpenRouter key) |
| 4 | AI estimate comparison on the Claim page |
| 5 | State-law compliance research module (FL drafts + active/draft workflow) |
| 6 | Gmail triage backbone (OAuth + AI classification + threading) |
| 7 | Gmail reply drafting + scheduled triage runner |
| 8 | Google Calendar — schedule inspection + sync |
| 9 | Dropbox integration (per-claim folder linking + live listing) |
| 10 | Carrier & adjuster pattern analytics dashboard |
| 11 | Daily morning briefing agent (with cron runner) |
| 12 | Storm verification + HailTrace integration scaffold |
| 13 | `/integrations` consolidated status page + briefing history |
| 14 | Calendar-sync runner + AI Dropbox file classification |

(Phase numbers in this table consolidate the commit history; deployment-guide phase numbers correspond to setup ordering and may differ.)

## License

CARE AI inherits the Atomic CRM license (see [`LICENSE.md`](./LICENSE.md)). Atomic CRM is built and maintained by [Marmelab](https://marmelab.com); the public-adjuster extension layered on top in this branch is © Claims Advocate Resolution Experts.
