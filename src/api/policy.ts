import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

// Mirror of the contract returned by the `analyze_policy` edge function
// (supabase/functions/analyze_policy/policyAnalysis.ts).
export interface CoverageItem {
  name: string;
  limit: string | null;
  description: string | null;
}

export interface DeductibleItem {
  name: string;
  amount: string | null;
  basis: "flat" | "percentage" | "unknown";
}

export interface SublimitItem {
  name: string;
  limit: string | null;
}

export interface ExclusionItem {
  name: string;
  description: string | null;
}

export interface EndorsementItem {
  name: string;
  formNumber: string | null;
  effect: string | null;
}

export interface PolicyAnalysis {
  carrier: string | null;
  policyNumber: string | null;
  policyForm: string | null;
  state: string | null;
  namedInsured: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  coverages: CoverageItem[];
  deductibles: DeductibleItem[];
  sublimits: SublimitItem[];
  exclusions: ExclusionItem[];
  endorsements: EndorsementItem[];
  notableConditions: string[];
  summary: string;
  bestPracticeNotes: string[];
  complianceFlags: string[];
  reviewRequired: boolean;
  disclaimer: string;
}

export interface AnalyzePolicyInput {
  policyText: string;
  carrier?: string;
  state?: string;
}

/**
 * Send policy text to the `analyze_policy` edge function and return a
 * structured analysis. The function runs server-side so the AI provider key
 * is never exposed to the browser.
 */
export async function analyzePolicy(
  input: AnalyzePolicyInput,
): Promise<PolicyAnalysis> {
  const { data, error } = await getSupabaseClient().functions.invoke<{
    analysis: PolicyAnalysis;
  }>("analyze_policy", { body: input });

  if (error) {
    const detail = await extractFunctionError(error);
    throw new Error(detail ?? "Policy analysis request failed");
  }
  if (!data?.analysis) {
    throw new Error("Policy analysis returned no result");
  }
  return data.analysis;
}

async function extractFunctionError(error: unknown): Promise<string | null> {
  const context = (error as { context?: { json?: () => Promise<unknown> } })
    ?.context;
  if (context?.json) {
    try {
      const body = (await context.json()) as { message?: string };
      if (body?.message) return body.message;
    } catch {
      // fall through to the generic message below
    }
  }
  return error instanceof Error ? error.message : null;
}
