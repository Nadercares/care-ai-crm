import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNotify } from "ra-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchStateRules,
  saveStateRule,
  type StateRule,
} from "@/api/stateCompliance";

const TEXT_FIELDS = [
  ["fee_rules", "Fee rules / caps"],
  ["contract_rules", "Contract requirements"],
  ["claim_deadlines", "Claim-handling deadlines"],
  ["required_disclosures", "Required policyholder disclosures"],
  ["statute_of_limitations", "Statute of limitations"],
  ["dispute_options", "Dispute options (appraisal / mediation)"],
  ["notes", "Other notes"],
] as const;

type TextFieldKey = (typeof TEXT_FIELDS)[number][0];

function isConfigured(rule: StateRule): boolean {
  return (
    rule.pa_license_required !== null ||
    TEXT_FIELDS.some(([key]) => !!rule[key]?.trim())
  );
}

export const StateCompliancePage = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<StateRule | null>(null);

  const {
    data: rules = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["state_compliance_rules"],
    queryFn: fetchStateRules,
  });

  const term = search.trim().toLowerCase();
  const filtered = rules.filter(
    (r) =>
      !term ||
      r.state_name.toLowerCase().includes(term) ||
      r.state_abbr.toLowerCase().includes(term),
  );

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">State Compliance</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Maintain the firm's per-state compliance reference. The State
          Compliance agent reads the row for each claim's loss state. Enter
          verified, current information — this reference is informational, not
          legal advice.
        </p>
      </header>

      <Input
        placeholder="Search states…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />

      {isLoading && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}

      {isError && (
        <p className="text-sm text-destructive">
          Could not load states. Apply the database migration first:{" "}
          <code>npx supabase db reset --local</code>.
        </p>
      )}

      {!isLoading && !isError && (
        <div className="border rounded-md divide-y">
          {filtered.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium">{rule.state_name}</span>
                <span className="text-xs text-muted-foreground">
                  {rule.state_abbr}
                </span>
                {isConfigured(rule) ? (
                  <Badge variant="secondary">Configured</Badge>
                ) : (
                  <Badge variant="outline">Not set</Badge>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(rule)}
              >
                Edit
              </Button>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              No states match "{search}".
            </div>
          )}
        </div>
      )}

      {editing && (
        <StateEditorDialog
          key={editing.id}
          rule={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            queryClient.invalidateQueries({
              queryKey: ["state_compliance_rules"],
            });
          }}
        />
      )}
    </div>
  );
};

StateCompliancePage.path = "/state-compliance";

function StateEditorDialog({
  rule,
  onClose,
  onSaved,
}: {
  rule: StateRule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useNotify();
  const [draft, setDraft] = useState<StateRule>(rule);

  const save = useMutation({
    mutationFn: () => saveStateRule(draft),
    onSuccess: () => {
      notify("Compliance reference saved.", { type: "info" });
      onSaved();
    },
    onError: (e) =>
      notify(e instanceof Error ? e.message : String(e), { type: "error" }),
  });

  const licenseValue =
    draft.pa_license_required === null
      ? "unknown"
      : draft.pa_license_required
        ? "yes"
        : "no";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {rule.state_name} ({rule.state_abbr}) — compliance reference
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Enter verified, current information. This reference is informational
          only, not legal advice.
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Public adjuster license required?</Label>
            <Select
              value={licenseValue}
              onValueChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  pa_license_required: v === "unknown" ? null : v === "yes",
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">Not specified</SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {TEXT_FIELDS.map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <Label>{label}</Label>
              <Textarea
                rows={2}
                value={draft[key as TextFieldKey] ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    [key]: e.target.value || null,
                  }))
                }
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
