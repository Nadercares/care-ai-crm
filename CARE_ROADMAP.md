# CARE AI CRM — Multi-Agent System Roadmap

> **CARE** = Claims Advocate Resolution Experts — a public adjusting firm.
> This document is the master plan for turning the existing CRM into a
> multi-agent system that helps the firm run claims every day.
>
> It is written for a **beginner**. Every stage explains *what* you do,
> *why* it matters, the *steps*, and how you know you are *done*.

---

## 1. What we are building (in plain English)

A public adjuster represents the **policyholder** (the insured client) in an
insurance claim — not the insurance company. The work involves reading
policies, tracking deadlines, comparing repair estimates, negotiating with
carrier adjusters, and accounting for settlement money.

We are building a CRM (Customer Relationship Management app) where a team of
**AI agents** does the heavy lifting. Picture a digital office:

- **The Orchestrator (the "lead agent")** is the office manager. It looks at a
  claim, decides which specialists are needed, and hands them work.
- **9 specialist agents** are employees who each do one job extremely well.
- **The CRM** is the building: the filing cabinets (database) and the desks
  (the screens your staff use).

### What an "AI agent" actually is (important for beginners)

An AI agent here is **not** a separate robot or a separate program running on
its own computer. Each agent is just three things:

1. **A system prompt** — a block of written instructions that tells Claude
   (the AI model) what role to play and what rules to follow.
2. **Tools** — small, safe functions the agent is allowed to call to read or
   write claim data (for example: "get policy", "save a letter", "create a
   task").
3. **A record in the database** of what it did and what it produced.

Every agent runs inside a **Supabase Edge Function** (a small program on the
server) and they all call the **same Claude API**. The difference between
"Agent 1" and "Agent 5" is mostly their system prompt and which tools they can
use.

---

## 2. The agent roster

| #  | Agent | What it does | Main output |
|----|-------|--------------|-------------|
| 0  | **Orchestrator (Lead)** | Oversees all other agents. Reads a claim, decides which agents to run and in what order, hands off work, and tracks progress. | A delegation log + claim status |
| 1  | **Policy Review** | Reads and interprets coverages, endorsements, exclusions, limits, deductibles. | A 1–2 page plain-language summary for the client |
| 2  | **State Compliance** | Finds state-specific rules/regulations so the firm stays compliant for that claim in that state. | A compliance brief |
| 3  | **Documents & Email** | Auto-fills uploaded document templates with claim data. Monitors claim email and drafts replies. | Filled documents + draft email replies |
| 4  | **Weather Research** | For weather-related claims, researches weather/storm data and builds a report with map images of the property and the storm. | A weather report (PDF/markdown + map images) |
| 5  | **Strategy & Research** | Reviews policy data and carrier patterns (from their letters/emails) and suggests how to position the claim per policy language and state law. | A strategy memo |
| 6  | **Estimate Comparison** | Compares the carrier's estimate against the contractor/PA Xactimate estimate, line by line. | A difference report + a negotiation letter |
| 7  | **Comptroller / Bookkeeper** | Tracks money received, CARE fees owed, expenses, and "written vs settled" differences. Keeps running settlement averages by carrier. | A claim ledger + settlement statistics |
| 8  | **Data & Reporting** | Tracks carrier adjusters (names, license numbers, contacts), carrier patterns, and template-letter usage. Builds reports on demand. | Reports + a carrier/adjuster knowledge base |
| 9  | **Security** | Protects the data and the app: access rules, audit logging, secret management, monitoring. | Hardened access control + audit trail |

---

## 3. Architecture (how the pieces fit)

```
   ┌─────────────────────────────────────────────┐
   │  Web browser — the React app (on Railway)   │
   │  Staff log in here. NO secret keys live here.│
   └───────────────────────┬─────────────────────┘
                            │  logged-in request (carries the user's token)
                            ▼
   ┌─────────────────────────────────────────────┐
   │  Supabase Edge Functions (server programs)  │
   │  THE ONLY PLACE THE ANTHROPIC API KEY LIVES │
   │   • ai-chat        — the assistant sidebar  │
   │   • agent          — runs one specialist    │
   │   • orchestrator   — the lead agent         │
   └───────┬─────────────────────────┬───────────┘
           │                         │
           ▼                         ▼
   ┌───────────────┐      ┌────────────────────────┐
   │ Anthropic     │      │ Supabase Postgres DB    │
   │ Claude API    │      │ claims, policies,       │
   │ (the AI model)│      │ agent_runs, outputs…    │
   └───────────────┘      └────────────────────────┘
```

**The golden security rule:** the browser must **never** see the Anthropic API
key (or any other secret key). Secret keys only live on the server (Supabase
Edge Functions). The browser only ever holds the logged-in user's short-lived
session token. This is why Stage 1 moves the AI calls off the browser.

### Technology stack (already chosen)

- **Frontend:** React 19 + TypeScript + Vite (the existing Atomic CRM base)
- **Backend:** Supabase — PostgreSQL database + Auth + file Storage + Edge Functions
- **AI:** Anthropic Claude API, called only from Edge Functions
- **Hosting:** Railway for the frontend website; Supabase Cloud for the backend
- **Editor:** Visual Studio Code (VS Code)

---

## 4. Before you write code — set up your computer and VS Code

Do this once. (If you are reading this in Claude Code on the web, the cloud
environment already has these tools — this section is for working on your own
laptop.)

1. **Install VS Code** — https://code.visualstudio.com/ → download → install.
2. **Install Node.js 22 LTS** — https://nodejs.org/ → download the "LTS"
   version → install. Check it worked: open VS Code, open the Terminal
   (menu: Terminal → New Terminal), type `node --version` — you should see
   `v22.x.x`.
3. **Install Git** — https://git-scm.com/downloads → install. Check:
   `git --version`.
4. **Install Docker Desktop** — https://www.docker.com/products/docker-desktop/
   → install → open it once so it is running. Supabase needs Docker to run a
   database on your computer.
5. **Install "Make"** — on macOS it comes with Xcode command-line tools
   (`xcode-select --install`); on Windows use WSL or Git Bash.
6. **Get the code into VS Code:**
   - In VS Code: `File → Open Folder` and pick where you want the project.
   - Open the Terminal and run:
     ```sh
     git clone https://github.com/Nadercares/care-ai-crm.git
     cd care-ai-crm
     git checkout claude/multi-agent-crm-system-zGcBq
     make install
     ```
7. **Recommended VS Code extensions** (Extensions panel, left sidebar):
   - *ESLint* — highlights code mistakes
   - *Prettier* — auto-formats code
   - *Tailwind CSS IntelliSense* — autocompletes styling classes
   - *Deno* — for editing Edge Functions (Supabase functions use Deno)
8. **Run the app locally:**
   ```sh
   make start
   ```
   Then open http://localhost:5173/ in your browser.

> **Tip:** Save your work often. After each working change, in the VS Code
> Terminal run `git add -A`, then `git commit -m "describe what you did"`.
> When a stage is finished, run `git push`.

---

## 5. Accounts and API keys you will need

Collect these as you reach the stage that needs them. Keep them secret.

| Key / account | Used by | Where to get it | Needed at |
|---------------|---------|-----------------|-----------|
| **Supabase project** | The whole backend | https://supabase.com (free tier to start) | Stage 1 |
| **Anthropic API key** | Every AI agent | https://console.anthropic.com → API Keys | Stage 1 |
| **Railway account** | Hosting the website | https://railway.app | Already wired up; used at Stage 13 |
| **Postmark account** | Inbound/outbound email | https://postmarkapp.com | Stage 6 |
| **Weather data API** | Weather agent | NOAA is free (api.weather.gov); or a paid provider for history | Stage 7 |
| **Static map images** | Weather agent | A mapping provider (e.g. Mapbox static images) | Stage 7 |

> **Never** paste a secret key directly into code or commit it to Git. Keys go
> into environment variables / Supabase secrets only (explained in Stage 1).

---

## 6. The build stages

Each stage is a self-contained chunk of work. Do them in order. Finish, test,
commit, and push a stage before starting the next.

### Stage 0 — Foundation (ALREADY DONE)

The repository already has:
- The Atomic CRM base app, forked and renamed **CARE AI CRM**.
- A dark navy + gold theme.
- A basic AI chat sidebar (it currently calls the AI in an insecure way — Stage
  1 fixes that).
- A Railway deployment configuration.

✅ Nothing to do here — this is the starting point.

---

### Stage 1 — Secure AI backend + core data model + roles  ✅ DONE

**Goal:** Move all AI calls to the server so no secret key is exposed, and
build the database tables the whole system stands on.

**Why it matters:** The current chat sends the API key from the browser —
anyone could open the browser tools and steal it. A claims firm handles
sensitive personal data, so this must be fixed *first*. We also need a place
to store claims, policies, and agent results before any agent can exist.

**Steps:**
1. Create a Supabase Edge Function `ai-chat` that:
   - Requires the caller to be logged in.
   - Holds the Anthropic key as a server secret.
   - Calls Claude and streams the answer back as plain text.
2. Change the browser chat code to call that Edge Function instead of calling
   the AI provider directly.
3. Create the database migration that adds the foundation tables:
   `carriers`, `carrier_adjusters`, `policies`, `document_templates`,
   `task_templates`, `task_template_items`, `agent_runs`, `agent_outputs`;
   plus claim fields on the existing `deals` table and a `role` column on
   `sales`.
4. Turn on Row Level Security (RLS) for every new table.

**Done when:** The chat sidebar still works, but the browser no longer holds
any API key, and the new tables exist in the database.

> Delivered: `ai-chat` Edge Function + the foundation migration
> (`20260521120000_care_multi_agent_foundation.sql`).

---

### Stage 2 — The agent engine (Orchestrator + shared runtime + tools)  ✅ DONE

**Goal:** Build the reusable machinery that *all* agents share.

**Why it matters:** Without a shared engine you would rewrite the same plumbing
nine times. Build it once, well.

**Steps:**
1. Build an `agent` Edge Function: input is `(agentType, claimId, input)`; it
   loads that agent's system prompt, gives Claude the allowed tools, runs the
   conversation loop, and saves the result into `agent_outputs`.
2. Build the **tool layer** — small server functions agents may call, e.g.
   `get_claim`, `get_policy`, `save_output`, `create_task`, `log_activity`.
3. Build the **Orchestrator** Edge Function (Agent 0): given a claim, it
   decides which agents to run, calls them, and records the plan in
   `agent_runs` (parent/child rows).
4. Add an **Agents panel** in the claim screen: shows each agent, its status
   (idle / running / done / error), and a button to view its output.

**Done when:** From a claim screen you can press "Run" and watch the
orchestrator delegate to a placeholder agent that returns a result.

> Delivered: the agent runtime in `supabase/functions/_shared/agents/`
> (anthropic client, tools, registry of all 9 agents, run loop), the `agent`
> and `orchestrator` Edge Functions, and the **AI Agents** panel on the claim
> screen. All 9 agents have working baseline prompts; Stages 4–12 deepen each
> one. Note: the panel can run agents now, but they only return real results
> once the `ANTHROPIC_API_KEY` secret is set on the server.

---

### Stage 3 — Template tasks & the daily task generator  ✅ DONE

**Goal:** Let a staff user define reusable task templates, and have the system
generate daily tasks automatically.

**Why it matters:** This is the "daily tasks set by the system user" feature.
It turns the firm's standard operating procedure into checklists the system
creates on its own.

**Steps:**
1. Build a **Task Templates** settings screen: create a template, add ordered
   task items, set which role each item is for and how many days after the
   trigger it is due.
2. Add a "cadence" to each template: `daily`, `weekly`, or `per claim stage`.
3. Build a scheduled job (Supabase scheduled function / cron) that runs each
   morning and creates the day's task instances from active templates.
4. Show generated tasks in the existing Tasks list, grouped by assignee.

**Done when:** You create a "New Claim Intake" template, and when a claim
enters a stage the matching tasks appear automatically.

> Delivered: the **Task Templates** page (open it from the user menu,
> top-right), the `generate-tasks` Edge Function, and a "Generate tasks now"
> button. Generated tasks appear in the normal Tasks list.
>
> **Automating the daily run:** the generator is idempotent, so running it
> repeatedly is safe. To run it every morning without clicking the button,
> schedule a daily `POST` to the `generate-tasks` function:
> - Easiest: in the Supabase dashboard go to **Integrations → Cron**, create a
>   job that runs daily and calls the `generate-tasks` Edge Function.
> - Or with SQL (`pg_cron` + `pg_net`):
>   ```sql
>   select cron.schedule(
>     'care-generate-tasks-daily', '0 13 * * *',
>     $$ select net.http_post(
>          url := 'https://<your-project-ref>.supabase.co/functions/v1/generate-tasks',
>          headers := '{"Authorization": "Bearer <service-role-key>", "Content-Type": "application/json"}'::jsonb,
>          body := '{}'::jsonb
>        ); $$
>   );
>   ```

---

### Stage 4 — Agent 1: Policy Review  ✅ DONE

**Goal:** An agent that reads a policy and explains it to the client.

**Steps:**
1. Add policy file upload (PDF) to the claim screen; store the file in Supabase
   Storage and a row in `policies`.
2. Give the agent a tool to read the uploaded policy text (PDF text extraction).
3. Write the Policy Review system prompt: extract coverages, endorsements,
   exclusions, limits, deductibles into structured data, then write a
   1–2 page plain-language summary.
4. Save the structured data into `policies` and the summary into
   `agent_outputs` as a reviewable draft.
5. Add a "Policy Summary" view with an Approve button.

**Done when:** Upload a policy → run the agent → read a clean client summary.

> Delivered: the **Insurance Policy** panel on the claim screen (upload a PDF,
> view it, see extracted data), the `extract-policy` Edge Function (pulls text
> out of the PDF with `unpdf`), the agent tools `get_policy_document` and
> `save_policy_details`, and an **Approve** button on every agent output. The
> Policy Review agent reads the document, writes the structured coverages back
> to the policy record, and produces the client summary as a reviewable draft.

---

### Stage 5 — Agent 2: State Compliance  ✅ DONE

**Goal:** An agent that surfaces the state-specific rules for a claim.

**Steps:**
1. Use the claim's loss state to drive the research.
2. Build a small, **curated** reference table of public-adjuster rules per
   state (license rules, contract rules, claim deadlines, fee caps). Start with
   the states the firm actually works in.
3. The agent reads that reference plus the claim facts and writes a compliance
   brief: deadlines, required disclosures, fee limits, and warnings.
4. It also creates compliance **tasks** (e.g. "send statutory disclosure by
   day 5").

**Done when:** Opening a claim shows an accurate compliance brief for its state.

> Delivered: the **State Compliance** page (open it from the user menu) with a
> row for every US state + DC for the firm to fill in with verified rules; the
> `get_state_compliance` agent tool; and the updated State Compliance agent,
> which reads the firm's reference for the claim's loss state, writes a
> compliance brief, and creates deadline tasks. The firm must enter verified
> rules per state — rows ship blank on purpose.

> **Important:** This is decision-support, not legal advice. Every brief must
> carry a disclaimer and be reviewed by a licensed professional.

---

### Stage 6 — Agent 3: Documents & Email automation  ✅ DONE

**Goal:** Auto-fill document templates and help manage claim email.

**Steps:**
1. **Templates:** let staff upload Word/PDF templates with placeholder tokens
   like `{{client_name}}`, `{{claim_number}}`, `{{date_of_loss}}`. Store the
   token list in `document_templates`.
2. **Auto-fill:** the agent maps claim data to tokens and generates a finished
   document, saved to Storage and linked to the claim.
3. **Email monitoring:** extend the existing Postmark inbound-email function so
   claim-related email is matched to a claim and stored.
4. The agent reads incoming email and drafts a reply for staff to review and
   send.

**Done when:** Pick a template + a claim → get a filled document; a new claim
email produces a draft reply.

> Delivered: the **Document Templates** page (user menu) for text templates
> with `{{token}}` fields; a **Documents & Email** panel on the claim screen to
> fill a template for the claim and to log claim emails; the agent tools
> `get_document_templates` and `get_claim_emails`; and the updated Documents &
> Email agent that fills documents and drafts replies (drafts land in the AI
> Agents panel).
>
> Scope note: templates are text bodies entered in the CRM (reliable and
> beginner-friendly) rather than uploaded Word/PDF files, and claim email is
> logged manually. Automatic Word/PDF generation and live Postmark inbound-mail
> matching are good future enhancements.

---

### Stage 7 — Agent 4: Weather Research  ✅ DONE

**Goal:** For weather-related claims, produce a weather/storm report.

**Steps:**
1. Detect weather-type losses (wind, hail, hurricane, flood) from the claim.
2. The agent calls a weather data API for the loss date and location (NOAA is
   free; a paid provider gives deeper history).
3. It fetches static **map images** showing the property and storm path/track.
4. It writes a weather report (conditions on the date of loss, storm proximity,
   hail/wind data) and saves it with the images to `agent_outputs`.

**Done when:** A hail claim produces a report with a property map and storm
data for the date of loss.

> Delivered: the `get_weather_data` agent tool, which geocodes the loss
> location (free US Census + ZIP lookups) and pulls historical daily weather
> from the free Open-Meteo archive (temperatures, precipitation, wind speed
> and gusts); the updated Weather Research agent that writes the report from
> that real data; and image rendering in the AI Agents panel so property maps
> show inline.
>
> Keys: weather data needs no API key. Property **map images** need a free
> `MAPBOX_TOKEN` Supabase secret — without it the report still works, just
> without the map. Gridded weather can understate hyper-local hail/wind, so
> the agent still points to official NOAA Storm Events records to verify.

---

### Stage 8 — Agent 5: Strategy & Carrier-Pattern Research  ✅ DONE

**Goal:** An agent that recommends how to position the claim.

**Steps:**
1. Give the agent read access to: the policy data, the compliance brief, and
   all stored carrier emails/letters for that carrier.
2. It analyzes carrier **patterns** (common denial reasons, delay tactics,
   favorite clauses) from history.
3. It produces a strategy memo: arguments supported by policy language and
   state law, and recommended next moves.

**Done when:** A claim shows a strategy memo citing specific policy clauses and
carrier patterns.

> Delivered: the **Carrier** panel on the claim screen — set the claim's
> carrier, record carrier notes/known patterns, and manage carrier adjusters
> (names, license numbers, contacts); the `get_carrier_intelligence` agent
> tool, which gathers the carrier record, adjusters, and correspondence across
> all of the firm's claims with that carrier; and the updated Strategy &
> Research agent, which reads the policy, compliance findings, carrier
> intelligence and correspondence to write a strategy memo.

---

### Stage 9 — Agent 6: Estimate Comparison & Negotiation

**Goal:** Compare carrier vs. contractor/PA estimates and draft a negotiation
letter.

**Steps:**
1. Import both estimates (Xactimate exports — start with PDF/CSV).
2. The agent matches line items and computes the differences (missing items,
   underpriced items, depreciation issues) into `estimate_comparisons`.
3. It drafts a negotiation letter explaining each difference and proposing a
   compromise figure.
4. Staff review, edit, and approve before anything is sent.

**Done when:** Two estimates produce a difference table and a draft
negotiation letter.

---

### Stage 10 — Agent 7: Comptroller / Bookkeeper

**Goal:** Track every dollar and the "written vs settled" gap.

**Steps:**
1. Add a `financial_ledger` table: payments received, CARE fees, expenses.
2. Add a `settlements` table: amount the PA wrote vs amount actually settled.
3. The agent reconciles money for each claim and flags discrepancies.
4. It maintains firm-wide stats: average settlement by carrier, average
   written-vs-settled ratio.
5. **Restrict** these screens to the `owner`/`accounting` roles.

**Done when:** A claim shows a correct ledger, and a dashboard shows settlement
averages by carrier.

---

### Stage 11 — Agent 8: Data & Reporting

**Goal:** A knowledge base and report generator.

**Steps:**
1. Build screens to manage `carriers` and `carrier_adjusters` (names, license
   numbers, license state, contact info).
2. The agent keeps the carrier "patterns" knowledge current and tracks which
   template letters are used and how often.
3. Build a report builder: pick a report type and date range, get a
   downloadable report.

**Done when:** You can pull a "carrier performance" report and an "adjuster
directory" on demand.

---

### Stage 12 — Agent 9: Security hardening

**Goal:** Lock the app down and prove it stays locked.

**Steps:**
1. Tighten Row Level Security so each role sees only what it should
   (e.g. only `owner`/`accounting` see financials).
2. Add an `audit_log` table that records every sensitive action (who, what,
   when).
3. Move every secret into Supabase secrets / environment variables; confirm
   none are in the code or in Git history.
4. Add rate limiting and input validation on every Edge Function.
5. Run Supabase's security advisor and fix all warnings.
6. Document a backup and recovery routine.

**Done when:** A non-admin account cannot reach financial data, and the
security advisor reports no warnings.

---

### Stage 13 — Production launch on the web server

**Goal:** Put the finished system online for the firm to use.

**Steps:**
1. Create the **production** Supabase project; push the database schema and all
   Edge Functions to it; set all production secrets.
2. Set the Railway project's environment variables to point at the production
   Supabase project.
3. Deploy the frontend to Railway (the `railway.json` config already exists).
4. Connect a custom domain and confirm HTTPS.
5. Create the firm's real user accounts with the correct roles.
6. Do a full end-to-end test with a real (sample) claim.
7. Train the staff and hand over this document.

**Done when:** Staff log in at the firm's domain and run a real claim
end-to-end.

---

## 7. Security & compliance (read this — it is a real firm)

- This system handles **personal and financial data** of real clients. Treat
  every shortcut as a future breach.
- The AI agents produce **drafts and decision-support**, never final legal or
  coverage decisions. A licensed professional reviews and approves everything
  that leaves the firm.
- Every AI output is stored as a reviewable **draft** with an explicit Approve
  step — agents do not send email or letters on their own.
- Secrets (API keys, passwords) live only in Supabase secrets / Railway
  environment variables — never in code, never in Git.
- Row Level Security is on for every table from Stage 1, and tightened by role
  in Stage 12.

## 8. Cost awareness

- **Claude API** is billed per use. Prompt caching (reusing the same policy or
  claim context) is turned on to cut cost — long shared context is cached.
- Start every agent on a cheaper/faster model and only upgrade the model for
  the agents that need the most reasoning.
- Supabase and Railway both have free tiers fine for building; you will move to
  paid tiers around Stage 13.

## 9. Glossary

| Term | Plain meaning |
|------|---------------|
| **Supabase** | The backend service: database + login + file storage + small server functions. |
| **Edge Function** | A small program that runs on Supabase's servers (not in the browser). |
| **Migration** | A file of database instructions that creates/changes tables. |
| **RLS (Row Level Security)** | Database rules deciding which rows each user may see or change. |
| **System prompt** | The written instructions that define an agent's role. |
| **Tool** | A function an agent is allowed to call to read or write data. |
| **Orchestrator** | The lead agent that delegates work to the others. |
| **Claim** | A policyholder's insurance claim — the central record in this CRM. |
| **Carrier** | The insurance company. |
| **Xactimate** | The industry-standard software for writing repair estimates. |

---

*This roadmap is a living document. Update a stage's steps as you learn more
while building it.*
