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
  LEDGER_TYPES,
  addLedgerEntry,
  canSeeFinancials,
  deleteLedgerEntry,
  fetchCurrentUserRole,
  fetchLedger,
  fetchSettlement,
  fetchSettlementStats,
  saveSettlement,
  type LedgerEntry,
  type Settlement,
} from "@/api/financials";

function toAmount(value: string): number | null {
  const trimmed = value.trim().replace(/[,$\s]/g, "");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function ledgerTypeLabel(type: string): string {
  return LEDGER_TYPES.find((t) => t.value === type)?.label ?? type;
}

/**
 * Claim financials panel. Visible only to owner / accounting roles and
 * administrators (also enforced by Row Level Security on the database).
 */
export function FinancialsPanel({ dealId }: { dealId: number }) {
  const roleQuery = useQuery({
    queryKey: ["user_role"],
    queryFn: fetchCurrentUserRole,
  });

  return (
    <div className="m-4">
      <Separator className="mb-4" />
      <h3 className="text-sm font-semibold">Claim Financials</h3>
      {roleQuery.isLoading && (
        <div className="flex justify-center py-3">
          <Spinner />
        </div>
      )}
      {roleQuery.data && !canSeeFinancials(roleQuery.data) && (
        <p className="text-xs text-muted-foreground mt-1">
          Claim financials are visible to owner and accounting roles only.
        </p>
      )}
      {roleQuery.data && canSeeFinancials(roleQuery.data) && (
        <FinancialsContent dealId={dealId} />
      )}
    </div>
  );
}

function FinancialsContent({ dealId }: { dealId: number }) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const reportError = (e: unknown) =>
    notify(e instanceof Error ? e.message : String(e), { type: "error" });

  const ledgerQuery = useQuery({
    queryKey: ["ledger", dealId],
    queryFn: () => fetchLedger(dealId),
  });
  const settlementQuery = useQuery({
    queryKey: ["settlement", dealId],
    queryFn: () => fetchSettlement(dealId),
  });
  const statsQuery = useQuery({
    queryKey: ["settlement_stats"],
    queryFn: fetchSettlementStats,
  });

  const runComptroller = useMutation({
    mutationFn: () => runSpecialistAgent("comptroller", dealId),
    onSuccess: () => {
      notify(
        "Comptroller agent started — the ledger summary will appear in the AI Agents panel below.",
        { type: "info" },
      );
      queryClient.invalidateQueries({ queryKey: ["agent_runs", dealId] });
      queryClient.invalidateQueries({ queryKey: ["agent_outputs", dealId] });
    },
    onError: reportError,
  });

  const entries = ledgerQuery.data ?? [];
  const sumByType = (type: string) =>
    entries
      .filter((e) => e.entry_type === type)
      .reduce((s, e) => s + Number(e.amount), 0);
  const received = sumByType("payment_received");
  const fees = sumByType("care_fee");
  const expenses = sumByType("expense");
  const netToClient = received - fees - expenses;

  const stats = statsQuery.data;

  return (
    <div className="mt-2 space-y-4 text-xs">
      {ledgerQuery.isError && (
        <p className="text-destructive">
          Could not load financials. Apply the database migration:{" "}
          <code>npx supabase db reset --local</code>.
        </p>
      )}

      {settlementQuery.isLoading ? (
        <Spinner />
      ) : (
        <SettlementSection
          dealId={dealId}
          initial={settlementQuery.data ?? null}
          onSaved={() => {
            queryClient.invalidateQueries({
              queryKey: ["settlement", dealId],
            });
            queryClient.invalidateQueries({
              queryKey: ["settlement_stats"],
            });
          }}
        />
      )}

      <LedgerSection
        dealId={dealId}
        entries={entries}
        totals={{ received, fees, expenses, netToClient }}
        onChanged={() =>
          queryClient.invalidateQueries({ queryKey: ["ledger", dealId] })
        }
      />

      <div className="border-t pt-2">
        <div className="font-semibold text-muted-foreground tracking-wide mb-1">
          Firm-wide settlement performance
        </div>
        {!stats || stats.count === 0 ? (
          <p className="text-muted-foreground">
            No settlements recorded across the firm yet.
          </p>
        ) : (
          <p>
            {stats.count} settled claim(s) · avg written{" "}
            {money(stats.averageWritten)} · avg settled{" "}
            {money(stats.averageSettled)}
            {stats.ratio !== null
              ? ` · avg settled/written ${Math.round(stats.ratio * 100)}%`
              : ""}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => runComptroller.mutate()}
          disabled={runComptroller.isPending}
        >
          {runComptroller.isPending ? "Starting…" : "Run Comptroller agent"}
        </Button>
      </div>
    </div>
  );
}

function SettlementSection({
  dealId,
  initial,
  onSaved,
}: {
  dealId: number;
  initial: Settlement | null;
  onSaved: () => void;
}) {
  const notify = useNotify();
  const [written, setWritten] = useState(
    initial?.amount_written != null ? String(initial.amount_written) : "",
  );
  const [settled, setSettled] = useState(
    initial?.amount_settled != null ? String(initial.amount_settled) : "",
  );
  const [settledDate, setSettledDate] = useState(initial?.settled_date ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const save = useMutation({
    mutationFn: () =>
      saveSettlement(dealId, {
        amount_written: toAmount(written),
        amount_settled: toAmount(settled),
        settled_date: settledDate || null,
        notes,
      }),
    onSuccess: () => {
      notify("Settlement saved.", { type: "info" });
      onSaved();
    },
    onError: (e) =>
      notify(e instanceof Error ? e.message : String(e), { type: "error" }),
  });

  const writtenNum = toAmount(written);
  const settledNum = toAmount(settled);
  const gap =
    writtenNum !== null && settledNum !== null ? settledNum - writtenNum : null;

  return (
    <div>
      <div className="font-semibold text-muted-foreground tracking-wide mb-1.5">
        Settlement — written vs. settled
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Amount written (PA estimate)</Label>
          <Input
            className="h-8 text-xs"
            inputMode="decimal"
            placeholder="$"
            value={written}
            onChange={(e) => setWritten(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Amount settled</Label>
          <Input
            className="h-8 text-xs"
            inputMode="decimal"
            placeholder="$"
            value={settled}
            onChange={(e) => setSettled(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Settled date</Label>
          <Input
            type="date"
            className="h-8 text-xs"
            value={settledDate}
            onChange={(e) => setSettledDate(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1 mt-2">
        <Label className="text-xs">Notes</Label>
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-muted-foreground">
          {gap !== null ? (
            <>
              Difference: {money(gap)}
              {writtenNum ? ` (${Math.round((gap / writtenNum) * 100)}%)` : ""}
            </>
          ) : (
            "Enter both amounts to see the difference."
          )}
        </span>
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save settlement"}
        </Button>
      </div>
    </div>
  );
}

function LedgerSection({
  dealId,
  entries,
  totals,
  onChanged,
}: {
  dealId: number;
  entries: LedgerEntry[];
  totals: {
    received: number;
    fees: number;
    expenses: number;
    netToClient: number;
  };
  onChanged: () => void;
}) {
  const notify = useNotify();
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState("payment_received");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const reportError = (e: unknown) =>
    notify(e instanceof Error ? e.message : String(e), { type: "error" });

  const add = useMutation({
    mutationFn: () =>
      addLedgerEntry(dealId, {
        entry_type: type,
        description,
        amount: toAmount(amount) ?? 0,
        entry_date: date || null,
      }),
    onSuccess: () => {
      setDescription("");
      setAmount("");
      setShowForm(false);
      onChanged();
      notify("Ledger entry added.", { type: "info" });
    },
    onError: reportError,
  });
  const remove = useMutation({
    mutationFn: deleteLedgerEntry,
    onSuccess: () => {
      onChanged();
      notify("Entry removed.", { type: "info" });
    },
    onError: reportError,
  });

  return (
    <div className="border-t pt-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-semibold text-muted-foreground tracking-wide">
          Money ledger
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() => setShowForm((s) => !s)}
        >
          {showForm ? "Cancel" : "Add entry"}
        </Button>
      </div>

      {showForm && (
        <div className="border rounded-md p-2 space-y-2 mb-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEDGER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amount</Label>
              <Input
                className="h-8 text-xs"
                inputMode="decimal"
                placeholder="$"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input
                className="h-8 text-xs"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={add.isPending || toAmount(amount) === null}
              onClick={() => add.mutate()}
            >
              {add.isPending ? "Adding…" : "Add entry"}
            </Button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-muted-foreground">No ledger entries yet.</p>
      ) : (
        <div className="space-y-1">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-2 border rounded-md px-2 py-1"
            >
              <span className="flex items-center gap-2 min-w-0">
                <Badge variant="outline" className="text-[10px]">
                  {ledgerTypeLabel(entry.entry_type)}
                </Badge>
                <span className="truncate">
                  {entry.description || "—"}
                  {entry.entry_date ? ` · ${entry.entry_date}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="font-medium">{money(entry.amount)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-xs"
                  onClick={() => remove.mutate(entry.id)}
                >
                  Remove
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-muted-foreground">
        <span>Received: {money(totals.received)}</span>
        <span>CARE fees: {money(totals.fees)}</span>
        <span>Expenses: {money(totals.expenses)}</span>
        <span className="text-foreground font-medium">
          Net to client: {money(totals.netToClient)}
        </span>
      </div>
    </div>
  );
}
