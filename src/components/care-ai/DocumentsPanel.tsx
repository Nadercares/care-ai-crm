import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNotify } from "ra-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { runSpecialistAgent } from "@/api/agents";
import { fetchDocumentTemplates } from "@/api/documentTemplates";
import {
  deleteClaimEmail,
  fetchClaimEmails,
  logClaimEmail,
  type ClaimEmail,
} from "@/api/claimEmails";

/**
 * Documents & Email panel on the claim screen. Fills document templates with
 * claim data and logs/replies to claim email — all via the Documents agent.
 * The agent's drafts appear in the AI Agents panel.
 */
export function DocumentsPanel({ dealId }: { dealId: number }) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [expandedEmail, setExpandedEmail] = useState<number | null>(null);
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  const templatesQuery = useQuery({
    queryKey: ["document_templates"],
    queryFn: fetchDocumentTemplates,
  });
  const emailsQuery = useQuery({
    queryKey: ["claim_emails", dealId],
    queryFn: () => fetchClaimEmails(dealId),
  });
  const templates = templatesQuery.data ?? [];
  const emails = emailsQuery.data ?? [];

  const refreshAgents = () => {
    queryClient.invalidateQueries({ queryKey: ["agent_runs", dealId] });
    queryClient.invalidateQueries({ queryKey: ["agent_outputs", dealId] });
  };
  const reportError = (e: unknown) =>
    notify(e instanceof Error ? e.message : String(e), { type: "error" });

  const fillTemplate = useMutation({
    mutationFn: (templateName: string) =>
      runSpecialistAgent(
        "documents_email",
        dealId,
        `Fill the document template named "${templateName}" for this claim, and produce the completed document.`,
      ),
    onSuccess: () => {
      notify(
        "Documents agent started — the filled draft will appear in the AI Agents panel below.",
        { type: "info" },
      );
      refreshAgents();
    },
    onError: reportError,
  });

  const draftReply = useMutation({
    mutationFn: (email: ClaimEmail) =>
      runSpecialistAgent(
        "documents_email",
        dealId,
        `Draft a reply to the ${email.direction} email from ${
          email.from_name || email.from_email || "an unknown sender"
        } with subject "${
          email.subject ?? "(no subject)"
        }". Use get_claim_emails to read its full content.`,
      ),
    onSuccess: () => {
      notify(
        "Documents agent started — the draft reply will appear in the AI Agents panel below.",
        { type: "info" },
      );
      refreshAgents();
    },
    onError: reportError,
  });

  const logEmail = useMutation({
    mutationFn: () =>
      logClaimEmail(dealId, {
        direction: "inbound",
        from_name: fromName,
        from_email: fromEmail,
        subject,
        body: emailBody,
      }),
    onSuccess: () => {
      notify("Email logged.", { type: "info" });
      setShowEmailForm(false);
      setFromName("");
      setFromEmail("");
      setSubject("");
      setEmailBody("");
      queryClient.invalidateQueries({ queryKey: ["claim_emails", dealId] });
    },
    onError: reportError,
  });

  const removeEmail = useMutation({
    mutationFn: deleteClaimEmail,
    onSuccess: () => {
      notify("Email removed.", { type: "info" });
      queryClient.invalidateQueries({ queryKey: ["claim_emails", dealId] });
    },
    onError: reportError,
  });

  return (
    <div className="m-4">
      <Separator className="mb-4" />
      <h3 className="text-sm font-semibold">Documents &amp; Email</h3>
      <p className="text-xs text-muted-foreground">
        Fill a document template with this claim's data, or log an email and
        draft a reply. The agent's drafts appear in the AI Agents panel below.
      </p>

      <div className="mt-3">
        <div className="text-xs font-semibold text-muted-foreground tracking-wide mb-1.5">
          Fill a document
        </div>
        {templatesQuery.isError && (
          <p className="text-xs text-destructive">
            Could not load templates. Apply the database migration:{" "}
            <code>npx supabase db reset --local</code>.
          </p>
        )}
        {!templatesQuery.isError && templates.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No document templates yet. Create one from the user menu → Document
            Templates.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedTemplate}
              onValueChange={setSelectedTemplate}
            >
              <SelectTrigger className="h-8 w-60 text-xs">
                <SelectValue placeholder="Choose a template…" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.name}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!selectedTemplate || fillTemplate.isPending}
              onClick={() => fillTemplate.mutate(selectedTemplate)}
            >
              {fillTemplate.isPending ? "Starting…" : "Fill for this claim"}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-xs font-semibold text-muted-foreground tracking-wide">
            Claim emails
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => setShowEmailForm((s) => !s)}
          >
            {showEmailForm ? "Cancel" : "Log an email"}
          </Button>
        </div>

        {showEmailForm && (
          <div className="border rounded-md p-3 space-y-2 mb-2">
            <div className="grid grid-cols-2 gap-2">
              <Input
                className="h-8 text-xs"
                placeholder="From name"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
              />
              <Input
                className="h-8 text-xs"
                placeholder="From email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
              />
            </div>
            <Input
              className="h-8 text-xs"
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <Textarea
              rows={4}
              className="text-xs"
              placeholder="Paste the email body"
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={
                  logEmail.isPending || (!subject.trim() && !emailBody.trim())
                }
                onClick={() => logEmail.mutate()}
              >
                {logEmail.isPending ? "Saving…" : "Save email"}
              </Button>
            </div>
          </div>
        )}

        {emailsQuery.isLoading && (
          <div className="flex justify-center py-3">
            <Spinner />
          </div>
        )}
        {!emailsQuery.isLoading && emails.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No emails logged for this claim.
          </p>
        )}

        <div className="space-y-2">
          {emails.map((email) => (
            <div key={email.id} className="border rounded-md">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-2 p-2 text-left"
                onClick={() =>
                  setExpandedEmail(expandedEmail === email.id ? null : email.id)
                }
              >
                <span className="text-xs font-medium truncate">
                  {email.subject || "(no subject)"}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-[10px]">
                    {email.direction}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {email.from_name || email.from_email || ""}
                  </span>
                </span>
              </button>
              {expandedEmail === email.id && (
                <div className="border-t px-3 py-2 space-y-2">
                  <div className="text-xs whitespace-pre-wrap leading-5">
                    {email.body}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        if (window.confirm("Delete this logged email?")) {
                          removeEmail.mutate(email.id);
                        }
                      }}
                    >
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={draftReply.isPending}
                      onClick={() => draftReply.mutate(email)}
                    >
                      Draft a reply
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
