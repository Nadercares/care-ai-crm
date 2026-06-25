import { useCallback, useEffect, useState } from "react";
import { useRecordContext, useNotify } from "ra-core";
import {
  Calendar,
  CalendarPlus,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { getSupabaseClient } from "../providers/supabase/supabase";
import { ScheduleInspectionDialog } from "./ScheduleInspectionDialog";

interface CalendarEventRow {
  id: number;
  google_event_id: string;
  html_link: string | null;
  summary: string | null;
  location: string | null;
  starts_at: string | null;
  ends_at: string | null;
  kind: string | null;
  status: string;
  source: string;
  ai_confidence: number | null;
  ai_rationale: string | null;
}

interface Claim {
  id: number;
}

const KIND_LABEL: Record<string, string> = {
  inspection: "Inspection",
  reinspection: "Re-inspection",
  appraisal: "Appraisal",
  mediation: "Mediation",
  carrier_meeting: "Carrier meeting",
  insured_meeting: "Insured meeting",
  deadline: "Deadline",
  other: "Other",
};

export function ClaimCalendarCard() {
  const claim = useRecordContext<Claim>();
  const notify = useNotify();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [events, setEvents] = useState<CalendarEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const claimId = claim?.id;

  const refresh = useCallback(async () => {
    if (!claimId) return;
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("calendar_events")
      .select(
        "id, google_event_id, html_link, summary, location, starts_at, ends_at, kind, status, source, ai_confidence, ai_rationale",
      )
      .eq("claim_id", claimId)
      .order("starts_at", { ascending: true });
    if (error) {
      notify(`Could not read calendar events: ${error.message}`, {
        type: "error",
      });
    }
    setEvents(data ?? []);
    setLoading(false);
  }, [claimId, notify]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runSync = async () => {
    setSyncing(true);
    try {
      const supabase = getSupabaseClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not signed in.");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendar-sync`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ lookahead_days: 60 }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
      notify(
        `Synced ${payload.synced} events (${payload.classified} AI-classified, ${payload.total} pulled).`,
        { type: "success" },
      );
      void refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), {
        type: "error",
      });
    } finally {
      setSyncing(false);
    }
  };

  if (!claim) return null;
  const now = Date.now();
  const upcoming = events.filter(
    (e) => e.starts_at && new Date(e.starts_at).getTime() >= now,
  );
  const past = events.filter(
    (e) => !e.starts_at || new Date(e.starts_at).getTime() < now,
  );

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Calendar
          <Badge variant="outline" className="text-[10px]">
            {events.length}
          </Badge>
        </CardTitle>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void runSync()}
            disabled={syncing}
            title="Pull events from Google Calendar and AI-match them to claims"
          >
            {syncing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Sync
          </Button>
          <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
            <CalendarPlus className="h-3 w-3" />
            Schedule
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </div>
        )}

        {!loading && events.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No events linked to this claim yet. Schedule one, or click Sync to
            pull events you've already created in Google Calendar.
          </p>
        )}

        {upcoming.length > 0 && (
          <Section title="Upcoming" count={upcoming.length}>
            {upcoming.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </Section>
        )}

        {past.length > 0 && (
          <Section title="Past" count={past.length}>
            {past.map((e) => (
              <EventRow key={e.id} event={e} muted />
            ))}
          </Section>
        )}
      </CardContent>

      {dialogOpen && (
        <ScheduleInspectionDialog
          claimId={claim.id}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onScheduled={() => void refresh()}
        />
      )}
    </Card>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
        {title} <span className="opacity-60">({count})</span>
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function EventRow({
  event,
  muted = false,
}: {
  event: CalendarEventRow;
  muted?: boolean;
}) {
  const start = event.starts_at ? new Date(event.starts_at) : null;
  const end = event.ends_at ? new Date(event.ends_at) : null;
  return (
    <div
      className={`text-xs border-l-2 pl-2 ${muted ? "border-border opacity-70" : "border-emerald-500/60"}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {event.kind && (
          <Badge variant="outline" className="text-[10px]">
            {KIND_LABEL[event.kind] ?? event.kind}
          </Badge>
        )}
        {event.source === "synced" && (
          <Badge
            variant="outline"
            className="text-[10px] text-muted-foreground"
          >
            AI-linked
          </Badge>
        )}
        {event.status !== "scheduled" && (
          <Badge variant="outline" className="text-[10px]">
            {event.status}
          </Badge>
        )}
        <span className="font-medium">{event.summary || "(no title)"}</span>
        {event.html_link && (
          <a
            href={event.html_link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            title="Open in Google Calendar"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <div className="text-muted-foreground mt-0.5">
        {start && (
          <>
            {start.toLocaleDateString()}{" "}
            {start.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </>
        )}
        {end && (
          <>
            {" – "}
            {end.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </>
        )}
        {event.location && <span> · {event.location}</span>}
      </div>
      {event.source === "synced" && event.ai_rationale && (
        <div className="text-[10px] text-muted-foreground italic mt-0.5">
          {event.ai_rationale}
          {typeof event.ai_confidence === "number" && (
            <span className="ml-1">
              ({(event.ai_confidence * 100).toFixed(0)}%)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
