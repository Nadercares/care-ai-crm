import { useMemo, useState } from "react";
import { useNotify } from "ra-core";
import { CalendarPlus, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { getSupabaseClient } from "../providers/supabase/supabase";

const KIND_OPTIONS = [
  { value: "inspection", label: "Inspection" },
  { value: "reinspection", label: "Re-inspection" },
  { value: "appraisal", label: "Appraisal" },
  { value: "mediation", label: "Mediation" },
  { value: "carrier_meeting", label: "Carrier meeting" },
  { value: "insured_meeting", label: "Insured meeting" },
  { value: "deadline", label: "Deadline" },
  { value: "other", label: "Other" },
];

function defaultWhen(): string {
  // Next business day at 10:00 local, formatted for <input type="datetime-local">.
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleInspectionDialog({
  claimId,
  open,
  onOpenChange,
  onScheduled,
}: {
  claimId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScheduled?: () => void;
}) {
  const notify = useNotify();
  const initialWhen = useMemo(defaultWhen, []);
  const [when, setWhen] = useState(initialWhen);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [kind, setKind] = useState("inspection");
  const [attendeesText, setAttendeesText] = useState("");
  const [locationOverride, setLocationOverride] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      const supabase = getSupabaseClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not signed in.");

      // Convert <input type="datetime-local"> value (no timezone) to an
      // ISO string respecting the browser's local zone.
      const localDate = new Date(when);
      if (Number.isNaN(localDate.getTime())) {
        throw new Error("Pick a valid date and time.");
      }

      const attendees = attendeesText
        .split(/[\s,;]+/)
        .map((e) => e.trim())
        .filter((e) => e.length > 0 && e.includes("@"));

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/schedule-inspection`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          claim_id: claimId,
          when: localDate.toISOString(),
          duration_minutes: durationMinutes,
          kind,
          attendees: attendees.length > 0 ? attendees : undefined,
          location_override: locationOverride.trim() || undefined,
          additional_notes: additionalNotes.trim() || undefined,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || `HTTP ${res.status}`);
      }
      notify(`Event created in Google Calendar.`, { type: "success" });
      onScheduled?.();
      onOpenChange(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), {
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-4 w-4" />
            Schedule inspection
          </DialogTitle>
          <DialogDescription className="text-xs">
            Creates a real Google Calendar event with the claim, carrier, and
            policy context baked into the description. Invitations are sent to
            the insured and the carrier adjuster automatically (when their
            emails are on file).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 text-sm">
          <Field label="Kind">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="When (local)">
              <Input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="text-xs"
              />
            </Field>
            <Field label="Duration (minutes)">
              <Input
                type="number"
                min={5}
                max={480}
                step={15}
                value={durationMinutes}
                onChange={(e) =>
                  setDurationMinutes(Number(e.target.value) || 60)
                }
                className="text-xs"
              />
            </Field>
          </div>

          <Field label="Extra attendees (comma- or space-separated emails)">
            <Input
              value={attendeesText}
              onChange={(e) => setAttendeesText(e.target.value)}
              placeholder="contractor@example.com, public-adjuster@careai.com"
              className="text-xs"
            />
          </Field>

          <Field label="Location override (defaults to loss address)">
            <Input
              value={locationOverride}
              onChange={(e) => setLocationOverride(e.target.value)}
              placeholder="leave blank to use the claim's loss address"
              className="text-xs"
            />
          </Field>

          <Field label="Additional notes">
            <Textarea
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              rows={3}
              placeholder="e.g. Focus on roof matching, request adjuster to bring Eagle View."
              className="text-xs"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CalendarPlus className="h-4 w-4" />
            )}
            {submitting ? "Scheduling…" : "Schedule"}
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
