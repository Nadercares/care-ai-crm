import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

export interface StateRule {
  id: number;
  state_abbr: string;
  state_name: string;
  pa_license_required: boolean | null;
  fee_rules: string | null;
  contract_rules: string | null;
  claim_deadlines: string | null;
  required_disclosures: string | null;
  statute_of_limitations: string | null;
  dispute_options: string | null;
  notes: string | null;
}

const COLUMNS =
  "id, state_abbr, state_name, pa_license_required, fee_rules, contract_rules, claim_deadlines, required_disclosures, statute_of_limitations, dispute_options, notes";

export async function fetchStateRules(): Promise<StateRule[]> {
  const { data, error } = await getSupabaseClient()
    .from("state_compliance_rules")
    .select(COLUMNS)
    .order("state_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StateRule[];
}

export async function saveStateRule(rule: StateRule): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("state_compliance_rules")
    .update({
      pa_license_required: rule.pa_license_required,
      fee_rules: rule.fee_rules,
      contract_rules: rule.contract_rules,
      claim_deadlines: rule.claim_deadlines,
      required_disclosures: rule.required_disclosures,
      statute_of_limitations: rule.statute_of_limitations,
      dispute_options: rule.dispute_options,
      notes: rule.notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rule.id);
  if (error) throw new Error(error.message);
}
