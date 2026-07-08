# Weekly Pipeline Review

## What this workflow is

Produces a Monday-morning briefing from CARE AI CRM: every open deal by
stage, what moved last week, which deals and tasks are stalling, and the
three highest-leverage follow-ups for the week. **Draft — refine after the
first real run.**

## Prerequisites

- `.env` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- Execution script: `execution/crm_pipeline_report.py`
- Context: `context/company.md` (priorities section)

## Inputs

| Field | Required | Description |
|-------|----------|-------------|
| As-of date | no | Defaults to today |

## Process

- **Step 1: Pull the data (script)** — run
  `python execution/crm_pipeline_report.py`. It writes the raw pipeline
  snapshot to `.tmp/pipeline_<date>.md`. Deterministic; no judgment.
- **Step 2: Analyze (AI)** — read the snapshot. Identify: deals with no
  activity in 14+ days, overdue tasks, stage bottlenecks, and anything
  contradicting the current priorities in `context/company.md`.
- **Step 3: Write the briefing (AI)** — one page max: pipeline totals by
  stage, what changed, stalling items with a suggested next action each,
  and the top three follow-ups for the week with a draft first line for
  each.
- **Step 4: File it** — save to `brain/metrics/YYYY-MM-DD_pipeline.md` so
  week-over-week comparison is possible next run.

## Quality gates

- [ ] Every number comes from the script output, none invented
- [ ] Every stalling deal has a concrete suggested next action
- [ ] One page or less
- [ ] Saved to brain/metrics/ with today's date in the filename

## Edge cases

- Script fails / no CRM access -> report the failure and stop; do not
  estimate numbers from memory.
- Empty pipeline -> the briefing becomes a prospecting-focused note
  instead; say so explicitly.
