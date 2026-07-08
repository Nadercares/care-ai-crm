# CARE AI — Second Brain Operating Manual

This folder is the business brain for CARE AI. Read this file first, every
session, before doing any work inside `second-brain/`.

## Architecture: DOE

The system separates into three layers. Respect the boundaries.

```
DIRECTIVES     (markdown files)   -> What to do: step-by-step SOPs in plain English
ORCHESTRATION  (the AI agent)     -> The decision maker: reads context, picks the SOP, checks quality
EXECUTION      (scripts)          -> How it gets done: deterministic code for API calls and file work
```

Why the split matters: AI models are probabilistic. Anything that should
produce the same output every time given the same input (API calls,
formatting, file operations, data processing) belongs in an execution
script. The AI does only what it is uniquely good at: reading context,
making judgment calls, and checking quality.

Two more principles:

- **Plain text is forever.** Everything in this system is a markdown file.
  No proprietary database, no vendor lock-in. The asset is the folder;
  models come and go.
- **The system improves itself.** See the self-annealing protocol below.

## Directory map

```
second-brain/
├── CLAUDE.md          - This file. The constitution. Read first, every session.
├── README.md          - What this is + the 7-day build order checklist.
├── context/           - Who we are: identity, voice, values, owner. Loaded before any work.
├── directives/        - SOPs: one markdown file per workflow, named by what it does.
├── execution/         - Deterministic scripts the directives call.
├── skills/            - Deep domain expertise files (SKILL_BIBLE_<topic>.md).
├── clients/           - One folder per client: profile, rules, preferences, history.
├── brain/             - Dated, linked notes: decisions, notes, references, metrics, ideas.
├── sources/           - Raw exports (transcripts, threads, docs) the brain is mined from.
└── .tmp/              - Scratch space for drafts. Never committed.
```

## Context loading priority

Before any task, load in this order:

```
1. context/company.md       -> Always first (who we are)
2. context/core_values.md   -> Always (how we operate; check work against it)
3. context/brand_voice.md   -> For any content creation
4. clients/{name}/*.md      -> For client-specific work
5. skills/relevant files    -> Domain expertise for the task
6. directives/the SOP       -> The workflow itself
```

## Orchestration flow

1. **Parse the request.** What is actually being asked for?
2. **Find the matching SOP** in `directives/`. If none exists and the task
   is repeatable, offer to create one after the work.
3. **Load context** per the priority list above.
4. **Execute**: follow the directive step by step, calling execution
   scripts for deterministic steps.
5. **Check quality** against the directive's quality gates and
   `context/core_values.md`.
6. **Deliver**, then run the self-annealing protocol.

## Standing rules

1. **Never fabricate numbers, results, or client names.** If a fact is
   unknown, use a clearly marked placeholder like `[FILL IN: ...]` and ask.
   Placeholders plus a question beat confident fiction, every time.
2. **Date everything, in the filename.** Brain notes are named
   `YYYY-MM-DD_slug.md`. An undated fact becomes a landmine the first time
   the business changes its mind.
3. **Extract specifics, not summaries.** Notes and skill files must contain
   numbers, names, exact phrasings, and templates — or they are too shallow
   to change output quality.
4. **Drafts go to `.tmp/`, never committed.** Secrets go to `.env`, never
   committed.
5. **Client work loads the client folder first** and never violates that
   client's `rules.md`.
6. **Commit brain changes with git.** Every change to this folder is
   tracked and reversible. Git is the undo button.

## Self-annealing protocol

After every task, ask:

- Did an error occur? -> Fix the script AND update the directive so it
  cannot break the same way twice.
- Was a better approach found? -> Update the relevant skill file.
- Did a new edge case appear? -> Add it to the SOP's edge-case section.
- Did the owner correct something? -> Encode the correction in the
  relevant context, client, or skill file.

Nothing breaks the same way twice, because every failure becomes an edit
to the system.

## Maintenance habits

- **Contradiction audit (every few weeks):** read `brain/` looking for
  notes that disagree (old pricing vs new, stale rosters, reversed
  decisions). Flag each pair; the owner rules on them.
- **Brain re-link (after every bulk import into `sources/`):** run the
  linking pass described in `brain/INDEX.md` — real relationships only,
  2–5 links per note, add-links-only, report orphans.
