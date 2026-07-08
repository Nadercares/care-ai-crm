# Reference: CARE AI CRM — stack and architecture

**Date:** 2026-07-08 (verified directly from the repo on this date)

- **Base:** fork of Atomic CRM (marmelab), an open-source CRM.
  ~15,000 LOC of application code in `src/components/atomic-crm/`.
- **Frontend:** React 19 + TypeScript + Vite, Tailwind CSS v4,
  shadcn/Radix UI, ra-core (react-admin headless), React Query,
  React Hook Form.
- **Backend:** Supabase — PostgreSQL + PostgREST API + Auth + Storage +
  Edge Functions. Schema source of truth: `supabase/schemas/`.
- **Core tables:** companies, contacts, contact_notes, deals, deal_notes,
  sales (team), tags, tasks. Deals have: name, stage, amount, category,
  expected_closing_date, archived_at. Tasks have: text, type, due_date,
  done_date.
- **Custom CARE AI additions:** chat sidebar (`src/components/care-ai/` —
  ChatPanel, ChatMessage, ChatInput; `src/api/chat.ts`), custom i18n
  provider, dark navy + gold "Royal Navy" theme with forced dark mode,
  full rebrand to "CARE AI CRM", Railway deployment (`railway.json`).
- **Local dev:** `make start` (Vite on :5173, Supabase on :54321,
  dashboard :54323). Tests: `make test`; types: `make typecheck`.

## Related

- [[2026-07-08_adopt-second-brain-os]]
- [[2026-07-08_care-ai-crm-build-history]]
