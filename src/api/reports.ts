import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

export interface ReportType {
  value: string;
  label: string;
  description: string;
  instructions: string;
}

export const REPORT_TYPES: ReportType[] = [
  {
    value: "claims_status",
    label: "Claims status overview",
    description:
      "How many claims sit in each stage, plus what needs attention.",
    instructions:
      "Produce a firm-wide claims status overview: how many claims are in each pipeline stage, the active vs. archived split, and the claims that most need attention.",
  },
  {
    value: "carrier_performance",
    label: "Carrier performance",
    description:
      "Settlement averages and settled-to-written ratios by carrier.",
    instructions:
      "Produce a carrier performance report from the firm-wide settlement statistics: for each carrier, the average written and settled amounts and the settled-to-written ratio, with commentary on which carriers settle well and which push back hardest.",
  },
  {
    value: "carrier_directory",
    label: "Carrier & adjuster directory",
    description: "Every carrier and adjuster with their contact details.",
    instructions:
      "Produce a clean carrier and adjuster directory: each carrier with its contact details, and that carrier's adjusters with their license numbers, license state and contact information.",
  },
  {
    value: "pipeline_by_carrier",
    label: "Claims pipeline by carrier",
    description: "Which claims each carrier has, by stage.",
    instructions:
      "Produce a claims pipeline report grouped by carrier: which claims each carrier has, their stages, loss types, loss states and amounts.",
  },
];

export interface Report {
  id: number;
  title: string | null;
  content: string | null;
  status: string;
  created_at: string;
}

export interface ReportRun {
  id: number;
  status: string;
  error: string | null;
  created_at: string;
}

export async function runReport(
  reportType: ReportType,
): Promise<{ runId: number }> {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("You must be signed in.");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentType: "data_reporting",
        input: {
          instructions: `Report requested: ${reportType.label}. ${reportType.instructions}`,
        },
      }),
    },
  );
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.message ?? `Report request failed (${res.status})`);
  }
  return json as { runId: number };
}

export async function fetchReports(): Promise<Report[]> {
  const { data, error } = await getSupabaseClient()
    .from("agent_outputs")
    .select("id, title, content, status, created_at")
    .eq("agent_type", "data_reporting")
    .is("deal_id", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Report[];
}

export async function fetchReportRuns(): Promise<ReportRun[]> {
  const { data, error } = await getSupabaseClient()
    .from("agent_runs")
    .select("id, status, error, created_at")
    .eq("agent_type", "data_reporting")
    .is("deal_id", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as ReportRun[];
}
