# Execution scripts

Deterministic code the directives call. The rule of thumb: if a step
should produce the same output every time given the same input (API
calls, formatting, file operations, data processing), it lives here. If
it requires judgment, taste, or reading context, it stays with the AI.

Conventions:

- Every script starts with a docstring: what it does, which directive
  uses it, usage examples.
- Secrets come from `second-brain/.env` (see `.env.example`), never
  hardcoded.
- Scripts never invent data: on failure they exit non-zero with the real
  error instead of producing plausible output.
- Intermediate output goes to `.tmp/`, durable output goes where the
  directive says.

Current scripts:

| Script | Used by | What it does |
|--------|---------|--------------|
| `crm_pipeline_report.py` | `directives/weekly_pipeline_review.md` | Pulls open deals + tasks from CARE AI CRM into a raw markdown snapshot |
