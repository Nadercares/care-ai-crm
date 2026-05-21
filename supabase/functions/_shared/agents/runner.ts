// The agent runtime (Roadmap Stage 2): runs one agent's tool-use loop, records
// it in agent_runs, and saves the deliverable in agent_outputs. The Orchestrator
// uses the special delegate_to_agent tool to run specialists as child runs.
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { callClaude, type ToolSchema } from "./anthropic.ts";
import { AGENTS, SPECIALIST_IDS } from "./registry.ts";
import { TOOLS, type ToolContext } from "./tools.ts";

const MAX_STEPS = 10; // Claude calls per agent
const MAX_DEPTH = 2; // orchestrator -> specialist

const DELEGATE_TOOL: ToolSchema = {
  name: "delegate_to_agent",
  description:
    "Assign a task to a specialist agent and get its finished result back. Use this to run the specialists this claim needs.",
  input_schema: {
    type: "object",
    properties: {
      agent_type: {
        type: "string",
        description: "Which specialist to run.",
        enum: SPECIALIST_IDS,
      },
      instructions: {
        type: "string",
        description:
          "Clear, specific instructions telling the specialist what to do for this claim.",
      },
    },
    required: ["agent_type"],
  },
};

export async function startAgentRun(opts: {
  agentType: string;
  dealId: number | null;
  triggeredBy: number | null;
  instructions?: string;
  parentRunId?: number | null;
}): Promise<number> {
  const def = AGENTS[opts.agentType];
  if (!def) throw new Error(`Unknown agent type: ${opts.agentType}`);

  const { data, error } = await supabaseAdmin
    .from("agent_runs")
    .insert({
      deal_id: opts.dealId,
      agent_type: def.id,
      status: "running",
      triggered_by: opts.triggeredBy,
      parent_run_id: opts.parentRunId ?? null,
      input: { instructions: opts.instructions ?? null },
      model: def.model,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Could not create agent run: ${error?.message ?? "unknown"}`,
    );
  }
  return data.id as number;
}

interface RunRow {
  id: number;
  deal_id: number | null;
  agent_type: string;
  triggered_by: number | null;
  input: { instructions?: string | null } | null;
}

/**
 * Executes a previously created agent run to completion. Safe to call from a
 * background task (EdgeRuntime.waitUntil). Always settles the run row to
 * 'succeeded' or 'failed'.
 */
export async function executeAgentRun(
  runId: number,
  depth = 0,
): Promise<{ status: string; content: string }> {
  const { data: run, error } = await supabaseAdmin
    .from("agent_runs")
    .select("id, deal_id, agent_type, triggered_by, input")
    .eq("id", runId)
    .single();
  if (error || !run) throw new Error(`Agent run ${runId} not found`);

  const runRow = run as RunRow;
  const def = AGENTS[runRow.agent_type];
  if (!def) {
    await failRun(runId, `Unknown agent type: ${runRow.agent_type}`);
    return { status: "failed", content: "" };
  }

  const ctx: ToolContext = {
    dealId: runRow.deal_id,
    runId,
    triggeredBy: runRow.triggered_by,
  };
  const instructions = runRow.input?.instructions ?? undefined;

  const toolSchemas: ToolSchema[] = def.tools.map((name) => {
    if (name === "delegate_to_agent") return DELEGATE_TOOL;
    const tool = TOOLS[name];
    if (!tool)
      throw new Error(`Agent ${def.id} references unknown tool: ${name}`);
    return tool.schema;
  });

  const messages: Array<{ role: string; content: unknown }> = [
    {
      role: "user",
      content:
        (ctx.dealId != null
          ? `You are working on claim (deal) ID ${ctx.dealId}.\n\n`
          : `This is a firm-wide run, not tied to a single claim.\n\n`) +
        (instructions ? `Instructions: ${instructions}\n\n` : "") +
        `Use your tools to gather the information you need, then write your final deliverable as your last message.`,
    },
  ];

  let finalText = "";
  let tokensIn = 0;
  let tokensOut = 0;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await callClaude({
        model: def.model,
        system: def.systemPrompt,
        messages,
        tools: toolSchemas,
        maxTokens: 4096,
      });
      tokensIn += response.usage?.input_tokens ?? 0;
      tokensOut += response.usage?.output_tokens ?? 0;

      const text = response.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n\n");
      if (text.trim()) finalText = text;

      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter(
        (
          b,
        ): b is {
          type: "tool_use";
          id: string;
          name: string;
          input: Record<string, unknown>;
        } => b.type === "tool_use",
      );
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

      const toolResults = [];
      for (const tu of toolUses) {
        let result: unknown;
        try {
          if (tu.name === "delegate_to_agent") {
            result = await handleDelegate(tu.input, ctx, depth);
          } else {
            const tool = TOOLS[tu.name];
            if (!tool) throw new Error(`Unknown tool: ${tu.name}`);
            result = await tool.run(tu.input, ctx);
          }
        } catch (e) {
          result = { error: e instanceof Error ? e.message : String(e) };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result).slice(0, 250000),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    if (!finalText.trim()) {
      finalText =
        "(The agent finished without producing a written deliverable.)";
    }

    await supabaseAdmin.from("agent_outputs").insert({
      run_id: runId,
      deal_id: ctx.dealId,
      agent_type: def.id,
      output_type: def.outputType,
      title: def.outputTitle,
      content: finalText,
      status: "draft",
      sales_id: ctx.triggeredBy,
    });

    await supabaseAdmin
      .from("agent_runs")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        tokens_input: tokensIn,
        tokens_output: tokensOut,
      })
      .eq("id", runId);

    return { status: "succeeded", content: finalText };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await failRun(runId, message, tokensIn, tokensOut);
    return { status: "failed", content: finalText };
  }
}

async function failRun(
  runId: number,
  message: string,
  tokensIn = 0,
  tokensOut = 0,
): Promise<void> {
  await supabaseAdmin
    .from("agent_runs")
    .update({
      status: "failed",
      error: message.slice(0, 2000),
      finished_at: new Date().toISOString(),
      tokens_input: tokensIn,
      tokens_output: tokensOut,
    })
    .eq("id", runId);
}

async function handleDelegate(
  input: Record<string, unknown>,
  ctx: ToolContext,
  depth: number,
): Promise<unknown> {
  if (depth >= MAX_DEPTH) {
    return {
      error: "Delegation depth limit reached; cannot delegate further.",
    };
  }
  const agentType = String(input.agent_type ?? "");
  if (!AGENTS[agentType] || agentType === "orchestrator") {
    return { error: `Unknown specialist agent: '${agentType}'.` };
  }
  const instructions = input.instructions
    ? String(input.instructions)
    : undefined;

  try {
    const childId = await startAgentRun({
      agentType,
      dealId: ctx.dealId,
      triggeredBy: ctx.triggeredBy,
      instructions,
      parentRunId: ctx.runId,
    });
    const result = await executeAgentRun(childId, depth + 1);
    return {
      agent: agentType,
      run_id: childId,
      status: result.status,
      output: result.content,
    };
  } catch (e) {
    return {
      agent: agentType,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
