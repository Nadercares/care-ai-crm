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
  deleteDocumentTemplate,
  extractPlaceholders,
  fetchDocumentTemplates,
  saveDocumentTemplate,
  type DocumentTemplate,
} from "@/api/documentTemplates";

export const DocumentTemplatesPage = () => {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<DocumentTemplate | "new" | null>(null);

  const {
    data: templates = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["document_templates"],
    queryFn: fetchDocumentTemplates,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDocumentTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document_templates"] });
      notify("Template deleted.", { type: "info" });
    },
    onError: (e) =>
      notify(e instanceof Error ? e.message : String(e), { type: "error" }),
  });

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Document Templates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reusable letters and forms. Mark a fill-in field with a{" "}
            <code>{"{{token}}"}</code>. The Documents &amp; Email agent fills
            them with claim data.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>New template</Button>
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
            No document templates yet. Create one to get started.
          </CardContent>
        </Card>
      )}

      {templates.map((template) => (
        <Card key={template.id}>
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
            <div className="min-w-0">
              <CardTitle className="text-base">{template.name}</CardTitle>
              {template.description && (
                <CardDescription>{template.description}</CardDescription>
              )}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {template.category && (
                  <Badge variant="secondary">{template.category}</Badge>
                )}
                <Badge variant="outline">
                  {template.placeholders.length} field(s)
                </Badge>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(template)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (window.confirm(`Delete "${template.name}"?`)) {
                    deleteMutation.mutate(template.id);
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </CardHeader>
          {template.placeholders.length > 0 && (
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {template.placeholders.map((token) => (
                  <code
                    key={token}
                    className="text-[11px] bg-muted px-1.5 py-0.5 rounded"
                  >
                    {`{{${token}}}`}
                  </code>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      ))}

      {editing && (
        <TemplateEditorDialog
          key={editing === "new" ? "new" : editing.id}
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            queryClient.invalidateQueries({
              queryKey: ["document_templates"],
            });
          }}
        />
      )}
    </div>
  );
};

DocumentTemplatesPage.path = "/document-templates";

function TemplateEditorDialog({
  template,
  onClose,
  onSaved,
}: {
  template: DocumentTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useNotify();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [category, setCategory] = useState(template?.category ?? "");
  const [body, setBody] = useState(template?.body ?? "");

  const tokens = extractPlaceholders(body);

  const save = useMutation({
    mutationFn: () =>
      saveDocumentTemplate({
        id: template?.id,
        name: name.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        body,
      }),
    onSuccess: () => {
      notify("Template saved.", { type: "info" });
      onSaved();
    },
    onError: (e) =>
      notify(e instanceof Error ? e.message : String(e), { type: "error" }),
  });

  const canSave = name.trim().length > 0 && body.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {template ? "Edit template" : "New document template"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="doc-name">Name</Label>
              <Input
                id="doc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Letter of Representation"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-cat">Category</Label>
              <Input
                id="doc-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Letters (optional)"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="doc-desc">Description</Label>
            <Input
              id="doc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this document is for (optional)"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="doc-body">Template body</Label>
            <Textarea
              id="doc-body"
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                "Paste the letter or form text here.\nMark fill-in fields with tokens like {{client_name}}, {{claim_number}}, {{date_of_loss}}."
              }
              className="font-mono text-xs"
            />
          </div>

          <div className="text-xs">
            <span className="text-muted-foreground">Detected fields: </span>
            {tokens.length === 0 ? (
              <span className="text-muted-foreground">
                none yet — add {"{{tokens}}"} to the body
              </span>
            ) : (
              <span className="inline-flex flex-wrap gap-1 align-middle">
                {tokens.map((token) => (
                  <code key={token} className="bg-muted px-1.5 py-0.5 rounded">
                    {`{{${token}}}`}
                  </code>
                ))}
              </span>
            )}
          </div>
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
