# Decision: Adopt a second-brain AI operating system

**Date:** 2026-07-08
**Status:** Active

## What was decided

Run CARE AI on a file-based AI operating system inside this repo
(`second-brain/`), following the DobotAI "Second Brain Blueprint"
(Doby Lanete, 2026-07-05): DOE architecture — Directives (markdown SOPs),
Orchestration (the AI agent), Execution (deterministic scripts) — plus
context files, a skills library, client folders, and this linked-notes
brain.

## Because

- Chat sessions lose everything when they end; a folder of plain text
  compounds instead. The asset is the folder, not the model — when models
  get replaced, the next one reads the same files and continues same-day.
- The AI should operate parts of the business (deliverables, research,
  follow-ups, pipeline review), not just answer questions.
- Git makes every change the AI makes tracked and reversible.

## Consequences

- The brain lives in `second-brain/` alongside the CRM code, versioned in
  the same git repo (`nadercares/care-ai-crm`).
- Standing rules apply to all AI work here: never fabricate facts, date
  everything, specifics over summaries, self-anneal after every task.
- Next: fill the context files, then run the seven-day build order in
  `second-brain/README.md`.

## Related

- [[2026-07-08_care-ai-crm-stack]]
- [[2026-07-08_care-ai-crm-build-history]]
