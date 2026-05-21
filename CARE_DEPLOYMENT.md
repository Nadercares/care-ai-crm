# CARE AI CRM — Deployment Guide (Roadmap Stage 13)

This guide takes the finished app and puts it online for the firm to use. It
is written for a beginner — follow it top to bottom.

You will set up two things:

- **Supabase** — the backend: database, login, file storage, and the AI Edge
  Functions. This is where the secret keys live.
- **Railway** — the website (the screens staff use in their browser).

Plan about **60–90 minutes** for a first deployment.

---

## Prerequisites

- The project open in VS Code, on the `claude/multi-agent-crm-system-zGcBq`
  branch, with `make install` already run.
- A terminal in VS Code (Terminal → New Terminal).
- Accounts (all have free tiers): **Supabase** (supabase.com), **Railway**
  (railway.app), **Anthropic** (console.anthropic.com). Optional: **Mapbox**
  (account.mapbox.com) for weather maps, **Postmark** (postmarkapp.com) for
  email.
- The Supabase CLI. Check with `npx supabase --version` (it is already a dev
  dependency, so `npx supabase ...` works).

> **Golden rule:** secret keys (Anthropic, service-role) go into Supabase only.
> They must never be put in Railway, in the code, or in Git.

---

## Part 1 — Create the production Supabase backend

1. Go to https://supabase.com → **New project**. Pick a name (e.g.
   `care-ai-crm-prod`), set a strong database password (save it somewhere
   safe), choose the region closest to the firm, and create it.
2. Wait for the project to finish provisioning (~2 minutes).
3. Find your **project ref**: Supabase dashboard → Project Settings → General →
   "Reference ID" (a string like `abcdefghijklmnop`).
4. In the VS Code terminal, link this repo to the project:
   ```sh
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```
   `login` opens a browser to authorize; `link` will ask for the database
   password from step 1.
5. Push the database — this creates every table, view, trigger, security
   policy, and the `attachments` storage bucket:
   ```sh
   npx supabase db push
   ```
6. Deploy all the Edge Functions (the AI agents and helpers):
   ```sh
   npx supabase functions deploy
   ```

✅ The backend now has the full schema and all functions.

---

## Part 2 — Set the secret keys

These are set **on Supabase** so they stay off the browser.

1. Get an Anthropic API key: https://console.anthropic.com → API Keys →
   Create Key. It starts with `sk-ant-`.
2. Set the secrets:
   ```sh
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-real-key
   ```
3. Optional — weather map images:
   ```sh
   npx supabase secrets set MAPBOX_TOKEN=your-mapbox-token
   ```
4. Optional — inbound email (only if using Postmark): set
   `POSTMARK_WEBHOOK_USER`, `POSTMARK_WEBHOOK_PASSWORD`, and
   `VITE_INBOUND_EMAIL` the same way.
5. Confirm what is set:
   ```sh
   npx supabase secrets list
   ```

> If you change a secret later, re-deploy the functions:
> `npx supabase functions deploy`.

---

## Part 3 — Deploy the website to Railway

1. Get your Supabase **API details**: Supabase dashboard → Project Settings →
   API. Copy the **Project URL** and the **publishable (anon) key**.
2. Push the branch to GitHub if you have not already:
   ```sh
   git push -u origin claude/multi-agent-crm-system-zGcBq
   ```
3. Go to https://railway.app → **New Project** → **Deploy from GitHub repo** →
   pick `nadercares/care-ai-crm`.
4. In Railway → your service → **Settings**, set the deploy branch to
   `claude/multi-agent-crm-system-zGcBq` (or merge it to `main` first and use
   `main`). The build is already configured by `railway.json`
   (build: `npm run build`, start: `npm start`).
5. In Railway → your service → **Variables**, add these (see
   `.env.production.example` for the full list):
   | Variable | Value |
   |----------|-------|
   | `VITE_SUPABASE_URL` | your Supabase Project URL |
   | `VITE_SB_PUBLISHABLE_KEY` | your Supabase publishable key |
   | `VITE_IS_DEMO` | `false` |
   | `VITE_ATTACHMENTS_BUCKET` | `attachments` |
   | `VITE_INBOUND_EMAIL` | your inbound email address (or leave unset) |
6. Railway builds and deploys automatically. When it finishes, open the URL
   Railway gives you (something like `care-ai-crm-production.up.railway.app`).

✅ The website is live.

---

## Part 4 — Custom domain and HTTPS

1. In Railway → your service → **Settings → Networking → Custom Domain**, add
   the firm's domain (e.g. `crm.carefirm.com`).
2. Railway shows a CNAME record. Add it at your domain registrar (GoDaddy,
   Namecheap, etc.).
3. Wait for DNS to propagate (minutes to a couple of hours). Railway issues an
   HTTPS certificate automatically — the site will be reachable at
   `https://your-domain`.

---

## Part 5 — Create the firm's users and roles

1. Open the live site. The first time, you are prompted to create the first
   user — this person becomes the administrator.
2. Sign in, then from the user menu add the rest of the staff (Users screen).
3. Set each person's **role** so permissions are correct. Roles:
   `owner`, `admin`, `adjuster`, `accounting`, `viewer`. Only `owner`,
   `accounting`, and administrators can see the financial screens and the
   audit log.
   - To set a role today, update the `role` column on the person's row in the
     `sales` table (Supabase dashboard → Table Editor → `sales`). A built-in
     role picker in the Users screen is a good future enhancement.

---

## Part 6 — End-to-end smoke test

Run through one real (sample) claim to confirm everything works:

1. Create a **company** (the client) and a **contact**.
2. Create a **claim** (a deal) — set the stage, claim number, date of loss,
   loss type, loss state, and a loss address or ZIP.
3. Open the claim. Set the **carrier** in the Carrier panel.
4. Upload a **policy PDF** in the Policy panel; confirm "Text extracted".
5. In the **AI Agents** panel, press **Run Orchestrator**. Watch the agents
   run and produce drafts. Approve one.
6. Run **Policy Review**, **State Compliance**, and **Weather Research**
   individually and read their outputs.
7. Add two **estimates** and press **Compare & draft letter**.
8. As an owner/accounting user, open **Claim Financials**, add a settlement
   and a ledger entry, then check the **Audit Log** page shows the change.
9. From the user menu, generate a **Report**.

If every step produces a result, the system is working.

---

## Part 7 — Post-launch checklist

- **Security advisor:** Supabase dashboard → Advisors → run it and clear any
  warnings.
- **Backups:** Supabase dashboard → Database → Backups — confirm automatic
  daily backups are on (paid plans). Take a manual backup before any risky
  change.
- **Costs:** watch Anthropic usage at console.anthropic.com. The agents use
  prompt caching to reduce cost; start agents on a cheaper model if needed by
  setting the `ANTHROPIC_MODEL` secret.
- **Monitoring:** Supabase dashboard → Edge Functions → Logs shows agent
  errors. The most common error is a missing or wrong `ANTHROPIC_API_KEY`.

---

## Updating the app later

After making changes in this repo:

```sh
git push                              # Railway redeploys the website automatically
npx supabase db push                  # apply any new database migrations
npx supabase functions deploy         # redeploy any changed Edge Functions
```

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Chat or agents return an error | `ANTHROPIC_API_KEY` not set on Supabase, or wrong. Re-set it and `npx supabase functions deploy`. |
| "Could not load …" in a panel | The database migration was not applied. Run `npx supabase db push`. |
| Agents never finish | Check Supabase → Edge Functions → Logs for the `agent`/`orchestrator` function. |
| Website shows a blank page | A `VITE_` variable is missing in Railway. Check the Variables tab, then redeploy. |
| Financial panels are empty for an owner | That user's `role` is not `owner`/`accounting` and they are not an administrator. Fix the `role` in the `sales` table. |
| Policy text not extracted | The PDF is a scanned image with no selectable text. Use a text-based PDF. |
| Weather report has no map | `MAPBOX_TOKEN` is not set. The report still works without it. |
