import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { fetchAuditLog } from "@/api/audit";
import { canSeeFinancials, fetchCurrentUserRole } from "@/api/financials";

const ACTION_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  INSERT: "secondary",
  UPDATE: "outline",
  DELETE: "destructive",
};

export const AuditLogPage = () => {
  const roleQuery = useQuery({
    queryKey: ["user_role"],
    queryFn: fetchCurrentUserRole,
  });
  const allowed = roleQuery.data ? canSeeFinancials(roleQuery.data) : false;

  const auditQuery = useQuery({
    queryKey: ["audit_log"],
    queryFn: fetchAuditLog,
    enabled: allowed,
  });
  const entries = auditQuery.data ?? [];

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          A record of sensitive financial changes — who changed what, and when.
          Visible to owner and accounting roles only.
        </p>
      </header>

      {roleQuery.isLoading && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}

      {roleQuery.data && !allowed && (
        <p className="text-sm text-muted-foreground">
          The audit log is visible to owner and accounting roles only.
        </p>
      )}

      {allowed && auditQuery.isError && (
        <p className="text-sm text-destructive">
          Could not load the audit log. Apply the database migration first:{" "}
          <code>npx supabase db reset --local</code>.
        </p>
      )}

      {allowed && auditQuery.isLoading && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}

      {allowed && !auditQuery.isLoading && !auditQuery.isError && (
        <div className="border rounded-md divide-y">
          {entries.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              No audit entries yet.
            </div>
          )}
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
            >
              <span className="flex items-center gap-2 min-w-0">
                <Badge
                  variant={ACTION_VARIANT[entry.action] ?? "outline"}
                  className="text-[10px]"
                >
                  {entry.action}
                </Badge>
                <span className="truncate">
                  {entry.table_name}
                  {entry.record_id != null ? ` #${entry.record_id}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-3 shrink-0 text-muted-foreground">
                <span>{entry.actor_name}</span>
                <span>{new Date(entry.created_at).toLocaleString()}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

AuditLogPage.path = "/audit-log";
