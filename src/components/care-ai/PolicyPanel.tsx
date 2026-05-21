import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNotify } from "ra-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  deletePolicy,
  fetchPolicies,
  getPolicyFileUrl,
  reextractPolicy,
  uploadPolicy,
  type Policy,
} from "@/api/policies";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Insurance policy panel on the claim screen. Upload the policy PDF; the
 * Policy Review agent extracts coverages and writes a client summary.
 */
export function PolicyPanel({ dealId }: { dealId: number }) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [policyNumber, setPolicyNumber] = useState("");

  const policiesQuery = useQuery({
    queryKey: ["policies", dealId],
    queryFn: () => fetchPolicies(dealId),
  });
  const policies = policiesQuery.data ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["policies", dealId] });

  const upload = useMutation({
    mutationFn: () => uploadPolicy(dealId, file as File, policyNumber),
    onSuccess: (result) => {
      notify(result.message, { type: result.extracted ? "info" : "warning" });
      setFile(null);
      setPolicyNumber("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      invalidate();
    },
    onError: (e) =>
      notify(e instanceof Error ? e.message : String(e), { type: "error" }),
  });

  const remove = useMutation({
    mutationFn: deletePolicy,
    onSuccess: () => {
      notify("Policy removed.", { type: "info" });
      invalidate();
    },
    onError: (e) =>
      notify(e instanceof Error ? e.message : String(e), { type: "error" }),
  });

  const reextract = useMutation({
    mutationFn: reextractPolicy,
    onSuccess: () => {
      notify("Policy text extracted.", { type: "info" });
      invalidate();
    },
    onError: (e) =>
      notify(e instanceof Error ? e.message : String(e), { type: "error" }),
  });

  const openFile = async (path: string) => {
    try {
      const url = await getPolicyFileUrl(path);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), { type: "error" });
    }
  };

  return (
    <div className="m-4">
      <Separator className="mb-4" />
      <h3 className="text-sm font-semibold">Insurance Policy</h3>
      <p className="text-xs text-muted-foreground">
        Upload the policy PDF. The Policy Review agent reads it to interpret
        coverages and write a plain-language client summary.
      </p>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-xs max-w-[220px]"
        />
        <Input
          className="h-8 w-48 text-xs"
          placeholder="Policy number (optional)"
          value={policyNumber}
          onChange={(e) => setPolicyNumber(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!file || upload.isPending}
          onClick={() => upload.mutate()}
        >
          {upload.isPending ? "Uploading…" : "Upload policy"}
        </Button>
      </div>

      {policiesQuery.isError && (
        <p className="text-xs text-destructive mt-2">
          Could not load policies. Apply the database migration first:{" "}
          <code>npx supabase db reset --local</code>.
        </p>
      )}

      {policiesQuery.isLoading && (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      )}

      {!policiesQuery.isLoading &&
        !policiesQuery.isError &&
        policies.length === 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            No policy uploaded yet.
          </p>
        )}

      <div className="space-y-2 mt-3">
        {policies.map((policy) => (
          <PolicyRow
            key={policy.id}
            policy={policy}
            onOpen={openFile}
            onDelete={() => {
              if (window.confirm("Remove this policy and its file?")) {
                remove.mutate(policy);
              }
            }}
            onReextract={() => reextract.mutate(policy.id)}
            reextracting={reextract.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function PolicyRow({
  policy,
  onOpen,
  onDelete,
  onReextract,
  reextracting,
}: {
  policy: Policy;
  onOpen: (path: string) => void;
  onDelete: () => void;
  onReextract: () => void;
  reextracting: boolean;
}) {
  const coverageKeys = Object.keys(policy.coverages ?? {});
  const limits = Object.entries(policy.limits ?? {});
  const deductibles = Object.entries(policy.deductibles ?? {});

  return (
    <div className="border rounded-md p-3 text-xs space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm">
            {policy.policy_number ? `Policy ${policy.policy_number}` : "Policy"}
            {policy.policy_type ? ` · ${policy.policy_type}` : ""}
          </div>
          {policy.named_insured && (
            <div className="text-muted-foreground">
              Insured: {policy.named_insured}
            </div>
          )}
          {(policy.effective_date || policy.expiration_date) && (
            <div className="text-muted-foreground">
              Term: {policy.effective_date ?? "?"} →{" "}
              {policy.expiration_date ?? "?"}
            </div>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0">
          {policy.document_path && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => onOpen(policy.document_path as string)}
            >
              View PDF
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {policy.document_name && (
          <Badge variant="outline">{policy.document_name}</Badge>
        )}
        <Badge variant={policy.has_text ? "secondary" : "outline"}>
          {policy.has_text ? "Text extracted" : "No text yet"}
        </Badge>
        {coverageKeys.length > 0 && (
          <Badge variant="secondary">{coverageKeys.length} coverage(s)</Badge>
        )}
      </div>

      {!policy.has_text && policy.document_path && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={onReextract}
          disabled={reextracting}
        >
          {reextracting ? "Extracting…" : "Retry text extraction"}
        </Button>
      )}

      {(limits.length > 0 || deductibles.length > 0) && (
        <div className="border-t pt-2 space-y-1">
          {limits.length > 0 && (
            <div>
              <span className="text-muted-foreground">Limits: </span>
              {limits.map(([k, v]) => `${k}: ${formatValue(v)}`).join(" · ")}
            </div>
          )}
          {deductibles.length > 0 && (
            <div>
              <span className="text-muted-foreground">Deductibles: </span>
              {deductibles
                .map(([k, v]) => `${k}: ${formatValue(v)}`)
                .join(" · ")}
            </div>
          )}
        </div>
      )}

      {coverageKeys.length > 0 && (
        <div className="border-t pt-2">
          <span className="text-muted-foreground">Coverages: </span>
          {coverageKeys.join(", ")}
        </div>
      )}
    </div>
  );
}
