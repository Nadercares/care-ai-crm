import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNotify } from "ra-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  deleteTaskTemplate,
  fetchTaskTemplates,
  generateTasksNow,
  saveTaskTemplate,
  type Cadence,
  type TaskTemplate,
  type TaskTemplateItem,
} from "@/api/taskTemplates";
import { useConfigurationContext } from "../root/ConfigurationContext";

const ROLE_OPTIONS = ["owner", "admin", "adjuster", "accounting", "viewer"];

const CADENCE_LABELS: Record<Cadence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  per_claim_stage: "Per claim stage",
};

type DealStage = { value: string; label: string };

export const TaskTemplatesPage = () => {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { dealStages } = useConfigurationContext();
  const [editing, setEditing] = useState<TaskTemplate | "new" | null>(null);

  const {
    data: templates = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["task_templates"],
    queryFn: fetchTaskTemplates,
  });

  const generateMutation = useMutation({
    mutationFn: generateTasksNow,
    onSuccess: (result) =>
      notify(
        `Generated ${result.created} task(s). ${result.skipped} already existed.`,
        { type: "info" },
      ),
    onError: (e) =>
      notify(e instanceof Error ? e.message : String(e), { type: "error" }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTaskTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task_templates"] });
      notify("Template deleted.", { type: "info" });
    },
    onError: (e) =>
      notify(e instanceof Error ? e.message : String(e), { type: "error" }),
  });

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Task Templates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define reusable checklists. The system turns them into tasks
            automatically — when a claim enters a stage, or daily/weekly on
            every open claim.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? "Generating…" : "Generate tasks now"}
          </Button>
          <Button onClick={() => setEditing("new")}>New template</Button>
        </div>
      </header>

      {isLoading && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}

      {isError && (
        <p className="text-sm text-destructive">
          Could not load templates. Apply the database migration first:{" "}
          <code>npx supabase db reset --local</code>.
        </p>
      )}

      {!isLoading && !isError && templates.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No task templates yet. Create one to get started.
          </CardContent>
        </Card>
      )}

      {templates.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          dealStages={dealStages}
          onEdit={() => setEditing(template)}
          onDelete={() => {
            if (window.confirm(`Delete the template "${template.name}"?`)) {
              deleteMutation.mutate(template.id);
            }
          }}
        />
      ))}

      {editing && (
        <TemplateEditorDialog
          key={editing === "new" ? "new" : editing.id}
          template={editing === "new" ? null : editing}
          dealStages={dealStages}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ["task_templates"] });
          }}
        />
      )}
    </div>
  );
};

TaskTemplatesPage.path = "/task-templates";

function TemplateCard({
  template,
  dealStages,
  onEdit,
  onDelete,
}: {
  template: TaskTemplate;
  dealStages: DealStage[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const stageLabel =
    dealStages.find((s) => s.value === template.trigger_stage)?.label ??
    template.trigger_stage;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">{template.name}</CardTitle>
          {template.description && (
            <CardDescription>{template.description}</CardDescription>
          )}
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Badge variant="secondary">
              {CADENCE_LABELS[template.cadence]}
            </Badge>
            {template.cadence === "per_claim_stage" &&
              template.trigger_stage && (
                <Badge variant="outline">Stage: {stageLabel}</Badge>
              )}
            <Badge variant={template.active ? "secondary" : "outline"}>
              {template.active ? "Active" : "Inactive"}
            </Badge>
            <Badge variant="outline">{template.items.length} task(s)</Badge>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </CardHeader>
      {template.items.length > 0 && (
        <CardContent>
          <ul className="text-sm space-y-1">
            {template.items.map((item, index) => (
              <li key={item.id ?? index} className="flex gap-2">
                <span className="text-muted-foreground">{index + 1}.</span>
                <span>
                  {item.title}
                  {item.assignee_role ? ` — ${item.assignee_role}` : ""}
                  {item.offset_days ? ` (due +${item.offset_days}d)` : ""}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function TemplateEditorDialog({
  template,
  dealStages,
  onClose,
  onSaved,
}: {
  template: TaskTemplate | null;
  dealStages: DealStage[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useNotify();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [cadence, setCadence] = useState<Cadence>(
    template?.cadence ?? "per_claim_stage",
  );
  const [triggerStage, setTriggerStage] = useState(
    template?.trigger_stage ?? dealStages[0]?.value ?? "",
  );
  const [active, setActive] = useState(template?.active ?? true);
  const [items, setItems] = useState<TaskTemplateItem[]>(template?.items ?? []);

  const save = useMutation({
    mutationFn: () =>
      saveTaskTemplate(
        {
          id: template?.id,
          name: name.trim(),
          description: description.trim() || null,
          cadence,
          trigger_stage: triggerStage || null,
          active,
        },
        items,
      ),
    onSuccess: () => {
      notify("Template saved.", { type: "info" });
      onSaved();
    },
    onError: (e) =>
      notify(e instanceof Error ? e.message : String(e), { type: "error" }),
  });

  const updateItem = (index: number, patch: Partial<TaskTemplateItem>) =>
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  const addItem = () =>
    setItems((prev) => [
      ...prev,
      { title: "", description: null, assignee_role: null, offset_days: 0 },
    ]);
  const removeItem = (index: number) =>
    setItems((prev) => prev.filter((_, i) => i !== index));

  const canSave =
    name.trim().length > 0 &&
    items.length > 0 &&
    items.every((item) => item.title.trim().length > 0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {template ? "Edit template" : "New task template"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Name</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. New Claim Intake"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-desc">Description</Label>
            <Textarea
              id="tpl-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this checklist is for (optional)"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>When to generate</Label>
              <Select
                value={cadence}
                onValueChange={(v) => setCadence(v as Cadence)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_claim_stage">
                    When a claim enters a stage
                  </SelectItem>
                  <SelectItem value="daily">
                    Daily — on every open claim
                  </SelectItem>
                  <SelectItem value="weekly">
                    Weekly — on every open claim
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {cadence === "per_claim_stage" && (
              <div className="space-y-1.5">
                <Label>Trigger stage</Label>
                <Select value={triggerStage} onValueChange={setTriggerStage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dealStages.map((stage) => (
                      <SelectItem key={stage.value} value={stage.value}>
                        {stage.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="tpl-active"
              checked={active}
              onCheckedChange={setActive}
            />
            <Label htmlFor="tpl-active">Active</Label>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <Label>Tasks in this template</Label>
            <Button size="sm" variant="outline" onClick={addItem}>
              Add task
            </Button>
          </div>

          {items.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Add at least one task.
            </p>
          )}

          {items.map((item, index) => (
            <div key={index} className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Task {index + 1}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeItem(index)}
                >
                  Remove
                </Button>
              </div>
              <Input
                placeholder="Task title"
                value={item.title}
                onChange={(e) => updateItem(index, { title: e.target.value })}
              />
              <Textarea
                placeholder="Details (optional)"
                rows={2}
                value={item.description ?? ""}
                onChange={(e) =>
                  updateItem(index, {
                    description: e.target.value || null,
                  })
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Assignee role</Label>
                  <Select
                    value={item.assignee_role ?? "none"}
                    onValueChange={(v) =>
                      updateItem(index, {
                        assignee_role: v === "none" ? null : v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {ROLE_OPTIONS.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Due (days after trigger)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={item.offset_days}
                    onChange={(e) =>
                      updateItem(index, {
                        offset_days: Number(e.target.value) || 0,
                      })
                    }
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!canSave || save.isPending}
          >
            {save.isPending ? "Saving…" : "Save template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
