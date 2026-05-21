import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

/** The 8 claim specialists, for display in the Agents panel. */
export interface AgentCatalogEntry {
  id: string;
  label: string;
  description: string;
}

export const AGENT_CATALOG: AgentCatalogEntry[] = [
  {
    id: "policy_review",
    label: "Policy Review",
    description:
      "Interprets coverages, endorsements, exclusions, limits and deductibles for the client.",
  },
  {
    id: "state_compliance",
    label: "State Compliance",
    description: "State-specific rules, deadlines and required disclosures.",
  },
  {
    id: "documents_email",
    label: "Documents & Email",
    description: "Fills document templates and drafts replies to claim email.",
  },
  {
    id: "weather_research",
    label: "Weather Research",
    description: "Researches the weather event for weather-related claims.",
  },
  {
    id: "strategy_research",
    label: "Strategy & Research",
    description: "Claim strategy from policy language and carrier patterns.",
  },
  {
    id: "estimate_comparison",
    label: "Estimate Comparison",
    description: "Compares estimates and drafts a negotiation letter.",
  },
  {
    id: "comptroller",
    label: "Comptroller / Bookkeeper",
    description: "Claim accounting and written-vs-settled tracking.",
  },
  {
    id: "data_reporting",
    label: "Data & Reporting",
    description: "Knowledge base and on-demand reports.",
  },
];

export const AGENT_LABELS: Record<string, string> = {
  orchestrator: "Lead Orchestrator",
  ...Object.fromEntries(AGENT_CATALOG.map((a) => [a.id, a.label])),
};

export interface AgentRun {
  id: number;
  created_at: string;
  deal_id: number;
  parent_run_id: number | null;
  agent_type: string;
  status: string;
  error: string | null;
  finished_at: string | null;
}

export interface AgentOutput {
  id: number;
  created_at: string;
  run_id: number | null;
  deal_id: number;
  agent_type: string;
  output_type: string;
  title: string | null;
  content: string | null;
  status: string;
}

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("You must be signed in to run the AI agents.");
  }

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.message ?? `Request failed (${res.status})`);
  }
  return json as T;
}

/** Starts the Lead Orchestrator for a claim. Resolves once the run is queued. */
export function runOrchestrator(dealId: number) {
  return callFunction<{ runId: number }>("orchestrator", { dealId });
}

/** Starts a single specialist agent for a claim. */
export function runSpecialistAgent(
  agentType: string,
  dealId: number,
  instructions?: string,
) {
  return callFunction<{ runId: number }>("agent", {
    agentType,
    dealId,
    input: { instructions },
  });
}

export async function fetchAgentRuns(dealId: number): Promise<AgentRun[]> {
  const { data, error } = await getSupabaseClient()
    .from("agent_runs")
    .select(
      "id, created_at, deal_id, parent_run_id, agent_type, status, error, finished_at",
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AgentRun[];
}

export async function fetchAgentOutputs(
  dealId: number,
): Promise<AgentOutput[]> {
  const { data, error } = await getSupabaseClient()
    .from("agent_outputs")
    .select(
      "id, created_at, run_id, deal_id, agent_type, output_type, title, content, status",
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AgentOutput[];
}
