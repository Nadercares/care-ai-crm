import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

export interface UserRole {
  role: string;
  administrator: boolean;
}

export interface LedgerEntry {
  id: number;
  deal_id: number;
  entry_type: string;
  description: string | null;
  amount: number;
  entry_date: string | null;
  created_at: string;
}

export interface LedgerEntryInput {
  entry_type: string;
  description: string;
  amount: number;
  entry_date: string | null;
}

export interface Settlement {
  id: number;
  deal_id: number;
  amount_written: number | null;
  amount_settled: number | null;
  settled_date: string | null;
  notes: string | null;
}

export interface SettlementInput {
  amount_written: number | null;
  amount_settled: number | null;
  settled_date: string | null;
  notes: string;
}

export interface SettlementStats {
  count: number;
  averageWritten: number;
  averageSettled: number;
  ratio: number | null;
}

export const LEDGER_TYPES: { value: string; label: string }[] = [
  { value: "payment_received", label: "Payment received" },
  { value: "care_fee", label: "CARE fee" },
  { value: "expense", label: "Expense" },
];

export async function fetchCurrentUserRole(): Promise<UserRole> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { role: "", administrator: false };
  const { data } = await supabase
    .from("sales")
    .select("role, administrator")
    .eq("user_id", user.id)
    .maybeSingle();
  return {
    role: data?.role ?? "",
    administrator: !!data?.administrator,
  };
}

/** Finance data is visible to owners, accounting staff, and administrators. */
export function canSeeFinancials(role: UserRole): boolean {
  return (
    role.administrator || role.role === "owner" || role.role === "accounting"
  );
}

export async function fetchLedger(dealId: number): Promise<LedgerEntry[]> {
  const { data, error } = await getSupabaseClient()
    .from("financial_ledger")
    .select(
      "id, deal_id, entry_type, description, amount, entry_date, created_at",
    )
    .eq("deal_id", dealId)
    .order("entry_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as LedgerEntry[];
}

export async function addLedgerEntry(
  dealId: number,
  input: LedgerEntryInput,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("financial_ledger")
    .insert({
      deal_id: dealId,
      entry_type: input.entry_type,
      description: input.description.trim() || null,
      amount: input.amount,
      entry_date: input.entry_date,
    });
  if (error) throw new Error(error.message);
}

export async function deleteLedgerEntry(id: number): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("financial_ledger")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function fetchSettlement(
  dealId: number,
): Promise<Settlement | null> {
  const { data, error } = await getSupabaseClient()
    .from("settlements")
    .select("id, deal_id, amount_written, amount_settled, settled_date, notes")
    .eq("deal_id", dealId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as Settlement | null;
}

export async function saveSettlement(
  dealId: number,
  input: SettlementInput,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("settlements")
    .upsert(
      {
        deal_id: dealId,
        amount_written: input.amount_written,
        amount_settled: input.amount_settled,
        settled_date: input.settled_date,
        notes: input.notes.trim() || null,
      },
      { onConflict: "deal_id" },
    );
  if (error) throw new Error(error.message);
}

export async function fetchSettlementStats(): Promise<SettlementStats> {
  const { data, error } = await getSupabaseClient()
    .from("settlements")
    .select("amount_written, amount_settled");
  if (error) throw new Error(error.message);

  const rows = (data ?? []).filter(
    (r) => r.amount_written != null && r.amount_settled != null,
  );
  if (!rows.length) {
    return { count: 0, averageWritten: 0, averageSettled: 0, ratio: null };
  }
  const written = rows.reduce((s, r) => s + Number(r.amount_written), 0);
  const settled = rows.reduce((s, r) => s + Number(r.amount_settled), 0);
  return {
    count: rows.length,
    averageWritten: Math.round(written / rows.length),
    averageSettled: Math.round(settled / rows.length),
    ratio: written > 0 ? settled / written : null,
  };
}
