import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

export interface CarrierSummary {
  id: number;
  name: string;
}

export interface Carrier {
  id: number;
  name: string;
  naic_code: string | null;
  phone: string | null;
  email: string | null;
  claims_portal_url: string | null;
  notes: string | null;
}

export interface CarrierAdjuster {
  id: number;
  carrier_id: number;
  first_name: string | null;
  last_name: string | null;
  license_number: string | null;
  license_state: string | null;
  adjuster_type: string | null;
  phone: string | null;
  email: string | null;
}

export interface CarrierAdjusterInput {
  first_name: string;
  last_name: string;
  license_number: string;
  license_state: string;
  adjuster_type: string;
  phone: string;
  email: string;
}

export async function fetchCarriers(): Promise<CarrierSummary[]> {
  const { data, error } = await getSupabaseClient()
    .from("carriers")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CarrierSummary[];
}

export async function fetchClaimCarrier(
  dealId: number,
): Promise<Carrier | null> {
  const supabase = getSupabaseClient();
  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .select("primary_carrier_id")
    .eq("id", dealId)
    .single();
  if (dealError) throw new Error(dealError.message);
  if (!deal?.primary_carrier_id) return null;

  const { data, error } = await supabase
    .from("carriers")
    .select("id, name, naic_code, phone, email, claims_portal_url, notes")
    .eq("id", deal.primary_carrier_id)
    .single();
  if (error) throw new Error(error.message);
  return data as Carrier;
}

export async function createCarrier(name: string): Promise<number> {
  const { data, error } = await getSupabaseClient()
    .from("carriers")
    .insert({ name: name.trim() })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as number;
}

export async function setClaimCarrier(
  dealId: number,
  carrierId: number | null,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("deals")
    .update({ primary_carrier_id: carrierId })
    .eq("id", dealId);
  if (error) throw new Error(error.message);
}

export async function updateCarrierNotes(
  carrierId: number,
  notes: string,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("carriers")
    .update({ notes: notes.trim() || null })
    .eq("id", carrierId);
  if (error) throw new Error(error.message);
}

export async function fetchCarrierAdjusters(
  carrierId: number,
): Promise<CarrierAdjuster[]> {
  const { data, error } = await getSupabaseClient()
    .from("carrier_adjusters")
    .select(
      "id, carrier_id, first_name, last_name, license_number, license_state, adjuster_type, phone, email",
    )
    .eq("carrier_id", carrierId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CarrierAdjuster[];
}

export async function addCarrierAdjuster(
  carrierId: number,
  input: CarrierAdjusterInput,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("carrier_adjusters")
    .insert({
      carrier_id: carrierId,
      first_name: input.first_name.trim() || null,
      last_name: input.last_name.trim() || null,
      license_number: input.license_number.trim() || null,
      license_state: input.license_state.trim() || null,
      adjuster_type: input.adjuster_type.trim() || null,
      phone: input.phone.trim() || null,
      email: input.email.trim() || null,
    });
  if (error) throw new Error(error.message);
}

export async function deleteCarrierAdjuster(id: number): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("carrier_adjusters")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}
