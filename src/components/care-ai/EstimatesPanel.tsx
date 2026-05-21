import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNotify } from "ra-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { runSpecialistAgent } from "@/api/agents";
import {
  ESTIMATE_SOURCES,
  createEstimate,
  deleteEstimate,
  fetchEstimates,
} from "@/api/estimates";

interface FormState {
  source: string;
  label: string;
  total_rcv: string;
  total_acv: string;
  depreciation: string;
  deductible: string;
  content: string;
}

const EMPTY_FORM: FormState = {
  source: "carrier",
  label: "",
  total_rcv: "",
  total_acv: "",
  depreciation: "",
  deductible: "",
  content: "",
};

function toAmount(value: string): number | null {
  const trimmed = value.trim().replace(/[,$\s]/g, "");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function formatMoney(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function sourceLabel(source: string): string {
  return ESTIMATE_SOURCES.find((s) => s.value === source)?.label ?? source;
}

/**
 * Estimates panel on the claim screen. Enter the carrier and public-adjuster
 * estimates, then run the Estimate Comparison agent to get a difference
 * report and a draft negotiation letter.
 */
export function EstimatesPanel({ dealId }: { dealId: number }) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [expanded, setExpanded] = useState<number | null>(null);

  const reportError = (e: unknown) =>
    notify(e instanceof Error ? e.message : String(e), { type: "error" });

  const estimatesQuery = useQuery({
    queryKey: ["estimates", dealId],
    queryFn: () => fetchEstimates(dealId),
  });
  const estimates = estimatesQuery.data ?? [];

  const setField = (key: keyof FormState, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const create = useMutation({
    mutationFn: () =>
      createEstimate(dealId, {
        source: form.source,
        label: form.label,
        total_rcv: toAmount(form.total_rcv),
        total_acv: toAmount(form.total_acv),
        depreciation: toAmount(form.depreciation),
        deductible: toAmount(form.deductible),
        content: form.content,
      }),
    onSuccess: () => {
      setForm(EMPTY_FORM);
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["estimates", dealId] });
      notify("Estimate added.", { type: "info" });
    },
    onError: reportError,
  });

  const remove = useMutation({
    mutationFn: deleteEstimate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["estimates", dealId] });
      notify("Estimate removed.", { type: "info" });
    },
    onError: reportError,
  });

  const compare = useMutation({
    mutationFn: () =>
      runSpecialistAgent(
        "estimate_comparison",
        dealId,
        "Compare the estimates on this claim and draft a negotiation letter.",
      ),
    onSuccess: () => {
      notify(
        "Estimate Comparison agent started — the difference report and draft letter will appear in the AI Agents panel below.",
        { type: "info" },
      );
      queryClient.invalidateQueries({ queryKey: ["agent_runs", dealId] });
      queryClient.invalidateQueries({ queryKey: ["agent_outputs", dealId] });
    },
    onError: reportError,
  });

  return (
    <div className="m-4">
      <Separator className="mb-4" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Estimates</h3>
          <p className="text-xs text-muted-foreground">
            Enter the carrier and public-adjuster estimates, then compare them
            to get a difference report and a draft negotiation letter.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            disabled={estimates.length < 2 || compare.isPending}
            onClick={() => compare.mutate()}
          >
            {compare.isPending ? "Starting…" : "Compare & draft letter"}
          </Button>
          <Button size="sm" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Cancel" : "Add estimate"}
          </Button>
        </div>
      </div>

      {estimatesQuery.isError && (
        <p className="text-xs text-destructive mt-2">
          Could not load estimates. Apply the database migration:{" "}
          <code>npx supabase db reset --local</code>.
        </p>
      )}

      {showForm && (
        <div className="border rounded-md p-3 space-y-2 mt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Source</Label>
              <Select
                value={form.source}
                onValueChange={(v) => setField("source", v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESTIMATE_SOURCES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Label</Label>
              <Input
                className="h-8 text-xs"
                placeholder="e.g. Carrier estimate v1"
                value={form.label}
                onChange={(e) => setField("label", e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(
              [
                ["total_rcv", "Total RCV"],
                ["total_acv", "Total ACV"],
                ["depreciation", "Depreciation"],
                ["deductible", "Deductible"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <Input
                  className="h-8 text-xs"
                  inputMode="decimal"
                  placeholder="$"
                  value={form[key]}
                  onChange={(e) => setField(key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Estimate detail / line items</Label>
            <Textarea
              rows={5}
              className="text-xs font-mono"
              placeholder="Paste the estimate's line items or summary here."
              value={form.content}
              onChange={(e) => setField("content", e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Saving…" : "Save estimate"}
            </Button>
          </div>
        </div>
      )}

      {estimatesQuery.isLoading && (
        <div className="flex justify-center py-3">
          <Spinner />
        </div>
      )}
      {!estimatesQuery.isLoading && estimates.length === 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          No estimates entered yet. Add the carrier's and the public adjuster's
          estimates to compare them.
        </p>
      )}

      <div className="space-y-2 mt-3">
        {estimates.map((estimate) => (
          <div key={estimate.id} className="border rounded-md">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 p-2 text-left"
              onClick={() =>
                setExpanded(expanded === estimate.id ? null : estimate.id)
              }
            >
              <span className="flex items-center gap-2 min-w-0">
                <Badge variant="secondary" className="text-[10px]">
                  {sourceLabel(estimate.source)}
                </Badge>
                <span className="text-xs font-medium truncate">
                  {estimate.label || "Estimate"}
                </span>
              </span>
              <span className="text-[11px] text-muted-foreground shrink-0">
                RCV {formatMoney(estimate.total_rcv)}
              </span>
            </button>
            {expanded === estimate.id && (
              <div className="border-t px-3 py-2 space-y-2 text-xs">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                  <span>RCV: {formatMoney(estimate.total_rcv)}</span>
                  <span>ACV: {formatMoney(estimate.total_acv)}</span>
                  <span>
                    Depreciation: {formatMoney(estimate.depreciation)}
                  </span>
                  <span>Deductible: {formatMoney(estimate.deductible)}</span>
                </div>
                {estimate.content && (
                  <div className="whitespace-pre-wrap leading-5">
                    {estimate.content}
                  </div>
                )}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      if (window.confirm("Remove this estimate?")) {
                        remove.mutate(estimate.id);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
