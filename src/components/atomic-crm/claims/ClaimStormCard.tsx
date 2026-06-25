import { useCallback, useEffect, useState } from "react";
import { useRecordContext, useNotify } from "ra-core";
import {
  CloudHail,
  CloudLightning,
  Wind,
  Plus,
  Loader2,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { getSupabaseClient } from "../providers/supabase/supabase";

interface Claim {
  id: number;
  date_of_loss?: string | null;
  loss_location_address?: string | null;
  loss_location_state?: string | null;
}

interface StormRow {
  id: number;
  source: string;
  event_date: string | null;
  event_type: string | null;
  hail_size_inches: number | null;
  wind_speed_mph: number | null;
  wind_gust_mph: number | null;
  distance_miles: number | null;
  confidence: string | null;
  report_url: string | null;
  notes: string | null;
  matches_loss_date: boolean | null;
  matches_loss_location: boolean | null;
}

const SOURCE_LABEL: Record<string, string> = {
  hailtrace: "HailTrace",
  corelogic: "CoreLogic",
  verisk_pcs: "Verisk PCS",
  noaa_spc: "NOAA SPC",
  manual: "Manual",
  other: "Other",
};

const EVENT_TYPES = [
  "hail",
  "wind",
  "tornado",
  "hurricane",
  "flood",
  "lightning",
  "other",
];
const CONFIDENCE_OPTIONS = ["high", "medium", "low", "unknown"];

export function ClaimStormCard() {
  const claim = useRecordContext<Claim>();
  const notify = useNotify();
  const [rows, setRows] = useState<StormRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const claimId = claim?.id;

  const refresh = useCallback(async () => {
    if (!claimId) return;
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("claim_storm_verifications")
      .select(
        "id, source, event_date, event_type, hail_size_inches, wind_speed_mph, wind_gust_mph, distance_miles, confidence, report_url, notes, matches_loss_date, matches_loss_location",
      )
      .eq("claim_id", claimId)
      .order("event_date", { ascending: false, nullsFirst: false });
    if (error) {
      notify(`Could not read verifications: ${error.message}`, {
        type: "error",
      });
    }
    setRows(data ?? []);
    setLoading(false);
  }, [claimId, notify]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const verifyWithHailTrace = async () => {
    if (!claimId) return;
    setVerifying(true);
    try {
      const supabase = getSupabaseClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not signed in.");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-storm`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ claim_id: claimId }),
      });
      const payload = await res.json();
      if (res.status === 503 && payload?.configured === false) {
        notify(
          "HailTrace isn't configured on the server yet. Use Add manual verification instead.",
          { type: "warning" },
        );
        return;
      }
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
      notify(
        `HailTrace returned ${payload.events_found} event(s); saved ${payload.saved_count}.`,
        { type: "success" },
      );
      void refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), {
        type: "error",
      });
    } finally {
      setVerifying(false);
    }
  };

  if (!claim) return null;

  const hasWindHail =
    rows.some((r) => r.event_type === "hail") ||
    rows.some((r) => r.event_type === "wind") ||
    rows.some((r) => r.event_type === "tornado") ||
    rows.some((r) => r.event_type === "hurricane");

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <CloudHail className="h-4 w-4" />
          Storm verification
          <Badge variant="outline" className="text-[10px]">
            {rows.length}
          </Badge>
          {hasWindHail && (
            <Badge
              variant="outline"
              className="text-[10px] text-emerald-500 border-emerald-500/50"
            >
              wind/hail evidence on file
            </Badge>
          )}
        </CardTitle>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowManual(true)}
          >
            <Plus className="h-3 w-3" />
            Manual
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void verifyWithHailTrace()}
            disabled={verifying}
            title="Call HailTrace with this claim's DOL and loss address"
          >
            {verifying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CloudLightning className="h-3 w-3" />
            )}
            Verify (HailTrace)
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {!claim.date_of_loss && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Set the claim's <code>date_of_loss</code> before running an
              automated verification. Manual entry works without it.
            </AlertDescription>
          </Alert>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </div>
        )}

        {!loading && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No verifications on file. Use HailTrace (once configured) or paste
            details from a meteorologist / NOAA report via Manual.
          </p>
        )}

        {rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((r) => (
              <StormRowDisplay key={r.id} row={r} />
            ))}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Decision support only. A storm verification document the carrier will
          accept is a meteorologist-reviewed PDF — this card tracks the
          evidence; it doesn't replace it.
        </p>
      </CardContent>

      {showManual && (
        <ManualEntryDialog
          claimId={claim.id}
          defaultDate={claim.date_of_loss ?? null}
          open={showManual}
          onOpenChange={setShowManual}
          onSaved={() => {
            setShowManual(false);
            void refresh();
          }}
        />
      )}
    </Card>
  );
}

function StormRowDisplay({ row }: { row: StormRow }) {
  const eventIcon =
    row.event_type === "wind" || row.event_type === "tornado"
      ? Wind
      : CloudHail;
  const EventIcon = eventIcon;
  return (
    <div className="text-xs border-l-2 border-emerald-500/60 pl-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[10px]">
          {SOURCE_LABEL[row.source] ?? row.source}
        </Badge>
        {row.event_type && (
          <Badge
            variant="outline"
            className="text-[10px] flex items-center gap-1"
          >
            <EventIcon className="h-3 w-3" />
            {row.event_type}
          </Badge>
        )}
        {row.event_date && (
          <span className="font-medium">
            {new Date(row.event_date).toLocaleDateString()}
          </span>
        )}
        {row.matches_loss_date && (
          <Badge
            variant="outline"
            className="text-[10px] text-emerald-500 border-emerald-500/50"
          >
            <CheckCircle2 className="h-3 w-3" /> matches DOL
          </Badge>
        )}
        {row.matches_loss_location && (
          <Badge
            variant="outline"
            className="text-[10px] text-emerald-500 border-emerald-500/50"
          >
            <CheckCircle2 className="h-3 w-3" /> at loss location
          </Badge>
        )}
        {row.confidence && (
          <Badge variant="outline" className="text-[10px]">
            {row.confidence} confidence
          </Badge>
        )}
        {row.report_url && (
          <a
            href={row.report_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground inline-flex items-center gap-1"
            title="Open report"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <div className="text-muted-foreground mt-0.5 space-x-3">
        {row.hail_size_inches !== null && (
          <span>Hail {row.hail_size_inches}″</span>
        )}
        {row.wind_speed_mph !== null && (
          <span>Wind {row.wind_speed_mph} mph</span>
        )}
        {row.wind_gust_mph !== null && (
          <span>Gust {row.wind_gust_mph} mph</span>
        )}
        {row.distance_miles !== null && (
          <span>{row.distance_miles} mi from loss</span>
        )}
      </div>
      {row.notes && (
        <div className="text-[11px] text-muted-foreground italic mt-0.5">
          {row.notes}
        </div>
      )}
    </div>
  );
}

function ManualEntryDialog({
  claimId,
  defaultDate,
  open,
  onOpenChange,
  onSaved,
}: {
  claimId: number;
  defaultDate: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const notify = useNotify();
  const [source, setSource] = useState("manual");
  const [eventDate, setEventDate] = useState(defaultDate ?? "");
  const [eventType, setEventType] = useState("hail");
  const [hailSize, setHailSize] = useState("");
  const [windSpeed, setWindSpeed] = useState("");
  const [windGust, setWindGust] = useState("");
  const [distance, setDistance] = useState("");
  const [confidence, setConfidence] = useState("medium");
  const [reportUrl, setReportUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const supabase = getSupabaseClient();
      const { data: user } = await supabase.auth.getUser();
      const authUserId = user?.user?.id;
      let salesId: number | null = null;
      if (authUserId) {
        const { data: sales } = await supabase
          .from("sales")
          .select("id")
          .eq("user_id", authUserId)
          .maybeSingle();
        salesId = sales?.id ?? null;
      }
      const { error } = await supabase
        .from("claim_storm_verifications")
        .insert({
          claim_id: claimId,
          sales_id: salesId,
          source,
          event_date: eventDate || null,
          event_type: eventType,
          hail_size_inches: hailSize ? Number(hailSize) : null,
          wind_speed_mph: windSpeed ? Number(windSpeed) : null,
          wind_gust_mph: windGust ? Number(windGust) : null,
          distance_miles: distance ? Number(distance) : null,
          confidence,
          report_url: reportUrl || null,
          notes: notes || null,
        });
      if (error) {
        notify(`Save failed: ${error.message}`, { type: "error" });
        return;
      }
      notify("Verification added.", { type: "success" });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add storm verification
          </DialogTitle>
          <DialogDescription className="text-xs">
            Manual entry — paste in details from a meteorologist report,
            HailTrace PDF, NOAA SPC archive, or your own field observation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Source">
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SOURCE_LABEL).map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Event date">
            <Input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="text-xs"
            />
          </Field>
          <Field label="Event type">
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Confidence">
            <Select value={confidence} onValueChange={setConfidence}>
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONFIDENCE_OPTIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Hail size (inches)">
            <Input
              type="number"
              step="0.25"
              value={hailSize}
              onChange={(e) => setHailSize(e.target.value)}
              className="text-xs"
            />
          </Field>
          <Field label="Wind speed (mph)">
            <Input
              type="number"
              value={windSpeed}
              onChange={(e) => setWindSpeed(e.target.value)}
              className="text-xs"
            />
          </Field>
          <Field label="Wind gust (mph)">
            <Input
              type="number"
              value={windGust}
              onChange={(e) => setWindGust(e.target.value)}
              className="text-xs"
            />
          </Field>
          <Field label="Distance from loss (mi)">
            <Input
              type="number"
              step="0.1"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              className="text-xs"
            />
          </Field>
          <div className="col-span-2">
            <Field label="Report URL (HailTrace PDF, NOAA link, etc.)">
              <Input
                value={reportUrl}
                onChange={(e) => setReportUrl(e.target.value)}
                placeholder="https://…"
                className="text-xs"
              />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Notes">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="text-xs"
              />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add verification
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
