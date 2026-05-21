import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

export interface DocumentTemplate {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  body: string | null;
  placeholders: string[];
}

export interface DocumentTemplateInput {
  id?: number;
  name: string;
  description: string | null;
  category: string | null;
  body: string;
}

/** Finds the unique {{placeholder}} tokens used in a template body. */
export function extractPlaceholders(body: string): string[] {
  const tokens = new Set<string>();
  for (const match of body.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) {
    tokens.add(match[1]);
  }
  return [...tokens];
}

export async function fetchDocumentTemplates(): Promise<DocumentTemplate[]> {
  const { data, error } = await getSupabaseClient()
    .from("document_templates")
    .select("id, name, description, category, body, placeholders")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => ({
    ...t,
    placeholders: Array.isArray(t.placeholders) ? t.placeholders : [],
  })) as DocumentTemplate[];
}

export async function saveDocumentTemplate(
  input: DocumentTemplateInput,
): Promise<void> {
  const supabase = getSupabaseClient();
  const row = {
    name: input.name,
    description: input.description,
    category: input.category,
    body: input.body,
    placeholders: extractPlaceholders(input.body),
  };
  const { error } = input.id
    ? await supabase.from("document_templates").update(row).eq("id", input.id)
    : await supabase.from("document_templates").insert(row);
  if (error) throw new Error(error.message);
}

export async function deleteDocumentTemplate(id: number): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("document_templates")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}
