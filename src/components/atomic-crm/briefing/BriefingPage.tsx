import { useCallback, useEffect, useState } from "react";
import { useNotify } from "ra-core";
import {
  Sparkles,
  Mail,
  Loader2,
  Calendar,
  Inbox,
  AlertTriangle,
  TrendingUp,
  History,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { Markdown } from "../misc/Markdown";
import { getSupabaseClient } from "../providers/supabase/supabase";

interface BriefingResult {
  markdown: string;
  generated_at: string;
  counts: {
    today_events: number;
    urgent_emails: number;
    stale_claims: number;
    carriers: number;
  };
  saved_to_gmail: boolean;
  gmail_draft_id: string | null;
  gmail_save_error: string | null;
}

interface HistoryRow {
  id: number;
  generated_at: string;
  content_markdown: string;
  today_events_count: number;
  urgent_emails_count: number;
  stale_claims_count: number;
  carriers_count: number;
}

function BriefingPage() {
  const notify = useNotify();
  const [briefing, setBriefing] = useState<BriefingResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [savingGmail, setSavingGmail] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [openHistoryId, setOpenHistoryId] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    const supabase = getSupabaseClient();
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const { data: user } = await supabase.auth.getUser();
    const authUserId = user?.user?.id;
    if (!authUserId) return;
    const { data: sales } = await supabase
      .from("sales")
      .select("id")
      .eq("user_id", authUserId)
      .maybeSingle();
    if (!sales) return;
    const { data } = await supabase
      .from("briefings")
      .select(
        "id, generated_at, content_markdown, today_events_count, urgent_emails_count, stale_claims_count, carriers_count",
      )
      .eq("sales_id", sales.id)
      .gte("generated_at", since)
      .order("generated_at", { ascending: false })
      .limit(20);
    setHistory(data ?? []);
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const generate = async (saveToGmail = false) => {
    if (saveToGmail) {
      setSavingGmail(true);
    } else {
      setGenerating(true);
    }
    try {
      const supabase = getSupabaseClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not signed in.");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/daily-briefing`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ save_to_gmail: saveToGmail }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || `HTTP ${res.status}`);
      }
      setBriefing(payload as BriefingResult);
      void loadHistory();
      if (saveToGmail) {
        if (payload.gmail_save_error) {
          notify(
            `Briefing generated but Gmail rejected the draft: ${payload.gmail_save_error}`,
            {
              type: "warning",
            },
          );
        } else if (payload.gmail_draft_id) {
          notify("Briefing saved as Gmail draft.", { type: "success" });
        }
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), {
        type: "error",
      });
    } finally {
      setGenerating(false);
      setSavingGmail(false);
    }
  };

  return (
    <div className="space-y-4 p-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold">Morning briefing</h1>
        <p className="text-xs text-muted-foreground mt-1">
          CARE AI reads today's calendar, urgent inbox items, stale claims, and
          recent carrier escalation patterns and writes you a tight, actionable
          summary. Decision support only.
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => void generate(false)}
          disabled={generating || savingGmail}
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {generating
            ? "Generating…"
            : briefing
              ? "Regenerate"
              : "Generate today's briefing"}
        </Button>
        {briefing && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void generate(true)}
            disabled={generating || savingGmail}
          >
            {savingGmail ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mail className="h-4 w-4" />
            )}
            {savingGmail ? "Saving…" : "Save to Gmail drafts"}
          </Button>
        )}
      </div>

      {briefing && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CountChip
              icon={<Calendar className="h-3 w-3" />}
              label="Today"
              value={briefing.counts.today_events}
            />
            <CountChip
              icon={<Inbox className="h-3 w-3" />}
              label="Urgent emails"
              value={briefing.counts.urgent_emails}
            />
            <CountChip
              icon={<AlertTriangle className="h-3 w-3" />}
              label="Stale claims"
              value={briefing.counts.stale_claims}
            />
            <CountChip
              icon={<TrendingUp className="h-3 w-3" />}
              label="Carriers"
              value={briefing.counts.carriers}
            />
          </div>

          {briefing.saved_to_gmail && briefing.gmail_draft_id && (
            <Alert>
              <Mail className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Saved as Gmail draft <code>{briefing.gmail_draft_id}</code>.
                Open Gmail to read on your phone.
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Briefing
                <span className="text-xs text-muted-foreground font-normal">
                  generated{" "}
                  {new Date(briefing.generated_at).toLocaleTimeString()}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Markdown className="text-sm">{briefing.markdown}</Markdown>
            </CardContent>
          </Card>

          <p className="text-[11px] text-muted-foreground">
            Decision support only. Verify every claim/email reference before
            taking action; the briefing reads from your CRM but isn't
            authoritative for legal or carrier-binding statements.
          </p>
        </>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <History className="h-4 w-4" />
              History (last 14 days)
              <span className="text-xs text-muted-foreground font-normal">
                {history.length} briefing{history.length === 1 ? "" : "s"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {history.map((h) => (
              <details
                key={h.id}
                open={openHistoryId === h.id}
                onToggle={(e) =>
                  setOpenHistoryId(
                    (e.target as HTMLDetailsElement).open ? h.id : null,
                  )
                }
                className="rounded border border-border/40 px-2 py-1"
              >
                <summary className="cursor-pointer select-none text-xs flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">
                    {new Date(h.generated_at).toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(h.generated_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="text-muted-foreground">
                    · {h.today_events_count} events
                  </span>
                  <span className="text-muted-foreground">
                    · {h.urgent_emails_count} urgent
                  </span>
                  <span className="text-muted-foreground">
                    · {h.stale_claims_count} stale
                  </span>
                </summary>
                <div className="mt-2">
                  <Markdown className="text-sm">{h.content_markdown}</Markdown>
                </div>
              </details>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

BriefingPage.path = "/briefing";

export { BriefingPage };

function CountChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wide">
          {icon}
          {label}
        </div>
        <div className="text-xl font-semibold mt-0.5">{value}</div>
      </CardContent>
    </Card>
  );
}
