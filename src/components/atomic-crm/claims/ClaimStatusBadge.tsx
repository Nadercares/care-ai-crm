import { useRecordContext } from "ra-core";
import { Badge } from "@/components/ui/badge";

import type { Claim } from "../types";
import { CLAIM_STATUSES } from "../claimsConsts";

const STATUS_TONE: Record<string, string> = {
  intake: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  filed: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  adjuster_assigned: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  inspection_scheduled: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  inspected: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  estimate_pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  negotiation: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  partial_payment: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  reopen: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  denied: "bg-red-500/15 text-red-300 border-red-500/30",
  appraisal: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  mediation: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  litigation: "bg-red-500/15 text-red-300 border-red-500/30",
  settled: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  closed: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

export const ClaimStatusBadge = () => {
  const record = useRecordContext<Claim>();
  if (!record?.status) return null;
  const label =
    CLAIM_STATUSES.find((s) => s.value === record.status)?.label ??
    String(record.status);
  const tone =
    STATUS_TONE[String(record.status)] ??
    "bg-slate-500/15 text-slate-300 border-slate-500/30";
  return (
    <Badge variant="outline" className={tone}>
      {label}
    </Badge>
  );
};
