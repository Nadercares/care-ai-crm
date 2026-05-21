// Tools the agents may call to read and write claim data (Roadmap Stage 2).
// Each tool runs server-side with the service-role client. Agent-specific
// tools (PDF extraction, weather APIs, etc.) are added in later roadmap stages.
import { supabaseAdmin } from "../supabaseAdmin.ts";
import type { ToolSchema } from "./anthropic.ts";

export interface ToolContext {
  dealId: number;
  runId: number;
  triggeredBy: number | null;
}

export interface ToolDefinition {
  schema: ToolSchema;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

const getClaim: ToolDefinition = {
  schema: {
    name: "get_claim",
    description:
      "Get the full claim record: the claim/deal fields (claim number, date of loss, loss type, loss state and address, stage, amount), the company, and the linked contacts.",
    input_schema: { type: "object", properties: {} },
  },
  run: async (_input, ctx) => {
    const { data: deal, error } = await supabaseAdmin
      .from("deals")
      .select("*")
      .eq("id", ctx.dealId)
      .single();
    if (error || !deal) throw new Error(`Claim ${ctx.dealId} not found`);

    let company: unknown = null;
    if (deal.company_id) {
      company = (
        await supabaseAdmin
          .from("companies")
          .select("*")
          .eq("id", deal.company_id)
          .single()
      ).data;
    }

    let contacts: unknown[] = [];
    if (Array.isArray(deal.contact_ids) && deal.contact_ids.length) {
      contacts =
        (
          await supabaseAdmin
            .from("contacts")
            .select("*")
            .in("id", deal.contact_ids)
        ).data ?? [];
    }

    return { claim: deal, company, contacts };
  },
};

const getPolicy: ToolDefinition = {
  schema: {
    name: "get_policy",
    description:
      "Get the insurance policy/policies attached to this claim, including coverages, endorsements, exclusions, limits and deductibles. Returns an empty list if no policy has been entered yet.",
    input_schema: { type: "object", properties: {} },
  },
  run: async (_input, ctx) => {
    const { data } = await supabaseAdmin
      .from("policies")
      .select("*")
      .eq("deal_id", ctx.dealId);
    return { policies: data ?? [] };
  },
};

const getAgentOutputs: ToolDefinition = {
  schema: {
    name: "get_agent_outputs",
    description:
      "Get deliverables already produced by other agents for this claim (summaries, briefs, letters, reports). Use this to build on prior work instead of repeating it.",
    input_schema: {
      type: "object",
      properties: {
        agent_type: {
          type: "string",
          description:
            "Optional: only return outputs from this agent type (e.g. 'policy_review').",
        },
      },
    },
  },
  run: async (input, ctx) => {
    let query = supabaseAdmin
      .from("agent_outputs")
      .select("id, agent_type, output_type, title, content, status, created_at")
      .eq("deal_id", ctx.dealId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (typeof input.agent_type === "string") {
      query = query.eq("agent_type", input.agent_type);
    }
    const { data } = await query;
    return { outputs: data ?? [] };
  },
};

const createTask: ToolDefinition = {
  schema: {
    name: "create_task",
    description:
      "Create a follow-up task on this claim (for example a compliance deadline). The task is attached to the claim's primary contact.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "What needs to be done.",
        },
        type: {
          type: "string",
          description:
            "Optional task category, e.g. 'Compliance' or 'Follow-up'.",
        },
        due_in_days: {
          type: "number",
          description: "Optional: due this many days from today.",
        },
      },
      required: ["text"],
    },
  },
  run: async (input, ctx) => {
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!text) return { error: "A task 'text' is required." };

    const { data: deal } = await supabaseAdmin
      .from("deals")
      .select("contact_ids")
      .eq("id", ctx.dealId)
      .single();
    const contactId =
      Array.isArray(deal?.contact_ids) && deal.contact_ids.length
        ? deal.contact_ids[0]
        : null;
    if (!contactId) {
      return {
        error:
          "This claim has no linked contact, so a task cannot be created. Add a contact to the claim first.",
      };
    }

    let dueDate: string | null = null;
    if (typeof input.due_in_days === "number") {
      const d = new Date();
      d.setDate(d.getDate() + input.due_in_days);
      dueDate = d.toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from("tasks")
      .insert({
        contact_id: contactId,
        text,
        type: typeof input.type === "string" ? input.type : "Follow-up",
        due_date: dueDate,
        sales_id: ctx.triggeredBy,
      })
      .select("id")
      .single();
    if (error) return { error: `Could not create task: ${error.message}` };
    return { created: true, task_id: data?.id };
  },
};

export const TOOLS: Record<string, ToolDefinition> = {
  get_claim: getClaim,
  get_policy: getPolicy,
  get_agent_outputs: getAgentOutputs,
  create_task: createTask,
};
