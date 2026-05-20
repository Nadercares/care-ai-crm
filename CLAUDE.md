# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The `AGENTS.md` content above describes the upstream Atomic CRM architecture and still
applies. This repository is a **fork customized for C.A.R.E. Claims**, an insurance claims
advocacy firm. The sections below cover what this fork adds or changes, plus details that
`AGENTS.md` omits.

## CARE AI CRM (this fork)

`src/App.tsx` is the only application entry-point change: it renders the upstream `<CRM>`
component with a CARE title and a custom `i18nProvider` (`src/api/i18nProvider.ts`), and
mounts a floating `<ChatPanel />` AI assistant as a sibling **outside** `<CRM>` — so the
chat panel lives apart from the ra-core/dataProvider stack.

### AI Chat Assistant (`src/components/care-ai/`)

- `ChatPanel.tsx` — floating gold toggle button + slide-out panel; owns message state and streaming.
- `ChatInput.tsx`, `ChatMessage.tsx` — presentational.
- `src/api/chat.ts` — `streamChat()`, an async generator that POSTs to the OpenRouter
  chat-completions API and yields SSE token chunks. Uses model `anthropic/claude-3-haiku`
  with a claims-domain system prompt. That prompt frames deals as a claims pipeline
  (New Lead → Claim Filed → Adjuster Assigned → Adjuster Meeting → Negotiation →
  Settlement → Closed Won/Lost) — this framing exists **only in the prompt**; the CRM's
  actual deal stages still use upstream defaults unless `<CRM>` deal props are set.
- Requires the `VITE_OPENROUTER_API_KEY` env var (not present in `.env.development`;
  without it the panel returns an OpenRouter auth error). Being `VITE_`-prefixed, the key
  is bundled into the client build — keep that in mind before relying on it in production.
- The assistant does not yet read CRM data; the system prompt instructs it to say so.

## Testing

Tests run in three layers (`AGENTS.md` only mentions `make test`):

- **App unit tests** — `npm run test:unit:app` (config `vitest.config.ts`). Run in a
  **real Chromium browser** via `@vitest/browser-playwright`, not jsdom. Files named
  `*.test.ts`/`*.test.tsx` anywhere under `src/`.
- **Edge-function unit tests** — `npm run test:unit:functions` (config
  `vitest.functions.config.ts`). Run in Node, cover `supabase/functions/**/*.test.ts`.
  The config aliases Deno `jsr:`/`npm:` imports to npm packages so Deno-targeted function
  code runs under Vitest without a Deno runtime.
- **E2E** — Playwright specs in `e2e/`, run against a dedicated **fresh** Supabase
  instance booted in `.supabase-e2e/`. `make test-e2e` opens Playwright UI mode against
  the Vite dev server; `make test-e2e-ci` runs headless against the built app.

`make test-unit` = app + functions. `make test` = unit + e2e-ci.

Run a single test:
- `npx vitest --config vitest.config.ts run src/path/to/x.test.tsx`
- `npx vitest --config vitest.config.ts run -t "test name substring"`
- `npx playwright test e2e/onboarding.spec.ts`

Browser-mode app tests need Chromium installed: `npx playwright install chromium-headless-shell`.

## Other tooling

- **Storybook** — `make storybook` (port 6006). Stories use `src/test/StoryWrapper.tsx`.
- **Docs site** — `doc/` is a separate project with its own `package.json`. Run
  `make doc-install` then `make doc-dev`. The canonical architecture deep-dive is
  `doc/src/content/docs/developers/architecture-choices.mdx`; other developer topics
  (custom fields, data providers, migrations, SSO, deploy) live alongside it.
- **CI** (`.github/workflows/check.yml`) — runs ESLint+Prettier, typecheck, app+function
  unit tests, e2e, and build on every PR. Reproduce locally with
  `make lint && make typecheck && make test`.

## Repo-local Claude config

- `.claude/skills/` holds two project skills — `backend-dev` (Supabase migrations, views,
  triggers, RLS, edge functions, dataProvider methods) and `frontend-dev` (React
  components, forms, lists, data fetching). Consult them when touching those areas.
- `.claude/hooks/format-file.sh` runs after every Edit/Write (PostToolUse hook) and
  auto-formats the touched file — no need to run Prettier manually after edits.
