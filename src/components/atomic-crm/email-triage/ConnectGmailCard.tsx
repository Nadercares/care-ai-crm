import { useEffect, useState } from "react";
import { useNotify } from "ra-core";
import { Mail, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { getSupabaseClient } from "../providers/supabase/supabase";

interface Connection {
  id: number;
  google_email: string;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
}

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

function buildAuthUrl(userId: string): string {
  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as
    | string
    | undefined;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  if (!clientId) {
    throw new Error("VITE_GOOGLE_OAUTH_CLIENT_ID is not set on the frontend.");
  }
  const redirectUri = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/gmail-oauth-callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: userId,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function ConnectGmailCard({
  onTriageRun,
}: {
  onTriageRun: (result: { triaged: number; total: number }) => void;
}) {
  const notify = useNotify();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void refresh();
    // Surface OAuth callback results from the URL params.
    const url = new URL(window.location.href);
    if (url.searchParams.get("gmail_connected")) {
      notify("Gmail connected.", { type: "success" });
      url.searchParams.delete("gmail_connected");
      window.history.replaceState(null, "", url.toString());
    }
    const err = url.searchParams.get("gmail_error");
    if (err) {
      notify(`Gmail connection failed: ${err}`, { type: "error" });
      url.searchParams.delete("gmail_error");
      window.history.replaceState(null, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("gmail_connections")
      .select(
        "id, google_email, last_synced_at, last_sync_status, last_sync_error",
      )
      .limit(1)
      .maybeSingle();
    if (error) {
      notify(`Could not read Gmail connection: ${error.message}`, {
        type: "error",
      });
    }
    setConnection(data ?? null);
    setLoading(false);
  };

  const startOauth = async () => {
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) {
        notify("You must be signed in.", { type: "error" });
        return;
      }
      window.location.href = buildAuthUrl(userId);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), {
        type: "error",
      });
    }
  };

  const runTriage = async () => {
    setRunning(true);
    try {
      const supabase = getSupabaseClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not signed in.");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gmail-triage`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || `HTTP ${res.status}`);
      }
      notify(
        `Triage complete: ${payload.triaged} new, ${payload.skipped} already-classified, ${payload.total} total.`,
        { type: "success" },
      );
      onTriageRun(payload);
      void refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), {
        type: "error",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-amber-500/30 bg-amber-500/5 mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Gmail connection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </div>
        )}

        {!loading && !connection && (
          <>
            <p className="text-xs text-muted-foreground">
              Connect your Gmail to let CARE AI triage your inbox, link messages
              to claims/carriers/insureds, and flag urgent items. Only inbox
              read access is requested.
            </p>
            <Button type="button" size="sm" onClick={() => void startOauth()}>
              <Mail className="h-4 w-4" /> Connect Gmail
            </Button>
          </>
        )}

        {!loading && connection && (
          <>
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>
                Connected as <strong>{connection.google_email}</strong>
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {connection.last_synced_at
                ? `Last sync: ${new Date(connection.last_synced_at).toLocaleString()} (${connection.last_sync_status ?? "—"})`
                : "No syncs yet."}
            </div>
            {connection.last_sync_error && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Last sync error: {connection.last_sync_error}
                </AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={running}
                onClick={() => void runTriage()}
              >
                {running ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                {running ? "Running…" : "Run triage now"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void startOauth()}
              >
                Reconnect
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
