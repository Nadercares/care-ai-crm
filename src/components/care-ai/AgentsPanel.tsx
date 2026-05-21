import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AGENT_CATALOG,
  AGENT_LABELS,
  fetchAgentOutputs,
  fetchAgentRuns,
  runOrchestrator,
  runSpecialistAgent,
  type AgentRun,
} from "@/api/agents";

const isActive = (status: string) =>
  status === "running" || status === "queued";

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "succeeded"
      ? "secondary"
      : status === "failed"
        ? "destructive"
        : "outline";
  return (
    <Badge variant={variant} className="text-[10px] px-1.5 py-0">
      {status}
    </Badge>
  );
}

/**
 * AI Agents panel shown on the claim (deal) screen. Lets staff run the Lead
 * Orchestrator or an individual specialist, and review the drafts they produce.
 */
export function AgentsPanel({ dealId }: { dealId: number }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const runsQuery = useQuery({
    queryKey: ["agent_runs", dealId],
    queryFn: () => fetchAgentRuns(dealId),
    refetchInterval: (query) =>
      (query.state.data as AgentRun[] | undefined)?.some((r) =>
        isActive(r.status),
      )
        ? 4000
        : false,
  });
  const runs = runsQuery.data ?? [];
  const busy = runs.some((r) => isActive(r.status));

  const outputsQuery = useQuery({
    queryKey: ["agent_outputs", dealId],
    queryFn: () => fetchAgentOutputs(dealId),
    refetchInterval: () => (busy ? 4000 : false),
  });
  const outputs = outputsQuery.data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["agent_runs", dealId] });
    queryClient.invalidateQueries({ queryKey: ["agent_outputs", dealId] });
  };

  const orchestrate = useMutation({
    mutationFn: () => runOrchestrator(dealId),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const runOne = useMutation({
    mutationFn: (agentType: string) => runSpecialistAgent(agentType, dealId),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const tablesMissing = runsQuery.isError;

  return (
    <div className="m-4">
      <Separator className="mb-4" />

      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="text-sm font-semibold">AI Agents</h3>
          <p className="text-xs text-muted-foreground">
            The lead orchestrator and 8 specialists. Every output is a draft for
            staff review.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setError(null);
            orchestrate.mutate();
          }}
          disabled={orchestrate.isPending || tablesMissing}
        >
          {orchestrate.isPending
            ? "Starting…"
            : busy
              ? "Agents running…"
              : "Run Orchestrator"}
        </Button>
      </div>

      {tablesMissing && (
        <p className="text-xs text-destructive mb-3">
          Could not load agent data. Apply the database migration first:{" "}
          <code>npx supabase db reset --local</code>.
        </p>
      )}
      {error && <p className="text-xs text-destructive mb-3">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        {AGENT_CATALOG.map((agent) => {
          const latest = runs.find((r) => r.agent_type === agent.id);
          return (
            <div
              key={agent.id}
              className="border rounded-md p-2 flex items-start justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium truncate">
                    {agent.label}
                  </span>
                  {latest && <StatusBadge status={latest.status} />}
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                  {agent.description}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs shrink-0"
                onClick={() => {
                  setError(null);
                  runOne.mutate(agent.id);
                }}
                disabled={runOne.isPending || tablesMissing}
              >
                Run
              </Button>
            </div>
          );
        })}
      </div>

      <h4 className="text-xs font-semibold text-muted-foreground tracking-wide mb-2">
        Agent Outputs
      </h4>
      {outputs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No agent outputs yet. Run the orchestrator or a specialist to get
          started.
        </p>
      ) : (
        <div className="space-y-2">
          {outputs.map((output) => (
            <div key={output.id} className="border rounded-md">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-2 p-2 text-left"
                onClick={() =>
                  setExpanded(expanded === output.id ? null : output.id)
                }
              >
                <span className="text-xs font-medium truncate">
                  {output.title ?? output.output_type}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-muted-foreground">
                    {AGENT_LABELS[output.agent_type] ?? output.agent_type}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {output.status}
                  </Badge>
                </span>
              </button>
              {expanded === output.id && (
                <div className="px-3 pb-3 pt-2 border-t text-xs whitespace-pre-wrap leading-5">
                  {output.content}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {runs.some((r) => r.status === "failed") && (
        <p className="text-[11px] text-destructive mt-2">
          Some agent runs failed. The most common cause is a missing
          ANTHROPIC_API_KEY secret on the server.
        </p>
      )}
    </div>
  );
}
