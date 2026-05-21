import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

export interface Estimate {
  id: number;
  deal_id: number;
  source: string;
  label: string | null;
  total_rcv: number | null;
  total_acv: number | null;
  depreciation: number | null;
  deductible: number | null;
  content: string | null;
  created_at: string;
}

export interface EstimateInput {
  source: string;
  label: string;
  total_rcv: number | null;
  total_acv: number | null;
  depreciation: number | null;
  deductible: number | null;
  content: string;
}

export const ESTIMATE_SOURCES: { value: string; label: string }[] = [
  { value: "carrier", label: "Insurance Carrier" },
  { value: "public_adjuster", label: "Public Adjuster" },
  { value: "contractor", label: "Contractor" },
  { value: "other", label: "Other" },
];

export async function fetchEstimates(dealId: number): Promise<Estimate[]> {
  const { data, error } = await getSupabaseClient()
    .from("estimates")
    .select(
      "id, deal_id, source, label, total_rcv, total_acv, depreciation, deductible, content, created_at",
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Estimate[];
}

export async function createEstimate(
  dealId: number,
  input: EstimateInput,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("estimates")
    .insert({
      deal_id: dealId,
      source: input.source,
      label: input.label.trim() || null,
      total_rcv: input.total_rcv,
      total_acv: input.total_acv,
      depreciation: input.depreciation,
      deductible: input.deductible,
      content: input.content.trim() || null,
    });
  if (error) throw new Error(error.message);
}

export async function deleteEstimate(id: number): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("estimates")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}
