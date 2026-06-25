import { useState } from "react";
import { useRecordContext, useNotify } from "ra-core";
import { Sparkles, Loader2, AlertTriangle, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

import { getSupabaseClient } from "../providers/supabase/supabase";

interface TotalsRow {
  field: string;
  carrier_value?: number | null;
  comparison_value?: number | null;
  comparison_source?: string;
  gap_dollars?: number | null;
  gap_pct?: number | null;
  interpretation: string;
}
interface MissingItem {
  code?: string | null;
  description: string;
  quantity?: number | null;
  unit?: string | null;
  line_rcv?: number | null;
  justification: string;
}
interface PriceDiscrepancy {
  code?: string | null;
  description: string;
  carrier_unit_price?: number | null;
  comparison_unit_price?: number | null;
  gap_pct?: number | null;
  notes: string;
}
interface DepreciationIssue {
  scope?: string;
  issue: string;
  recommended_action: string;
}
interface PolicyRedFlag {
  issue: string;
  policy_basis?: string;
  recommended_action: string;
}
interface LeverageMove {
  strategy: string;
  rationale: string;
  applies_when?: string;
  draft_language?: string | null;
}
interface Comparison {
  headline: string;
  totals_diff: TotalsRow[];
  missing_from_carrier?: MissingItem[];
  price_discrepancies?: PriceDiscrepancy[];
  depreciation_issues?: DepreciationIssue[];
  policy_red_flags?: PolicyRedFlag[];
  recommended_leverage?: LeverageMove[];
  confidence_notes?: string;
}

interface Claim {
  id: number;
}

export function EstimateComparator() {
  const record = useRecordContext<Claim>();
  const notify = useNotify();
  const [running, setRunning] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [estimateCount, setEstimateCount] = useState<number | null>(null);

  const claimId = record?.id;

  const runComparison = async () => {
    if (!claimId) return;
    setRunning(true);
    setComparison(null);
    try {
      const supabase = getSupabaseClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not signed in.");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/compare-estimates`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ claim_id: claimId }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `Comparison failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      const payload = (await res.json()) as {
        comparison: Comparison;
        estimate_count: number;
      };
      setComparison(payload.comparison);
      setEstimateCount(payload.estimate_count);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(msg, { type: "error" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          AI estimate comparison
        </CardTitle>
        <Button
          type="button"
          size="sm"
          disabled={!claimId || running}
          onClick={() => void runComparison()}
        >
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {running
            ? "Comparing…"
            : comparison
              ? "Re-run comparison"
              : "Run AI comparison"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!comparison && !running && (
          <p className="text-xs text-muted-foreground">
            Loads every estimate on this claim plus the policy, then diffs
            totals and line items and proposes leverage moves. Decision support
            only — review before relying on any output.
          </p>
        )}

        {comparison && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold">{comparison.headline}</p>
              {estimateCount && (
                <p className="text-xs text-muted-foreground">
                  {estimateCount} estimates analyzed
                </p>
              )}
            </div>

            <Section
              title="Totals diff"
              count={comparison.totals_diff.length}
              defaultOpen
            >
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="py-1">Field</th>
                    <th>Carrier</th>
                    <th>Compare</th>
                    <th>Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.totals_diff.map((row, i) => (
                    <tr key={i} className="border-t border-border/30">
                      <td className="py-1 pr-2 font-medium">{row.field}</td>
                      <td className="pr-2">{fmtMoney(row.carrier_value)}</td>
                      <td className="pr-2">
                        {fmtMoney(row.comparison_value)}
                        {row.comparison_source && (
                          <span className="text-muted-foreground ml-1">
                            ({row.comparison_source})
                          </span>
                        )}
                      </td>
                      <td>
                        {fmtMoney(row.gap_dollars)}
                        {typeof row.gap_pct === "number" && (
                          <span className="text-muted-foreground ml-1">
                            ({row.gap_pct.toFixed(0)}%)
                          </span>
                        )}
                        <div className="text-muted-foreground italic mt-0.5">
                          {row.interpretation}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {!!comparison.missing_from_carrier?.length && (
              <Section
                title="Items missing from carrier"
                count={comparison.missing_from_carrier.length}
              >
                <ul className="space-y-2 text-xs">
                  {comparison.missing_from_carrier.map((it, i) => (
                    <li key={i} className="border-l-2 border-amber-500/60 pl-2">
                      <div className="font-medium">
                        {it.code && (
                          <span className="font-mono mr-1">{it.code}</span>
                        )}
                        {it.description}
                      </div>
                      {(it.quantity || it.unit || it.line_rcv) && (
                        <div className="text-muted-foreground">
                          {it.quantity} {it.unit} · {fmtMoney(it.line_rcv)}
                        </div>
                      )}
                      <div className="text-muted-foreground italic">
                        {it.justification}
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {!!comparison.price_discrepancies?.length && (
              <Section
                title="Price discrepancies"
                count={comparison.price_discrepancies.length}
              >
                <ul className="space-y-2 text-xs">
                  {comparison.price_discrepancies.map((it, i) => (
                    <li key={i} className="border-l-2 border-amber-500/60 pl-2">
                      <div className="font-medium">
                        {it.code && (
                          <span className="font-mono mr-1">{it.code}</span>
                        )}
                        {it.description}
                      </div>
                      <div className="text-muted-foreground">
                        carrier {fmtMoney(it.carrier_unit_price)} · compare{" "}
                        {fmtMoney(it.comparison_unit_price)}
                        {typeof it.gap_pct === "number" && (
                          <span className="ml-1">
                            ({it.gap_pct.toFixed(0)}%)
                          </span>
                        )}
                      </div>
                      <div className="text-muted-foreground italic">
                        {it.notes}
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {!!comparison.depreciation_issues?.length && (
              <Section
                title="Depreciation issues"
                count={comparison.depreciation_issues.length}
              >
                <ul className="space-y-2 text-xs">
                  {comparison.depreciation_issues.map((it, i) => (
                    <li key={i} className="border-l-2 border-amber-500/60 pl-2">
                      {it.scope && (
                        <div className="font-mono text-muted-foreground">
                          {it.scope}
                        </div>
                      )}
                      <div className="font-medium">{it.issue}</div>
                      <div className="italic">→ {it.recommended_action}</div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {!!comparison.policy_red_flags?.length && (
              <Section
                title="Policy red flags"
                count={comparison.policy_red_flags.length}
                tone="warn"
              >
                <ul className="space-y-2 text-xs">
                  {comparison.policy_red_flags.map((it, i) => (
                    <li key={i} className="border-l-2 border-red-500/60 pl-2">
                      <div className="font-medium">{it.issue}</div>
                      {it.policy_basis && (
                        <div className="text-muted-foreground">
                          Basis: {it.policy_basis}
                        </div>
                      )}
                      <div className="italic">→ {it.recommended_action}</div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {!!comparison.recommended_leverage?.length && (
              <Section
                title="Recommended leverage"
                count={comparison.recommended_leverage.length}
                defaultOpen
              >
                <ol className="space-y-3 text-xs">
                  {comparison.recommended_leverage.map((it, i) => (
                    <li
                      key={i}
                      className="border-l-2 border-emerald-500/60 pl-2"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {it.strategy}
                        </Badge>
                      </div>
                      <div className="mt-1">{it.rationale}</div>
                      {it.applies_when && (
                        <div className="text-muted-foreground italic">
                          Applies when: {it.applies_when}
                        </div>
                      )}
                      {it.draft_language && (
                        <pre className="mt-1 text-[11px] whitespace-pre-wrap bg-muted/50 p-2 rounded">
                          {it.draft_language}
                        </pre>
                      )}
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            {comparison.confidence_notes && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <strong>Model confidence notes:</strong>{" "}
                  {comparison.confidence_notes}
                </AlertDescription>
              </Alert>
            )}

            <p className="text-[11px] text-muted-foreground">
              Decision support only. Every recommendation must be reviewed by a
              licensed PA before action.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  count,
  defaultOpen = false,
  tone,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  tone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded border border-border/40 px-2 py-1"
    >
      <summary className="cursor-pointer select-none text-xs font-semibold flex items-center gap-2">
        <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-0 -rotate-90" />
        <span className={tone === "warn" ? "text-red-500" : ""}>{title}</span>
        <Badge variant="outline" className="text-[10px]">
          {count}
        </Badge>
      </summary>
      <div className="mt-2 pl-1">{children}</div>
    </details>
  );
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
