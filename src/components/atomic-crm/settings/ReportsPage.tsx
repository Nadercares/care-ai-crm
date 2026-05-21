import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNotify } from "ra-core";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  REPORT_TYPES,
  fetchReportRuns,
  fetchReports,
  runReport,
  type ReportRun,
} from "@/api/reports";

const isActive = (status: string) =>
  status === "running" || status === "queued";

export const ReportsPage = () => {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [reportType, setReportType] = useState(REPORT_TYPES[0].value);
  const [expanded, setExpanded] = useState<number | null>(null);

  const runsQuery = useQuery({
    queryKey: ["report_runs"],
    queryFn: fetchReportRuns,
    refetchInterval: (query) =>
      (query.state.data as ReportRun[] | undefined)?.some((r) =>
        isActive(r.status),
      )
        ? 4000
        : false,
  });
  const busy = (runsQuery.data ?? []).some((r) => isActive(r.status));

  const reportsQuery = useQuery({
    queryKey: ["reports"],
    queryFn: fetchReports,
    refetchInterval: () => (busy ? 4000 : false),
  });
  const reports = reportsQuery.data ?? [];

  const generate = useMutation({
    mutationFn: () => {
      const type = REPORT_TYPES.find((r) => r.value === reportType);
      if (!type) throw new Error("Unknown report type");
      return runReport(type);
    },
    onSuccess: () => {
      notify("Report generation started — it will appear below shortly.", {
        type: "info",
      });
      queryClient.invalidateQueries({ queryKey: ["report_runs"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
    onError: (e) =>
      notify(e instanceof Error ? e.message : String(e), { type: "error" }),
  });

  const selected = REPORT_TYPES.find((r) => r.value === reportType);
  const tablesMissing = runsQuery.isError || reportsQuery.isError;

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate firm-wide reports with the Data &amp; Reporting agent.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Report type</Label>
          <Select value={reportType} onValueChange={setReportType}>
            <SelectTrigger className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORT_TYPES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={() => generate.mutate()}
          disabled={generate.isPending || busy || tablesMissing}
        >
          {generate.isPending
            ? "Starting…"
            : busy
              ? "Generating…"
              : "Generate report"}
        </Button>
      </div>
      {selected && (
        <p className="text-xs text-muted-foreground">{selected.description}</p>
      )}

      {tablesMissing && (
        <p className="text-sm text-destructive">
          Could not load reports. Apply the database migration first:{" "}
          <code>npx supabase db reset --local</code>.
        </p>
      )}

      {(runsQuery.data ?? []).some((r) => r.status === "failed") && (
        <p className="text-xs text-destructive">
          A report run failed. The most common cause is a missing
          ANTHROPIC_API_KEY secret on the server.
        </p>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Generated reports</h2>
        {reportsQuery.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        {!reportsQuery.isLoading && reports.length === 0 && !tablesMissing && (
          <p className="text-sm text-muted-foreground">
            No reports yet. Choose a type and generate one.
          </p>
        )}
        {reports.map((report) => (
          <div key={report.id} className="border rounded-md">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 p-2.5 text-left"
              onClick={() =>
                setExpanded(expanded === report.id ? null : report.id)
              }
            >
              <span className="text-sm font-medium truncate">
                {report.title ?? "Report"}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-muted-foreground">
                  {new Date(report.created_at).toLocaleString()}
                </span>
                <Badge
                  variant={report.status === "approved" ? "default" : "outline"}
                  className="text-[10px]"
                >
                  {report.status}
                </Badge>
              </span>
            </button>
            {expanded === report.id && (
              <div className="border-t px-3 py-2 text-xs whitespace-pre-wrap leading-5">
                {report.content}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

ReportsPage.path = "/reports";
