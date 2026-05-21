import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

export type Cadence = "daily" | "weekly" | "per_claim_stage";

export interface TaskTemplateItem {
  id?: number;
  title: string;
  description: string | null;
  assignee_role: string | null;
  offset_days: number;
}

export interface TaskTemplate {
  id: number;
  name: string;
  description: string | null;
  cadence: Cadence;
  trigger_stage: string | null;
  active: boolean;
  items: TaskTemplateItem[];
}

export interface TaskTemplateInput {
  id?: number;
  name: string;
  description: string | null;
  cadence: Cadence;
  trigger_stage: string | null;
  active: boolean;
}

export async function fetchTaskTemplates(): Promise<TaskTemplate[]> {
  const supabase = getSupabaseClient();

  const { data: templates, error: templatesError } = await supabase
    .from("task_templates")
    .select("id, name, description, cadence, trigger_stage, active")
    .order("name", { ascending: true });
  if (templatesError) throw new Error(templatesError.message);

  const { data: items, error: itemsError } = await supabase
    .from("task_template_items")
    .select("id, template_id, title, description, assignee_role, offset_days")
    .order("sort_order", { ascending: true });
  if (itemsError) throw new Error(itemsError.message);

  const itemsByTemplate = new Map<number, TaskTemplateItem[]>();
  for (const item of items ?? []) {
    const list = itemsByTemplate.get(item.template_id) ?? [];
    list.push({
      id: item.id,
      title: item.title,
      description: item.description,
      assignee_role: item.assignee_role,
      offset_days: item.offset_days,
    });
    itemsByTemplate.set(item.template_id, list);
  }

  return (templates ?? []).map((t) => ({
    ...t,
    items: itemsByTemplate.get(t.id) ?? [],
  })) as TaskTemplate[];
}

/** Creates or updates a template and reconciles its task items. */
export async function saveTaskTemplate(
  input: TaskTemplateInput,
  items: TaskTemplateItem[],
): Promise<number> {
  const supabase = getSupabaseClient();
  const fields = {
    name: input.name,
    description: input.description,
    cadence: input.cadence,
    trigger_stage:
      input.cadence === "per_claim_stage" ? input.trigger_stage : null,
    active: input.active,
  };

  let templateId = input.id;
  if (templateId) {
    const { error } = await supabase
      .from("task_templates")
      .update(fields)
      .eq("id", templateId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase
      .from("task_templates")
      .insert(fields)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    templateId = data.id as number;
  }

  // Reconcile items: delete removed, update kept, insert new — preserving ids.
  const { data: existing } = await supabase
    .from("task_template_items")
    .select("id")
    .eq("template_id", templateId);
  const keptIds = items.filter((i) => i.id).map((i) => i.id);
  const toDelete = (existing ?? [])
    .map((e) => e.id as number)
    .filter((id) => !keptIds.includes(id));
  if (toDelete.length) {
    const { error } = await supabase
      .from("task_template_items")
      .delete()
      .in("id", toDelete);
    if (error) throw new Error(error.message);
  }

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const row = {
      template_id: templateId,
      title: item.title,
      description: item.description,
      assignee_role: item.assignee_role,
      offset_days: item.offset_days,
      sort_order: index,
    };
    const { error } = item.id
      ? await supabase.from("task_template_items").update(row).eq("id", item.id)
      : await supabase.from("task_template_items").insert(row);
    if (error) throw new Error(error.message);
  }

  return templateId;
}

export async function deleteTaskTemplate(id: number): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("task_templates")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function generateTasksNow(): Promise<{
  created: number;
  skipped: number;
}> {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("You must be signed in.");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-tasks`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    },
  );
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.message ?? `Request failed (${res.status})`);
  }
  return json as { created: number; skipped: number };
}
