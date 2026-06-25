import { useState } from "react";
import { Sparkles } from "lucide-react";

import { DataTable } from "@/components/admin/data-table";
import { List } from "@/components/admin/list";
import { ReferenceField } from "@/components/admin/reference-field";
import { SelectInput } from "@/components/admin/select-input";
import { SearchInput } from "@/components/admin/search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { TopToolbar } from "../layout/TopToolbar";
import { ConnectGmailCard } from "./ConnectGmailCard";
import { EmailReplyDialog } from "./EmailReplyDialog";

const URGENCY_VARIANT: Record<string, string> = {
  high: "text-red-500 border-red-500/50",
  medium: "text-amber-500 border-amber-500/50",
  low: "text-muted-foreground border-border",
};

const CLASSIFICATION_LABEL: Record<string, string> = {
  claim_correspondence: "Claim",
  new_lead: "New lead",
  admin: "Admin",
  marketing: "Marketing",
  spam: "Spam",
  unknown: "Unknown",
};

const filters = [
  <SearchInput key="q" source="q" alwaysOn />,
  <SelectInput
    key="status"
    source="status"
    choices={[
      { id: "new", name: "New" },
      { id: "reviewed", name: "Reviewed" },
      { id: "archived", name: "Archived" },
      { id: "dismissed", name: "Dismissed" },
    ]}
  />,
  <SelectInput
    key="urgency"
    source="urgency"
    choices={[
      { id: "high", name: "High" },
      { id: "medium", name: "Medium" },
      { id: "low", name: "Low" },
    ]}
  />,
  <SelectInput
    key="classification"
    source="classification"
    choices={Object.entries(CLASSIFICATION_LABEL).map(([id, name]) => ({
      id,
      name,
    }))}
  />,
];

const EmailTriageActions = () => (
  <TopToolbar>
    {/* triage runner lives in ConnectGmailCard header */}
  </TopToolbar>
);

export function EmailTriageList() {
  // Bump to force list refetch after a triage run.
  const [version, setVersion] = useState(0);

  return (
    <>
      <ConnectGmailCard onTriageRun={() => setVersion((v) => v + 1)} />
      <List
        key={version}
        filters={filters}
        filterDefaultValues={{ status: "new" }}
        actions={<EmailTriageActions />}
        sort={{ field: "received_at", order: "DESC" }}
        perPage={25}
      >
        <DataTable rowClick={false}>
          <DataTable.Col label="Urgency">
            <UrgencyCell />
          </DataTable.Col>
          <DataTable.Col label="Class">
            <ClassificationCell />
          </DataTable.Col>
          <DataTable.Col label="From / subject">
            <FromSubjectCell />
          </DataTable.Col>
          <DataTable.Col label="Carrier">
            <ReferenceField
              source="carrier_id"
              reference="carriers"
              link={false}
            />
          </DataTable.Col>
          <DataTable.Col label="Claim">
            <ReferenceField source="claim_id" reference="claims" link="show" />
          </DataTable.Col>
          <DataTable.Col label="AI summary">
            <SummaryCell />
          </DataTable.Col>
          <DataTable.Col label="Suggested action">
            <SuggestedActionCell />
          </DataTable.Col>
          <DataTable.Col source="received_at" label="Received">
            <ReceivedCell />
          </DataTable.Col>
          <DataTable.Col label="">
            <DraftReplyCell />
          </DataTable.Col>
        </DataTable>
      </List>
    </>
  );
}

// --- field cells ---

import { useRecordContext } from "ra-core";

interface TriageRecord {
  id: number;
  urgency?: string;
  classification?: string;
  subject?: string;
  from_email?: string;
  from_name?: string;
  summary?: string;
  suggested_action?: string;
  ai_confidence?: number;
  received_at?: string;
  gmail_thread_id?: string;
}

function UrgencyCell() {
  const record = useRecordContext<TriageRecord>();
  if (!record?.urgency) return <span>—</span>;
  return (
    <Badge
      variant="outline"
      className={`text-[10px] ${URGENCY_VARIANT[record.urgency] ?? ""}`}
    >
      {record.urgency}
    </Badge>
  );
}

function ClassificationCell() {
  const record = useRecordContext<TriageRecord>();
  if (!record?.classification) return <span>—</span>;
  return (
    <Badge variant="outline" className="text-[10px]">
      {CLASSIFICATION_LABEL[record.classification] ?? record.classification}
    </Badge>
  );
}

function FromSubjectCell() {
  const record = useRecordContext<TriageRecord>();
  if (!record) return null;
  return (
    <div className="text-xs">
      <div className="font-medium truncate max-w-[280px]">
        {record.subject || "(no subject)"}
      </div>
      <div className="text-muted-foreground truncate max-w-[280px]">
        {record.from_name || ""}{" "}
        <span className="text-[10px]">&lt;{record.from_email}&gt;</span>
      </div>
    </div>
  );
}

function SummaryCell() {
  const record = useRecordContext<TriageRecord>();
  if (!record?.summary) return <span>—</span>;
  return (
    <div className="text-xs max-w-[320px]">
      <div>{record.summary}</div>
      {typeof record.ai_confidence === "number" && (
        <div className="text-muted-foreground text-[10px] mt-0.5">
          confidence {(record.ai_confidence * 100).toFixed(0)}%
        </div>
      )}
    </div>
  );
}

function SuggestedActionCell() {
  const record = useRecordContext<TriageRecord>();
  if (!record?.suggested_action) return <span>—</span>;
  return (
    <div className="text-xs max-w-[260px] italic">
      {record.suggested_action}
    </div>
  );
}

function ReceivedCell() {
  const record = useRecordContext<TriageRecord>();
  if (!record?.received_at) return <span>—</span>;
  const date = new Date(record.received_at);
  return (
    <div className="text-xs">
      <div>{date.toLocaleDateString()}</div>
      <div className="text-muted-foreground text-[10px]">
        {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
      {record.gmail_thread_id && (
        <a
          href={`https://mail.google.com/mail/u/0/#inbox/${record.gmail_thread_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] underline text-muted-foreground"
        >
          Open in Gmail
        </a>
      )}
    </div>
  );
}

function DraftReplyCell() {
  const record = useRecordContext<TriageRecord>();
  const [open, setOpen] = useState(false);
  if (!record) return null;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Sparkles className="h-3 w-3" />
        Draft reply
      </Button>
      {open && (
        <EmailReplyDialog
          triageId={record.id}
          subject={record.subject ?? undefined}
          fromName={record.from_name}
          fromEmail={record.from_email}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
