# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Identity

CARE AI CRM is a customized fork of **Atomic CRM** (an open-source React + Supabase
CRM by Marmelab), rebranded and extended for **C.A.R.E. Claims**, an insurance
claims advocacy firm.

The base Atomic CRM architecture, directory layout, database workflows, and
conventions are documented in **AGENTS.md**, imported below. Read it first — it is
the source of truth for everything not explicitly overridden here. This file
documents the CARE-specific layer built on top.

@AGENTS.md

## CARE-specific layer

The fork adds a thin layer over upstream Atomic CRM rather than modifying its
internals. New code lives outside `src/components/atomic-crm/` so upstream files
stay easy to update.

- **`src/App.tsx`** — renders `<CRM title="CARE AI CRM" i18nProvider={careI18nProvider} />`
  alongside `<ChatPanel />`. This is the integration point for everything below.
- **`src/components/care-ai/`** — the AI chat sidebar: `ChatPanel` (floating gold
  button + slide-out panel), `ChatInput`, `ChatMessage`. Self-contained, not wired
  into the react-admin resource system.
- **`src/api/chat.ts`** — `streamChat()`, an async generator that streams
  completions directly from the OpenRouter API (`anthropic/claude-3-haiku`). It
  parses Server-Sent Events by hand. The system prompt defines the C.A.R.E. claims
  domain and pipeline (New Lead → Claim Filed → Adjuster Assigned → Adjuster
  Meeting → Negotiation → Settlement → Closed Won/Lost).
- **`src/api/i18nProvider.ts`** — `careI18nProvider` wraps the base Atomic CRM
  i18n provider and overrides specific keys (e.g. auth screen title) for branding.
  Add branding string changes here rather than editing upstream message files.

### AI chat configuration

`streamChat()` reads `VITE_OPENROUTER_API_KEY` via `import.meta.env`. Because the
call is made from the browser, this key is bundled into the client build and is
visible to end users — treat it as a publishable/restricted key, not a secret.
The chat panel currently has no access to live CRM data; it only knows the domain
described in its system prompt.

### Branding & theme

- The theme is dark navy (`#162C52`) + gold (`#C9A84C`). Theme tokens live in
  `src/index.css`; the care-ai components also use inline styles with these hex
  values.
- `index.html` contains two pre-React patches: it forces `localStorage.theme` to
  `dark` before React mounts (to avoid a white flash), and it rewrites any stored
  CRM config whose `title` still reads `"Atomic CRM"` to `"CARE AI CRM"`. Keep
  these in sync if branding changes.
- Note: the claims pipeline stages described in the chat system prompt are **not**
  yet reflected in `<CRM>`'s `dealStages` prop — `defaultConfiguration.ts` still
  ships the generic Atomic CRM stages.

## Commands beyond AGENTS.md

AGENTS.md covers `make install/start/stop/test/typecheck/lint/build` and the
Supabase database workflow. Additional commands relevant here:

```bash
make test-app              # unit tests for the app only (vitest)
make test-functions        # unit tests for Supabase edge functions only
make test-e2e              # Playwright e2e in UI mode (spins up a fresh e2e Supabase + Vite)
make test-e2e-ci           # Playwright e2e headless against the built app
make storybook             # Storybook on port 6006
make start-demo            # run with the in-browser FakeRest provider (no Supabase)

# Run a single unit test file or pattern:
npm run test:unit:app -- src/path/to/file.test.ts
npm run test:unit:app -- -t "test name pattern"
```

- Unit tests: `*.test.ts` / `*.test.tsx`, colocated anywhere under `src/`.
- E2e tests: `*.spec.ts` under `e2e/`. The e2e stack uses a *separate* Supabase
  instance (`.supabase-e2e/`, config `supabase/config.e2e.toml`, env `.env.e2e`)
  so it gets a fresh database every run.
- CI runs `.github/workflows/check.yml`; `deploy.yml` handles deployment.

## Deployment

The app is deployed on **Railway** (`railway.json`): `npm run build` produces
`dist/`, and `npm start` serves it statically via the `serve` package on `$PORT`.
This is distinct from the upstream GitHub Pages / `ghpages:deploy` path.

## Working conventions

- Keep CARE customizations in `src/api/`, `src/components/care-ai/`, `src/App.tsx`,
  `index.html`, and `src/index.css`. Avoid editing files under
  `src/components/atomic-crm/` unless a change genuinely belongs upstream — that
  directory tracks Atomic CRM and is the mutable dependency described in AGENTS.md.
- Run `make typecheck` and `make lint` before committing; a pre-commit hook
  regenerates `registry.json`.
