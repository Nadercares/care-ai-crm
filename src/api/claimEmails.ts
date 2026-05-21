import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

export interface ClaimEmail {
  id: number;
  deal_id: number;
  direction: string;
  from_email: string | null;
  from_name: string | null;
  to_email: string | null;
  subject: string | null;
  body: string | null;
  received_at: string;
}

export interface ClaimEmailInput {
  direction: string;
  from_name: string;
  from_email: string;
  subject: string;
  body: string;
}

export async function fetchClaimEmails(dealId: number): Promise<ClaimEmail[]> {
  const { data, error } = await getSupabaseClient()
    .from("claim_emails")
    .select(
      "id, deal_id, direction, from_email, from_name, to_email, subject, body, received_at",
    )
    .eq("deal_id", dealId)
    .order("received_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ClaimEmail[];
}

export async function logClaimEmail(
  dealId: number,
  input: ClaimEmailInput,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("claim_emails")
    .insert({
      deal_id: dealId,
      direction: input.direction,
      from_name: input.from_name || null,
      from_email: input.from_email || null,
      subject: input.subject || null,
      body: input.body || null,
    });
  if (error) throw new Error(error.message);
}

export async function deleteClaimEmail(id: number): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("claim_emails")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}
