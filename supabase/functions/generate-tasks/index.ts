// generate-tasks (Roadmap Stage 3)
// Turns active task templates into real tasks on open claims. Idempotent, so
// it is safe to run from the "Generate tasks now" button and from a daily cron.
//
// To run it automatically every morning, schedule it from the Supabase
// dashboard (Database -> Cron) or with pg_cron + pg_net. See CARE_ROADMAP.md
// Stage 3 for the exact steps.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware } from "../_shared/authentication.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

interface TemplateItem {
  id: number;
  template_id: number;
  title: string;
  description: string | null;
  assignee_role: string | null;
  offset_days: number;
}

interface Template {
  id: number;
  cadence: string;
  trigger_stage: string | null;
}

function startOfTodayISO(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

function dueDateISO(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + (offsetDays || 0));
  return d.toISOString();
}

async function alreadyGenerated(
  cadence: string,
  itemId: number,
  contactId: number,
): Promise<boolean> {
  let query = supabaseAdmin
    .from("tasks")
    .select("id")
    .eq("template_item_id", itemId)
    .eq("contact_id", contactId)
    .limit(1);

  if (cadence === "daily") {
    query = query.gte("created_at", startOfTodayISO());
  } else if (cadence === "weekly") {
    query = query.gte("created_at", daysAgoISO(7));
  }
  // per_claim_stage: any existing task for this item+contact counts.

  const { data } = await query;
  return !!data?.length;
}

async function generate(): Promise<{ created: number; skipped: number }> {
  const { data: templates } = await supabaseAdmin
    .from("task_templates")
    .select("id, cadence, trigger_stage")
    .eq("active", true);

  const { data: items } = await supabaseAdmin
    .from("task_template_items")
    .select("id, template_id, title, description, assignee_role, offset_days")
    .order("sort_order", { ascending: true });

  const { data: deals } = await supabaseAdmin
    .from("deals")
    .select("id, stage, contact_ids")
    .is("archived_at", null);

  const itemsByTemplate = new Map<number, TemplateItem[]>();
  for (const item of (items ?? []) as TemplateItem[]) {
    const list = itemsByTemplate.get(item.template_id) ?? [];
    list.push(item);
    itemsByTemplate.set(item.template_id, list);
  }

  let created = 0;
  let skipped = 0;

  for (const tpl of (templates ?? []) as Template[]) {
    const tplItems = itemsByTemplate.get(tpl.id) ?? [];
    if (!tplItems.length) continue;

    for (const deal of deals ?? []) {
      const contactId =
        Array.isArray(deal.contact_ids) && deal.contact_ids.length
          ? deal.contact_ids[0]
          : null;
      if (!contactId) continue;

      // per_claim_stage templates only apply to claims currently in the
      // template's trigger stage; daily/weekly apply to every open claim.
      if (tpl.cadence === "per_claim_stage") {
        if (!tpl.trigger_stage || deal.stage !== tpl.trigger_stage) continue;
      }

      for (const item of tplItems) {
        if (await alreadyGenerated(tpl.cadence, item.id, contactId)) {
          skipped++;
          continue;
        }

        const rolePrefix = item.assignee_role ? `[${item.assignee_role}] ` : "";
        const text =
          rolePrefix +
          item.title +
          (item.description ? `\n${item.description}` : "");

        const { error } = await supabaseAdmin.from("tasks").insert({
          contact_id: contactId,
          text,
          type: "Follow-up",
          due_date: dueDateISO(item.offset_days),
          template_item_id: item.id,
        });
        if (error) {
          console.error("generate-tasks insert failed:", error.message);
        } else {
          created++;
        }
      }
    }
  }

  return { created, skipped };
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return createErrorResponse(405, "Method Not Allowed");
  }
  const result = await generate();
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve((req: Request) =>
  OptionsMiddleware(req, (req) =>
    AuthMiddleware(req, async (req) => {
      try {
        return await handle(req);
      } catch (e) {
        console.error("generate-tasks error:", e);
        return createErrorResponse(500, "Internal Server Error");
      }
    }),
  ),
);
