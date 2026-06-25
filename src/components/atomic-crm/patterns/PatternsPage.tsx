import { useEffect, useState } from "react";
import { useNotify } from "ra-core";
import { Loader2, TrendingUp, Gavel, Scale, Users } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { getSupabaseClient } from "../providers/supabase/supabase";

interface CarrierRow {
  carrier_id: number;
  carrier_name: string;
  naic_code: string | null;
  default_state: string | null;
  claim_count: number;
  settled_count: number;
  total_settled_amount: number | string | null;
  avg_settlement_amount: number | string | null;
  avg_days_to_settle: number | string | null;
  count_negotiation: number;
  count_appraisal: number;
  count_mediation: number;
  count_litigation: number;
  count_denied: number;
  count_withdrawn: number;
  count_with_attorney: number;
  count_escalated: number;
  last_settlement_at: string | null;
}

interface AdjusterRow {
  carrier_adjuster_id: number;
  adjuster_name: string;
  license_number: string | null;
  license_state: string | null;
  role: string | null;
  carrier_id: number | null;
  carrier_name: string | null;
  claim_count: number;
  settled_count: number;
  total_settled_amount: number | string | null;
  avg_settlement_amount: number | string | null;
  avg_days_to_settle: number | string | null;
  count_with_attorney: number;
  count_escalated: number;
  count_negotiation: number;
  count_appraisal: number;
  count_mediation: number;
  count_litigation: number;
  count_denied: number;
}

function PatternsPage() {
  const notify = useNotify();
  const [carriers, setCarriers] = useState<CarrierRow[]>([]);
  const [adjusters, setAdjusters] = useState<AdjusterRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = getSupabaseClient();
      const [{ data: cData, error: cErr }, { data: aData, error: aErr }] =
        await Promise.all([
          supabase
            .from("carrier_patterns_summary")
            .select("*")
            .order("claim_count", { ascending: false }),
          supabase
            .from("adjuster_patterns_summary")
            .select("*")
            .order("claim_count", { ascending: false })
            .limit(50),
        ]);
      if (cancelled) return;
      if (cErr)
        notify(`Could not read carrier patterns: ${cErr.message}`, {
          type: "error",
        });
      if (aErr)
        notify(`Could not read adjuster patterns: ${aErr.message}`, {
          type: "error",
        });
      setCarriers((cData as CarrierRow[]) ?? []);
      setAdjusters((aData as AdjusterRow[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [notify]);

  const totals = computeOverall(carriers);
  // Only show carriers and adjusters that have at least one claim attached.
  const carriersWithActivity = carriers.filter((c) => c.claim_count > 0);
  const adjustersWithActivity = adjusters.filter((a) => a.claim_count > 0);

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Carrier & adjuster patterns</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Settlement velocity, method mix, and attorney involvement aggregated
          from every claim and settlement in the CRM. Use this to pick the right
          escalation move on the next claim with the same carrier or adjuster.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading aggregates…
        </div>
      )}

      {!loading && (
        <>
          <OverallSummary totals={totals} />
          <CarrierTable rows={carriersWithActivity} />
          <AdjusterTable rows={adjustersWithActivity} />
        </>
      )}
    </div>
  );
}

PatternsPage.path = "/patterns";

export { PatternsPage };

// --- subcomponents ---

interface Totals {
  carrierCount: number;
  claimCount: number;
  settledCount: number;
  totalSettled: number;
  methodBreakdown: { method: string; count: number }[];
  attorneyCount: number;
  escalatedCount: number;
}

function computeOverall(carriers: CarrierRow[]): Totals {
  const totals: Totals = {
    carrierCount: carriers.length,
    claimCount: 0,
    settledCount: 0,
    totalSettled: 0,
    methodBreakdown: [
      { method: "negotiation", count: 0 },
      { method: "appraisal", count: 0 },
      { method: "mediation", count: 0 },
      { method: "litigation", count: 0 },
      { method: "denied", count: 0 },
      { method: "withdrawn", count: 0 },
    ],
    attorneyCount: 0,
    escalatedCount: 0,
  };
  for (const c of carriers) {
    totals.claimCount += c.claim_count;
    totals.settledCount += c.settled_count;
    totals.totalSettled += Number(c.total_settled_amount) || 0;
    totals.attorneyCount += c.count_with_attorney;
    totals.escalatedCount += c.count_escalated;
    totals.methodBreakdown[0].count += c.count_negotiation;
    totals.methodBreakdown[1].count += c.count_appraisal;
    totals.methodBreakdown[2].count += c.count_mediation;
    totals.methodBreakdown[3].count += c.count_litigation;
    totals.methodBreakdown[4].count += c.count_denied;
    totals.methodBreakdown[5].count += c.count_withdrawn;
  }
  return totals;
}

function OverallSummary({ totals }: { totals: Totals }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        icon={<TrendingUp className="h-4 w-4" />}
        label="Claims tracked"
        value={fmtNumber(totals.claimCount)}
        sub={`across ${totals.carrierCount} carriers`}
      />
      <StatCard
        icon={<Scale className="h-4 w-4" />}
        label="Settled"
        value={fmtNumber(totals.settledCount)}
        sub={fmtMoney(totals.totalSettled)}
      />
      <StatCard
        icon={<Gavel className="h-4 w-4" />}
        label="Escalated"
        value={fmtNumber(totals.escalatedCount)}
        sub={`${pct(totals.escalatedCount, totals.settledCount)} of settled`}
      />
      <StatCard
        icon={<Users className="h-4 w-4" />}
        label="With attorney"
        value={fmtNumber(totals.attorneyCount)}
        sub={`${pct(totals.attorneyCount, totals.settledCount)} of settled`}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
          {icon}
          {label}
        </div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}

function CarrierTable({ rows }: { rows: CarrierRow[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">
          Carriers ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground p-4">
            No carrier-linked claims yet. Add carriers + claims and the patterns
            will populate.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground border-b border-border">
                <tr>
                  <Th>Carrier</Th>
                  <Th>Claims</Th>
                  <Th>Settled</Th>
                  <Th>Avg $</Th>
                  <Th>Avg days</Th>
                  <Th>Method mix</Th>
                  <Th>Escalated</Th>
                  <Th>Attorney</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.carrier_id} className="border-b border-border/40">
                    <Td>
                      <div className="font-semibold">{r.carrier_name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {r.naic_code ? `NAIC ${r.naic_code}` : ""}{" "}
                        {r.default_state ? `· ${r.default_state}` : ""}
                      </div>
                    </Td>
                    <Td>{r.claim_count}</Td>
                    <Td>{r.settled_count}</Td>
                    <Td>{fmtMoneyShort(r.avg_settlement_amount)}</Td>
                    <Td>{fmtDays(r.avg_days_to_settle)}</Td>
                    <Td>
                      <MethodBar row={r} />
                    </Td>
                    <Td>
                      {pct(r.count_escalated, r.settled_count)}
                      <span className="text-muted-foreground ml-1">
                        ({r.count_escalated})
                      </span>
                    </Td>
                    <Td>
                      {pct(r.count_with_attorney, r.settled_count)}
                      <span className="text-muted-foreground ml-1">
                        ({r.count_with_attorney})
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AdjusterTable({ rows }: { rows: AdjusterRow[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">
          Adjuster scorecard ({rows.length}){" "}
          <span className="text-xs text-muted-foreground font-normal">
            top 50 by claim volume
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground p-4">
            No adjuster-linked claims yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground border-b border-border">
                <tr>
                  <Th>Adjuster</Th>
                  <Th>Carrier</Th>
                  <Th>Claims</Th>
                  <Th>Settled</Th>
                  <Th>Avg $</Th>
                  <Th>Avg days</Th>
                  <Th>Escalated</Th>
                  <Th>Attorney</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.carrier_adjuster_id}
                    className="border-b border-border/40"
                  >
                    <Td>
                      <div className="font-semibold">{r.adjuster_name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {r.license_number
                          ? `lic ${r.license_number}`
                          : "no license #"}
                        {r.license_state ? ` · ${r.license_state}` : ""}
                        {r.role ? ` · ${r.role}` : ""}
                      </div>
                    </Td>
                    <Td>{r.carrier_name ?? "—"}</Td>
                    <Td>{r.claim_count}</Td>
                    <Td>{r.settled_count}</Td>
                    <Td>{fmtMoneyShort(r.avg_settlement_amount)}</Td>
                    <Td>{fmtDays(r.avg_days_to_settle)}</Td>
                    <Td>
                      {pct(r.count_escalated, r.settled_count)}
                      <span className="text-muted-foreground ml-1">
                        ({r.count_escalated})
                      </span>
                    </Td>
                    <Td>
                      {pct(r.count_with_attorney, r.settled_count)}
                      <span className="text-muted-foreground ml-1">
                        ({r.count_with_attorney})
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MethodBar({ row }: { row: CarrierRow }) {
  const segs = [
    {
      key: "negotiation",
      count: row.count_negotiation,
      color: "bg-emerald-500",
    },
    { key: "appraisal", count: row.count_appraisal, color: "bg-amber-500" },
    { key: "mediation", count: row.count_mediation, color: "bg-blue-500" },
    { key: "litigation", count: row.count_litigation, color: "bg-red-500" },
    { key: "denied", count: row.count_denied, color: "bg-gray-500" },
    { key: "withdrawn", count: row.count_withdrawn, color: "bg-gray-400" },
  ];
  const total = segs.reduce((s, x) => s + x.count, 0);
  if (total === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-1 min-w-[180px]">
      <div className="flex h-2 w-full rounded overflow-hidden">
        {segs.map((s) => (
          <div
            key={s.key}
            className={s.color}
            style={{ width: `${(s.count / total) * 100}%` }}
            title={`${s.key}: ${s.count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {segs
          .filter((s) => s.count > 0)
          .map((s) => (
            <Badge key={s.key} variant="outline" className="text-[10px]">
              {s.key} {s.count}
            </Badge>
          ))}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="py-2 px-3 font-medium">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="py-2 px-3 align-top">{children}</td>;
}

function pct(num: number, den: number): string {
  if (!den) return "—";
  return `${((num / den) * 100).toFixed(0)}%`;
}
function fmtNumber(n: number): string {
  return n.toLocaleString();
}
function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function fmtMoneyShort(n: number | string | null): string {
  if (n === null || n === undefined || n === "") return "—";
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return "—";
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 10_000) return `$${(num / 1_000).toFixed(0)}k`;
  return `$${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function fmtDays(n: number | string | null): string {
  if (n === null || n === undefined || n === "") return "—";
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return "—";
  return `${num.toFixed(0)}d`;
}
