import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

export interface AuditEntry {
  id: number;
  created_at: string;
  table_name: string;
  record_id: number | null;
  action: string;
  actor_name: string;
}

/** Fetches recent audit entries, with the actor's name resolved. */
export async function fetchAuditLog(): Promise<AuditEntry[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("audit_log")
    .select("id, created_at, table_name, record_id, action, actor_sales_id")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const actorIds = [
    ...new Set(
      rows.map((r) => r.actor_sales_id).filter((x): x is number => x != null),
    ),
  ];
  const names = new Map<number, string>();
  if (actorIds.length) {
    const { data: sales } = await supabase
      .from("sales")
      .select("id, first_name, last_name")
      .in("id", actorIds);
    for (const s of sales ?? []) {
      names.set(
        s.id,
        `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || `User ${s.id}`,
      );
    }
  }

  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    table_name: r.table_name,
    record_id: r.record_id,
    action: r.action,
    actor_name:
      r.actor_sales_id != null
        ? (names.get(r.actor_sales_id) ?? `User ${r.actor_sales_id}`)
        : "—",
  }));
}
