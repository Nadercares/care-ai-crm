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
      "Get the insurance policy/policies attached to this claim: metadata plus the structured coverages, endorsements, exclusions, limits and deductibles entered so far. 'document_name' shows whether a policy file has been uploaded. Returns an empty list if no policy has been added yet.",
    input_schema: { type: "object", properties: {} },
  },
  run: async (_input, ctx) => {
    const { data } = await supabaseAdmin
      .from("policies")
      .select(
        "id, deal_id, carrier_id, policy_number, named_insured, policy_type, effective_date, expiration_date, coverages, endorsements, exclusions, limits, deductibles, document_name",
      )
      .eq("deal_id", ctx.dealId);
    return { policies: data ?? [] };
  },
};

const getPolicyDocument: ToolDefinition = {
  schema: {
    name: "get_policy_document",
    description:
      "Get the full extracted text of the uploaded policy document(s) for this claim. Use this to read the actual policy wording before interpreting coverages. If 'document_text' is null the file has not been uploaded or could not be read yet.",
    input_schema: { type: "object", properties: {} },
  },
  run: async (_input, ctx) => {
    const { data } = await supabaseAdmin
      .from("policies")
      .select("id, document_name, document_text")
      .eq("deal_id", ctx.dealId);
    return { documents: data ?? [] };
  },
};

const savePolicyDetails: ToolDefinition = {
  schema: {
    name: "save_policy_details",
    description:
      "Save the structured policy details you extracted back onto a policy record so the rest of the CRM can use them. Only include fields you are confident about.",
    input_schema: {
      type: "object",
      properties: {
        policy_id: {
          type: "number",
          description: "The id of the policy to update (from get_policy).",
        },
        policy_number: { type: "string" },
        named_insured: { type: "string" },
        policy_type: {
          type: "string",
          description: "e.g. 'HO-3', 'Commercial Property', 'Dwelling'.",
        },
        effective_date: {
          type: "string",
          description: "ISO date, YYYY-MM-DD.",
        },
        expiration_date: {
          type: "string",
          description: "ISO date, YYYY-MM-DD.",
        },
        coverages: {
          type: "object",
          description: "Map of coverage name to its description/details.",
        },
        endorsements: {
          type: "array",
          description: "List of endorsements on the policy.",
        },
        exclusions: {
          type: "array",
          description: "List of relevant exclusions.",
        },
        limits: {
          type: "object",
          description: "Map of coverage to its limit amount.",
        },
        deductibles: {
          type: "object",
          description: "Map of deductible type to amount.",
        },
      },
      required: ["policy_id"],
    },
  },
  run: async (input, ctx) => {
    const policyId = Number(input.policy_id);
    if (!Number.isInteger(policyId)) {
      return { error: "A valid 'policy_id' is required." };
    }
    const update: Record<string, unknown> = {};
    for (const key of [
      "policy_number",
      "named_insured",
      "policy_type",
      "effective_date",
      "expiration_date",
      "coverages",
      "endorsements",
      "exclusions",
      "limits",
      "deductibles",
    ]) {
      if (input[key] !== undefined && input[key] !== null) {
        update[key] = input[key];
      }
    }
    if (Object.keys(update).length === 0) {
      return { error: "No policy fields were provided to save." };
    }
    const { error } = await supabaseAdmin
      .from("policies")
      .update(update)
      .eq("id", policyId)
      .eq("deal_id", ctx.dealId);
    if (error) {
      return { error: `Could not save policy details: ${error.message}` };
    }
    return { saved: true, policy_id: policyId, fields: Object.keys(update) };
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
  get_policy_document: getPolicyDocument,
  save_policy_details: savePolicyDetails,
  get_agent_outputs: getAgentOutputs,
  create_task: createTask,
};
