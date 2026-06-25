import { useState } from "react";
import { useNotify } from "ra-core";
import { Sparkles, Loader2, AlertTriangle, Mail, Send } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

import { getSupabaseClient } from "../providers/supabase/supabase";

interface Draft {
  subject: string;
  body: string;
  tone: string;
  references_facts: string[];
  confidence_notes: string;
}

export function EmailReplyDialog({
  triageId,
  subject,
  fromName,
  fromEmail,
  open,
  onOpenChange,
}: {
  triageId: number;
  subject?: string;
  fromName?: string | null;
  fromEmail?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const notify = useNotify();
  const [instructions, setInstructions] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  // After generation we let the user edit subject / body before
  // saving to Gmail. We keep the AI's references / confidence
  // alongside as read-only context.
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);

  const callDraftFn = async (saveToGmail: boolean) => {
    const supabase = getSupabaseClient();
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) throw new Error("Not signed in.");
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/draft-email-reply`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        triage_id: triageId,
        instructions: instructions || undefined,
        save_to_gmail: saveToGmail,
        // If the user edited the draft before pressing Save to Gmail,
        // we pass their text. The edge function ignores these unless
        // save_to_gmail is true AND draft_override is present.
        draft_override:
          saveToGmail && draft
            ? { subject: editSubject, body: editBody }
            : undefined,
      }),
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload?.error || `HTTP ${res.status}`);
    }
    return payload as {
      draft: Draft;
      saved_to_gmail: boolean;
      gmail_draft_id: string | null;
      gmail_save_error: string | null;
    };
  };

  const generate = async () => {
    setGenerating(true);
    setDraft(null);
    setSavedDraftId(null);
    try {
      const payload = await callDraftFn(false);
      setDraft(payload.draft);
      setEditSubject(payload.draft.subject);
      setEditBody(payload.draft.body);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), {
        type: "error",
      });
    } finally {
      setGenerating(false);
    }
  };

  const saveToGmail = async () => {
    setSaving(true);
    try {
      const payload = await callDraftFn(true);
      if (payload.gmail_save_error) {
        notify(
          `Saved AI draft, but Gmail rejected it: ${payload.gmail_save_error}`,
          {
            type: "error",
          },
        );
      } else if (payload.saved_to_gmail && payload.gmail_draft_id) {
        setSavedDraftId(payload.gmail_draft_id);
        notify("Draft saved to Gmail. Open Gmail to review and send.", {
          type: "success",
        });
      } else {
        notify("Draft generated but Gmail did not return a draft id.", {
          type: "warning",
        });
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), {
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI draft reply
          </DialogTitle>
          <DialogDescription className="text-xs">
            Replying to{" "}
            <strong>
              {fromName ?? ""} {fromEmail && <span>&lt;{fromEmail}&gt;</span>}
            </strong>{" "}
            — {subject ?? "(no subject)"}. Decision support only; you review and
            send.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">
              Optional instructions to the model
            </label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Ask for a re-inspection focusing on roof matching and the omitted code-upgrade items."
              rows={2}
              className="text-xs"
            />
          </div>

          {!draft && (
            <Button
              type="button"
              onClick={() => void generate()}
              disabled={generating}
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {generating ? "Drafting…" : "Generate draft"}
            </Button>
          )}

          {draft && (
            <>
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline" className="text-[10px]">
                  tone: {draft.tone}
                </Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void generate()}
                  disabled={generating}
                >
                  {generating ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  Regenerate
                </Button>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">
                  Subject
                </label>
                <Input
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">
                  Body
                </label>
                <Textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={14}
                  className="text-xs font-mono"
                />
              </div>

              {draft.references_facts.length > 0 && (
                <div className="text-xs">
                  <p className="font-semibold text-muted-foreground mb-1">
                    Facts the draft relies on
                  </p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {draft.references_facts.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {draft.confidence_notes && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    <strong>Confidence:</strong> {draft.confidence_notes}
                  </AlertDescription>
                </Alert>
              )}

              {savedDraftId && (
                <Alert>
                  <Mail className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Saved as Gmail draft <code>{savedDraftId}</code>. Open Gmail
                    to review and send.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          {draft && (
            <Button
              type="button"
              onClick={() => void saveToGmail()}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {saving ? "Saving to Gmail…" : "Save to Gmail drafts"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
