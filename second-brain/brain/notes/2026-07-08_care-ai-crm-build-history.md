# Note: CARE AI CRM build history (phases shipped so far)

**Date:** 2026-07-08 (reconstructed from git history on this date)

The CRM customization has shipped in three phases on top of the Atomic
CRM base:

1. **Phase 1 — CARE AI chat sidebar.** Claude-powered assistant panel
   inside the CRM. One fix along the way: surface real error messages in
   the chat panel and correct the model name (claude-3-haiku).
2. **Phase 2 — Theme.** Dark navy + gold, later refined to the "Royal
   Navy" theme; forced dark mode; rebranded all Atomic CRM text to
   CARE AI CRM (including a localStorage title patch fix).
3. **Phase 3 — Deployment.** Railway deployment config and serve script.

## Lesson

The build is proceeding in small, named phases, each a working increment
— the same pattern the second brain uses (three SOPs that run clean beat
twenty that half-work).

## Related

- [[2026-07-08_care-ai-crm-stack]]
- [[2026-07-08_adopt-second-brain-os]]
