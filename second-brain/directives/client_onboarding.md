# Client Onboarding

## What this workflow is

Turns a newly signed client into a complete client-intelligence folder and
a set of CRM records, so every future session starts with full context and
nothing agreed in the sales process gets lost. Run it the day a client
signs. **Draft — refine by running it once with the owner narrating
standards, then have the AI rewrite this file from that session.**

## Prerequisites

- Context: `context/company.md`, `context/core_values.md`
- Access to whatever raw material exists: call transcripts, email threads,
  the proposal, the signed agreement (drop them in `sources/`)
- CRM access if records should be created (`.env` with Supabase keys)

## Inputs

| Field | Required | Description |
|-------|----------|-------------|
| Client name | yes | Legal/trading name |
| Primary contact | yes | Name, role, email, phone |
| What was sold | yes | Offer, scope, price, timeline |
| Raw material | no | Transcripts/threads/proposal in `sources/` |

## Process

- **Step 1: Create the client folder** — copy `clients/_template/` to
  `clients/<client_slug>/`.
- **Step 2: Draft profile.md** — from the raw material, not from memory:
  who they are, their business, goals, current stack. Mark unknowns
  `[FILL IN]` and list the questions to ask.
- **Step 3: Draft rules.md** — every hard commitment from the sales
  process: compliance constraints, approval flow, banned topics/words,
  billing terms. Quote the source (which email, which call, dated).
- **Step 4: Draft preferences.md** — style, tone, formatting, pet peeves
  observed so far.
- **Step 5: Start history.md** — first dated entry: what was sold, when,
  by whom, and anything promised.
- **Step 6: Create CRM records** — company, contacts, and the won deal in
  CARE AI CRM (deterministic; script this once the fields are settled).
- **Step 7: Owner review** — owner corrects the four files; corrections
  get encoded, not just fixed inline.

## Quality gates

- [ ] Zero fabricated facts; every claim traces to a source or is `[FILL IN]`
- [ ] rules.md captures every commitment made during the sale, dated
- [ ] history.md has its first dated entry
- [ ] The AI could brief a stranger on this client from the folder alone

## Edge cases

- No transcripts or emails exist -> interview the owner with the profile
  questions instead; note answers as owner-reported with today's date.
- Client is a person, not a company -> same folder, profile.md notes the
  difference; CRM record is a contact without a company.
