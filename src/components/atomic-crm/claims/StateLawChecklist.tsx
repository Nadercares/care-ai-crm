import { useEffect, useState } from "react";
import { useRecordContext } from "ra-core";
import { Scale, AlertTriangle, Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { getSupabaseClient } from "../providers/supabase/supabase";

interface StateLawSummary {
  id: number;
  state_abbr: string;
  topic: string;
  title: string;
  summary: string;
  source_citation: string | null;
  last_reviewed_at: string | null;
  status: "draft" | "active" | "retired";
  notes: string | null;
}

interface Claim {
  id: number;
  loss_location_state?: string | null;
}

export function StateLawChecklist() {
  const claim = useRecordContext<Claim>();
  const [entries, setEntries] = useState<StateLawSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stateAbbr = (claim?.loss_location_state ?? "").trim().toUpperCase();

  useEffect(() => {
    if (!stateAbbr) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const supabase = getSupabaseClient();
      let query = supabase
        .from("state_law_summaries")
        .select(
          "id, state_abbr, topic, title, summary, source_citation, last_reviewed_at, status, notes",
        )
        .eq("state_abbr", stateAbbr)
        .neq("status", "retired")
        .order("topic", { ascending: true });
      if (!showDrafts) {
        query = query.eq("status", "active");
      }
      const { data, error: queryError } = await query;
      if (cancelled) return;
      if (queryError) {
        setError(queryError.message);
        setEntries([]);
      } else {
        setEntries(data ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [stateAbbr, showDrafts]);

  if (!claim) return null;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Scale className="h-4 w-4" />
          State law cheat sheet
          {stateAbbr && (
            <Badge variant="outline" className="text-[10px]">
              {stateAbbr}
            </Badge>
          )}
        </CardTitle>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShowDrafts((s) => !s)}
          disabled={!stateAbbr}
        >
          {showDrafts ? "Hide drafts" : "Show drafts too"}
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Research support only. Nothing here is legal advice. The firm's
            compliance lead must verify and approve each entry (status → active)
            before staff rely on it. Cite live statutes, not summaries.
          </AlertDescription>
        </Alert>

        {!stateAbbr && (
          <p className="text-xs text-muted-foreground">
            Set the claim's{" "}
            <code className="text-[11px]">loss_location_state</code> to load
            state-specific entries.
          </p>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </div>
        )}

        {error && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        {stateAbbr && !loading && !error && entries.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No {showDrafts ? "draft or active" : "active"} entries for{" "}
            {stateAbbr}.
            {!showDrafts &&
              " Toggle 'Show drafts too' to see research checklists."}
          </p>
        )}

        <div className="space-y-2">
          {entries.map((entry) => (
            <details
              key={entry.id}
              className="group rounded border border-border/40 px-2 py-1"
            >
              <summary className="cursor-pointer select-none text-xs font-semibold flex items-center gap-2">
                <span>{entry.title}</span>
                <Badge
                  variant="outline"
                  className={
                    "text-[10px] " +
                    (entry.status === "draft"
                      ? "text-amber-500 border-amber-500/50"
                      : "text-emerald-500 border-emerald-500/50")
                  }
                >
                  {entry.status}
                </Badge>
                <span className="text-muted-foreground font-mono text-[10px]">
                  {entry.topic}
                </span>
              </summary>
              <div className="mt-2 pl-1 text-xs space-y-1">
                <pre className="whitespace-pre-wrap font-sans">
                  {entry.summary}
                </pre>
                {entry.source_citation && (
                  <p className="text-muted-foreground">
                    <strong>Citation:</strong> {entry.source_citation}
                  </p>
                )}
                {entry.last_reviewed_at && (
                  <p className="text-muted-foreground">
                    Last reviewed: {entry.last_reviewed_at}
                  </p>
                )}
                {entry.notes && (
                  <p className="text-muted-foreground italic">{entry.notes}</p>
                )}
              </div>
            </details>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
