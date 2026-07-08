# Follow-Up Email

## What this workflow is

Drafts a follow-up email to a prospect or client that sounds like Nader,
respects everything already agreed, and always contains exactly one clear
ask. Use after any call, proposal, or period of silence. **Draft — refine
after the first real run.**

## Prerequisites

- Context: `context/brand_voice.md` (mandatory), `context/owner.md`
- If a client: their `clients/<name>/` folder, especially `rules.md` and
  `history.md`
- Skill file, once it exists: `skills/SKILL_BIBLE_follow_up_emails.md`

## Inputs

| Field | Required | Description |
|-------|----------|-------------|
| Recipient | yes | Who, and prospect vs. client |
| Trigger | yes | What happened (call, proposal sent, 2 weeks silence...) |
| Desired outcome | yes | The ONE thing this email should cause |
| Raw material | no | Call notes/transcript/last thread |

## Process

- **Step 1: Load context** — brand voice; the client folder if applicable;
  the relevant history.md entries.
- **Step 2: Draft (AI)** — subject + body. Under 150 words unless the
  material demands more. One ask, stated plainly. Reference something
  specific and real from the last interaction.
- **Step 3: Self-check (AI)** — run the quality gates below; fix before
  showing the owner.
- **Step 4: Deliver as draft** — the owner sends; the AI never sends
  outbound email on its own.
- **Step 5: Log it** — if a client, add a dated line to their history.md.

## Quality gates

- [ ] Passes brand_voice.md (no banned words, right tone)
- [ ] Exactly one ask
- [ ] References a specific, real detail from the last interaction
- [ ] Nothing contradicts the client's rules.md or history.md
- [ ] No invented facts, numbers, or commitments

## Edge cases

- No prior interaction detail available -> ask the owner for one real
  detail rather than writing something generic.
- The honest next step is "no follow-up yet" -> say so instead of forcing
  an email.
