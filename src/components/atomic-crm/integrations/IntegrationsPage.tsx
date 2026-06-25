import { useCallback, useEffect, useState } from "react";
import { useNotify } from "ra-core";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Mail,
  Calendar,
  Box,
  CloudLightning,
  Sparkles,
  Scale,
  Clock,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { getSupabaseClient } from "../providers/supabase/supabase";

interface Health {
  anthropic: { configured: boolean; model: string | null };
  google_oauth: {
    configured: boolean;
    redirect_uri_configured: boolean;
    app_url_configured: boolean;
  };
  dropbox_oauth: { configured: boolean; redirect_uri_configured: boolean };
  hailtrace: { configured: boolean; base: string | null };
  cron: { secret_configured: boolean };
  service_role: { configured: boolean };
}

interface GmailConn {
  google_email: string;
  scopes: string[];
  last_synced_at: string | null;
  last_sync_status: string | null;
}

interface DropboxConn {
  dropbox_email: string | null;
  scopes: string[];
}

interface StateLawSummaryRow {
  state_abbr: string;
  status: string;
}

function IntegrationsPage() {
  const notify = useNotify();
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [gmail, setGmail] = useState<GmailConn | null>(null);
  const [dropbox, setDropbox] = useState<DropboxConn | null>(null);
  const [stateLawByState, setStateLawByState] = useState<
    Record<string, { active: number; draft: number }>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not signed in.");

      const healthRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/system-health`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (healthRes.ok) {
        const payload = (await healthRes.json()) as Health;
        setHealth(payload);
      } else {
        notify("Could not read server health.", { type: "warning" });
      }

      const [{ data: gmailRow }, { data: dropboxRow }, { data: stateLawRows }] =
        await Promise.all([
          supabase
            .from("gmail_connections")
            .select("google_email, scopes, last_synced_at, last_sync_status")
            .limit(1)
            .maybeSingle(),
          supabase
            .from("dropbox_connections")
            .select("dropbox_email, scopes")
            .limit(1)
            .maybeSingle(),
          supabase.from("state_law_summaries").select("state_abbr, status"),
        ]);
      setGmail(gmailRow ?? null);
      setDropbox(dropboxRow ?? null);

      const byState: Record<string, { active: number; draft: number }> = {};
      for (const row of (stateLawRows ?? []) as StateLawSummaryRow[]) {
        const bucket = (byState[row.state_abbr] ||= { active: 0, draft: 0 });
        if (row.status === "active") bucket.active += 1;
        else if (row.status === "draft") bucket.draft += 1;
      }
      setStateLawByState(byState);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), {
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4 p-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Per-user connections (Gmail, Dropbox) and server-side configuration
          (Anthropic API, HailTrace, cron). Setup hints appear wherever
          something isn't wired up yet.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking…
        </div>
      )}

      {!loading && health && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <IntegrationCard
            icon={<Sparkles className="h-4 w-4" />}
            title="Anthropic API"
            status={health.anthropic.configured ? "ok" : "missing"}
            statusLine={
              health.anthropic.configured
                ? `Configured · model ${health.anthropic.model ?? "default"}`
                : "ANTHROPIC_API_KEY not set"
            }
            help={
              !health.anthropic.configured && (
                <code className="text-[10px]">
                  npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
                </code>
              )
            }
            scope="server"
          />

          <IntegrationCard
            icon={<Mail className="h-4 w-4" />}
            title="Gmail (per user)"
            status={
              !health.google_oauth.configured
                ? "missing"
                : gmail
                  ? "ok"
                  : "warning"
            }
            statusLine={
              !health.google_oauth.configured
                ? "Google OAuth not configured server-side"
                : gmail
                  ? `Connected as ${gmail.google_email}`
                  : "OAuth configured but no Gmail connection on your account yet"
            }
            extra={
              gmail && (
                <ScopesBadgeRow
                  required={[
                    "https://www.googleapis.com/auth/gmail.modify",
                    "https://www.googleapis.com/auth/calendar.events",
                    "https://www.googleapis.com/auth/userinfo.email",
                  ]}
                  granted={gmail.scopes ?? []}
                  shortNames={{
                    "https://www.googleapis.com/auth/gmail.modify":
                      "gmail.modify",
                    "https://www.googleapis.com/auth/calendar.events":
                      "calendar.events",
                    "https://www.googleapis.com/auth/userinfo.email":
                      "userinfo.email",
                  }}
                />
              )
            }
            help={
              !health.google_oauth.configured && (
                <span className="text-[11px]">
                  Set <code>GOOGLE_OAUTH_CLIENT_ID</code>,{" "}
                  <code>GOOGLE_OAUTH_CLIENT_SECRET</code>,{" "}
                  <code>GMAIL_OAUTH_REDIRECT_URI</code>, and{" "}
                  <code>APP_URL</code>. See Phase 9 in
                  DEPLOYMENT_AND_REMOTE_ACCESS.md.
                </span>
              )
            }
            actionHref={gmail ? "/email_triage" : null}
            actionLabel="Open Email Triage"
            scope="per-user"
          />

          <IntegrationCard
            icon={<Calendar className="h-4 w-4" />}
            title="Google Calendar"
            status={
              gmail?.scopes?.includes(
                "https://www.googleapis.com/auth/calendar.events",
              )
                ? "ok"
                : gmail
                  ? "warning"
                  : "missing"
            }
            statusLine={
              !gmail
                ? "Connect Gmail first (same Google account)"
                : gmail.scopes?.includes(
                      "https://www.googleapis.com/auth/calendar.events",
                    )
                  ? "calendar.events scope granted — schedule + sync ready"
                  : "Connected, but calendar.events scope missing. Reconnect Gmail."
            }
            scope="per-user"
          />

          <IntegrationCard
            icon={<Box className="h-4 w-4" />}
            title="Dropbox"
            status={
              !health.dropbox_oauth.configured
                ? "missing"
                : dropbox
                  ? "ok"
                  : "warning"
            }
            statusLine={
              !health.dropbox_oauth.configured
                ? "Dropbox OAuth not configured server-side"
                : dropbox
                  ? `Connected as ${dropbox.dropbox_email ?? "(no email)"}`
                  : "OAuth configured but no Dropbox connection on your account"
            }
            help={
              !health.dropbox_oauth.configured && (
                <span className="text-[11px]">
                  Set <code>DROPBOX_CLIENT_ID</code>,{" "}
                  <code>DROPBOX_CLIENT_SECRET</code>, and{" "}
                  <code>DROPBOX_OAUTH_REDIRECT_URI</code>. See Phase 11 in
                  DEPLOYMENT_AND_REMOTE_ACCESS.md.
                </span>
              )
            }
            scope="per-user"
          />

          <IntegrationCard
            icon={<CloudLightning className="h-4 w-4" />}
            title="HailTrace"
            status={health.hailtrace.configured ? "ok" : "missing"}
            statusLine={
              health.hailtrace.configured
                ? `Configured · base ${health.hailtrace.base}`
                : "API not configured — Manual storm-verification entry still works"
            }
            help={
              !health.hailtrace.configured && (
                <span className="text-[11px]">
                  Email <code>developers@hailtrace.com</code> for API access,
                  then set <code>HAILTRACE_API_KEY</code>,{" "}
                  <code>HAILTRACE_API_BASE</code>, and{" "}
                  <code>HAILTRACE_VERIFY_PATH</code> secrets. See Phase 14 in
                  DEPLOYMENT_AND_REMOTE_ACCESS.md.
                </span>
              )
            }
            scope="server"
          />

          <IntegrationCard
            icon={<Clock className="h-4 w-4" />}
            title="Cron (scheduled briefings & triage)"
            status={
              health.cron.secret_configured && health.service_role.configured
                ? "ok"
                : "missing"
            }
            statusLine={
              health.cron.secret_configured && health.service_role.configured
                ? "CRON_SECRET + service role configured — pg_cron block in DEPLOYMENT_AND_REMOTE_ACCESS.md"
                : "CRON_SECRET or SUPABASE_SERVICE_ROLE_KEY missing"
            }
            scope="server"
          />

          <IntegrationCard
            icon={<Scale className="h-4 w-4" />}
            title="State-law KB"
            status={
              Object.values(stateLawByState).some((s) => s.active > 0)
                ? "ok"
                : "warning"
            }
            statusLine={
              Object.keys(stateLawByState).length === 0
                ? "No state-law entries seeded yet"
                : Object.entries(stateLawByState)
                    .map(
                      ([state, c]) =>
                        `${state}: ${c.active} active / ${c.draft} draft`,
                    )
                    .join(" · ")
            }
            help={
              Object.values(stateLawByState).every((s) => s.active === 0) && (
                <span className="text-[11px]">
                  Drafts ship without legal content. Your compliance lead
                  rewrites each summary, adds <code>source_citation</code>, and
                  flips <code>status</code> to <code>active</code> before staff
                  rely on it. See Phase 8.
                </span>
              )
            }
            scope="firm"
          />
        </div>
      )}
    </div>
  );
}

IntegrationsPage.path = "/integrations";

export { IntegrationsPage };

// --- subcomponents ---

function IntegrationCard({
  icon,
  title,
  status,
  statusLine,
  help,
  extra,
  actionHref,
  actionLabel,
  scope,
}: {
  icon: React.ReactNode;
  title: string;
  status: "ok" | "warning" | "missing";
  statusLine: string;
  help?: React.ReactNode;
  extra?: React.ReactNode;
  actionHref?: string | null;
  actionLabel?: string;
  scope: "per-user" | "server" | "firm";
}) {
  const StatusIcon =
    status === "ok"
      ? CheckCircle2
      : status === "warning"
        ? AlertCircle
        : XCircle;
  const statusColor =
    status === "ok"
      ? "text-emerald-500"
      : status === "warning"
        ? "text-amber-500"
        : "text-red-500";
  const scopeLabel =
    scope === "per-user"
      ? "Per-user connection"
      : scope === "server"
        ? "Server-side config"
        : "Firm-wide";
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <Badge variant="outline" className="text-[10px]">
          {scopeLabel}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className={`text-xs flex items-start gap-2 ${statusColor}`}>
          <StatusIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{statusLine}</span>
        </div>
        {extra}
        {help && (
          <Alert>
            <AlertDescription className="text-xs">{help}</AlertDescription>
          </Alert>
        )}
        {actionHref && actionLabel && (
          <a
            href={actionHref}
            className="text-xs underline text-muted-foreground hover:text-foreground"
          >
            {actionLabel} →
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function ScopesBadgeRow({
  required,
  granted,
  shortNames,
}: {
  required: string[];
  granted: string[];
  shortNames: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {required.map((scope) => {
        const has = granted.includes(scope);
        return (
          <Badge
            key={scope}
            variant="outline"
            className={`text-[10px] ${has ? "text-emerald-500 border-emerald-500/50" : "text-amber-500 border-amber-500/50"}`}
            title={scope}
          >
            {has ? "✓ " : "missing "}
            {shortNames[scope] ?? scope}
          </Badge>
        );
      })}
    </div>
  );
}
