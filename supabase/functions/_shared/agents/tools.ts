// Tools the agents may call to read and write claim data (Roadmap Stage 2).
// Each tool runs server-side with the service-role client. Agent-specific
// tools (PDF extraction, weather APIs, etc.) are added in later roadmap stages.
import { supabaseAdmin } from "../supabaseAdmin.ts";
import type { ToolSchema } from "./anthropic.ts";
import {
  buildMapUrl,
  fetchHistoricalWeather,
  geocodeLocation,
} from "./weather.ts";

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

const getStateCompliance: ToolDefinition = {
  schema: {
    name: "get_state_compliance",
    description:
      "Get the firm's compliance reference for the state where this claim's loss occurred: public-adjuster licensing, fee rules, contract rules, claim-handling deadlines, required disclosures, statute of limitations, and dispute options. Returns configured:false if no reference has been entered for that state yet.",
    input_schema: { type: "object", properties: {} },
  },
  run: async (_input, ctx) => {
    const { data: deal } = await supabaseAdmin
      .from("deals")
      .select("loss_state")
      .eq("id", ctx.dealId)
      .single();
    const raw = (deal?.loss_state ?? "").trim();
    if (!raw) {
      return {
        error:
          "This claim has no loss state set. Set the claim's loss state before running a compliance review.",
      };
    }
    let { data } = await supabaseAdmin
      .from("state_compliance_rules")
      .select("*")
      .ilike("state_abbr", raw)
      .limit(1);
    if (!data?.length) {
      ({ data } = await supabaseAdmin
        .from("state_compliance_rules")
        .select("*")
        .ilike("state_name", `%${raw}%`)
        .limit(1));
    }
    if (!data?.length) {
      return {
        state: raw,
        configured: false,
        message: `No compliance reference is on file for "${raw}". Give general guidance and recommend the firm add a verified reference for this state.`,
      };
    }
    return { state: raw, configured: true, rules: data[0] };
  },
};

const getDocumentTemplates: ToolDefinition = {
  schema: {
    name: "get_document_templates",
    description:
      "List the firm's document templates (letters and forms). Each has a name, description, category, the template body containing {{placeholder}} tokens, and the list of placeholders to fill.",
    input_schema: { type: "object", properties: {} },
  },
  run: async () => {
    const { data } = await supabaseAdmin
      .from("document_templates")
      .select("id, name, description, category, body, placeholders")
      .order("name", { ascending: true });
    return { templates: data ?? [] };
  },
};

const getClaimEmails: ToolDefinition = {
  schema: {
    name: "get_claim_emails",
    description:
      "Get the emails logged on this claim (inbound and outbound), most recent first. Use this to read correspondence and draft replies.",
    input_schema: { type: "object", properties: {} },
  },
  run: async (_input, ctx) => {
    const { data } = await supabaseAdmin
      .from("claim_emails")
      .select(
        "id, direction, from_email, from_name, to_email, subject, body, received_at",
      )
      .eq("deal_id", ctx.dealId)
      .order("received_at", { ascending: false })
      .limit(30);
    return { emails: data ?? [] };
  },
};

const getWeatherData: ToolDefinition = {
  schema: {
    name: "get_weather_data",
    description:
      "Get historical weather for the claim's loss location and date of loss: daily high/low temperature, precipitation, rain, snowfall, and maximum wind speed and gusts for a three-day window around the loss. Also returns a property location map URL when mapping is configured. Use this for weather-related claims.",
    input_schema: { type: "object", properties: {} },
  },
  run: async (_input, ctx) => {
    const { data: deal } = await supabaseAdmin
      .from("deals")
      .select("loss_address, loss_zipcode, loss_state, date_of_loss, loss_type")
      .eq("id", ctx.dealId)
      .single();
    if (!deal) return { error: "Claim not found." };
    if (!deal.date_of_loss) {
      return {
        error:
          "This claim has no date of loss set. Set the date of loss before running weather research.",
      };
    }

    const geo = await geocodeLocation({
      address: deal.loss_address,
      zip: deal.loss_zipcode,
      state: deal.loss_state,
    });
    if (!geo) {
      return {
        error:
          "Could not determine the property's location. Add a loss address or ZIP code to the claim.",
      };
    }

    let weather: unknown;
    try {
      weather = await fetchHistoricalWeather(
        geo.lat,
        geo.lon,
        deal.date_of_loss,
      );
    } catch (e) {
      return {
        location: geo,
        date_of_loss: deal.date_of_loss,
        loss_type: deal.loss_type,
        error: `Weather data is unavailable: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }

    return {
      location: geo,
      date_of_loss: deal.date_of_loss,
      loss_type: deal.loss_type,
      weather,
      map_url: buildMapUrl(geo.lat, geo.lon),
    };
  },
};

const getCarrierIntelligence: ToolDefinition = {
  schema: {
    name: "get_carrier_intelligence",
    description:
      "Get what the firm knows about this claim's insurance carrier: the carrier record and notes (known patterns and practices), the carrier's adjusters (names, license numbers, contact info), and recent correspondence logged across all of the firm's claims with this carrier. Use this to identify how the carrier tends to handle claims.",
    input_schema: { type: "object", properties: {} },
  },
  run: async (_input, ctx) => {
    const { data: deal } = await supabaseAdmin
      .from("deals")
      .select("primary_carrier_id")
      .eq("id", ctx.dealId)
      .single();
    const carrierId = deal?.primary_carrier_id;
    if (!carrierId) {
      return {
        configured: false,
        message:
          "This claim has no carrier set. Set the claim's carrier in the Carrier panel on the claim screen to analyze carrier patterns.",
      };
    }

    const { data: carrier } = await supabaseAdmin
      .from("carriers")
      .select("id, name, naic_code, phone, email, claims_portal_url, notes")
      .eq("id", carrierId)
      .single();
    const { data: adjusters } = await supabaseAdmin
      .from("carrier_adjusters")
      .select(
        "first_name, last_name, license_number, license_state, adjuster_type, phone, email, notes",
      )
      .eq("carrier_id", carrierId);
    const { data: carrierDeals } = await supabaseAdmin
      .from("deals")
      .select("id")
      .eq("primary_carrier_id", carrierId);

    const dealIds = (carrierDeals ?? []).map((d) => d.id);
    let correspondence: unknown[] = [];
    if (dealIds.length) {
      const { data } = await supabaseAdmin
        .from("claim_emails")
        .select(
          "deal_id, direction, from_name, from_email, subject, body, received_at",
        )
        .in("deal_id", dealIds)
        .order("received_at", { ascending: false })
        .limit(40);
      correspondence = data ?? [];
    }

    return {
      configured: true,
      carrier,
      adjusters: adjusters ?? [],
      claims_with_carrier: dealIds.length,
      correspondence,
    };
  },
};

export const TOOLS: Record<string, ToolDefinition> = {
  get_claim: getClaim,
  get_policy: getPolicy,
  get_policy_document: getPolicyDocument,
  save_policy_details: savePolicyDetails,
  get_state_compliance: getStateCompliance,
  get_document_templates: getDocumentTemplates,
  get_claim_emails: getClaimEmails,
  get_weather_data: getWeatherData,
  get_carrier_intelligence: getCarrierIntelligence,
  get_agent_outputs: getAgentOutputs,
  create_task: createTask,
};
