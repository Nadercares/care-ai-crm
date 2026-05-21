import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

const BUCKET = import.meta.env.VITE_ATTACHMENTS_BUCKET || "attachments";

export interface Policy {
  id: number;
  deal_id: number;
  policy_number: string | null;
  named_insured: string | null;
  policy_type: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  coverages: Record<string, unknown>;
  endorsements: unknown[];
  exclusions: unknown[];
  limits: Record<string, unknown>;
  deductibles: Record<string, unknown>;
  document_path: string | null;
  document_name: string | null;
  has_text: boolean;
  created_at: string;
}

const POLICY_COLUMNS =
  "id, deal_id, policy_number, named_insured, policy_type, effective_date, expiration_date, coverages, endorsements, exclusions, limits, deductibles, document_path, document_name, created_at";

export async function fetchPolicies(dealId: number): Promise<Policy[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("policies")
    .select(POLICY_COLUMNS)
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  // Separate tiny query so the (potentially large) document text never has to
  // travel to the browser just to show an "extracted" indicator.
  const { data: extracted } = await supabase
    .from("policies")
    .select("id")
    .eq("deal_id", dealId)
    .not("document_text", "is", null);
  const extractedIds = new Set((extracted ?? []).map((r) => r.id));

  return (data ?? []).map((p) => ({
    ...p,
    has_text: extractedIds.has(p.id),
  })) as Policy[];
}

async function callExtractPolicy(policyId: number): Promise<void> {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("You must be signed in.");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-policy`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ policyId }),
    },
  );
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.message ?? `Text extraction failed (${res.status})`);
  }
}

export async function uploadPolicy(
  dealId: number,
  file: File,
  policyNumber: string,
): Promise<{ extracted: boolean; message: string }> {
  const supabase = getSupabaseClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `policies/${dealId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file);
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data, error } = await supabase
    .from("policies")
    .insert({
      deal_id: dealId,
      policy_number: policyNumber.trim() || null,
      document_path: path,
      document_name: file.name,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Text extraction is best effort — the upload still counts as a success.
  try {
    await callExtractPolicy(data.id as number);
    return { extracted: true, message: "Policy uploaded and text extracted." };
  } catch (e) {
    return {
      extracted: false,
      message: `Policy uploaded, but text extraction failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}

export function reextractPolicy(policyId: number): Promise<void> {
  return callExtractPolicy(policyId);
}

export async function getPolicyFileUrl(path: string): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .storage.from(BUCKET)
    .createSignedUrl(path, 120);
  if (error || !data) throw new Error(error?.message ?? "Could not open file");
  return data.signedUrl;
}

export async function deletePolicy(policy: Policy): Promise<void> {
  const supabase = getSupabaseClient();
  if (policy.document_path) {
    await supabase.storage.from(BUCKET).remove([policy.document_path]);
  }
  const { error } = await supabase
    .from("policies")
    .delete()
    .eq("id", policy.id);
  if (error) throw new Error(error.message);
}
