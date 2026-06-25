import type { Identifier, RaRecord } from "ra-core";
import type { ComponentType } from "react";

import type {
  COMPANY_CREATED,
  CONTACT_CREATED,
  CONTACT_NOTE_CREATED,
  DEAL_CREATED,
  DEAL_NOTE_CREATED,
} from "./consts";

export type SignUpData = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
};

export type SalesFormData = {
  avatar?: string;
  email: string;
  password?: string;
  first_name: string;
  last_name: string;
  administrator: boolean;
  disabled: boolean;
};

export type Sale = {
  first_name: string;
  last_name: string;
  administrator: boolean;
  avatar?: RAFile;
  disabled?: boolean;
  user_id: string;

  /**
   * This is a copy of the user's email, to make it easier to handle by react admin
   * DO NOT UPDATE this field directly, it should be updated by the backend
   */
  email: string;

  /**
   * This is used by the fake rest provider to store the password
   * DO NOT USE this field in your code besides the fake rest provider
   * @deprecated
   */
  password?: string;
} & Pick<RaRecord, "id">;

export type Company = {
  name: string;
  logo: RAFile;
  sector: string;
  size: 1 | 10 | 50 | 250 | 500;
  linkedin_url: string;
  website: string;
  phone_number: string;
  address: string;
  zipcode: string;
  city: string;
  state_abbr: string;
  sales_id?: Identifier;
  created_at: string;
  description: string;
  revenue: string;
  tax_identifier: string;
  country: string;
  context_links?: string[];
  nb_contacts?: number;
  nb_deals?: number;
} & Pick<RaRecord, "id">;

export type EmailAndType = {
  email: string;
  type: "Work" | "Home" | "Other";
};

export type PhoneNumberAndType = {
  number: string;
  type: "Work" | "Home" | "Other";
};

export type Contact = {
  first_name: string;
  last_name: string;
  title: string;
  company_id?: Identifier | null;
  email_jsonb: EmailAndType[];
  avatar?: Partial<RAFile>;
  linkedin_url?: string | null;
  first_seen: string;
  last_seen: string;
  has_newsletter: boolean;
  tags: number[];
  gender: string;
  sales_id?: Identifier;
  status: string;
  background: string;
  phone_jsonb: PhoneNumberAndType[];
  nb_tasks?: number;
  company_name?: string;
} & Pick<RaRecord, "id">;

export type ContactNote = {
  contact_id: Identifier;
  text: string;
  date: string;
  sales_id: Identifier;
  status: string;
  attachments?: AttachmentNote[];
} & Pick<RaRecord, "id">;

export type Deal = {
  name: string;
  company_id: Identifier;
  contact_ids: Identifier[];
  category: string;
  stage: string;
  description: string;
  amount: number;
  created_at: string;
  updated_at: string;
  archived_at?: string;
  expected_closing_date: string;
  sales_id: Identifier;
  index: number;
} & Pick<RaRecord, "id">;

export type DealNote = {
  deal_id: Identifier;
  text: string;
  date: string;
  sales_id: Identifier;
  attachments?: AttachmentNote[];

  // This is defined for compatibility with `ContactNote`
  status?: undefined;
} & Pick<RaRecord, "id">;

export type Tag = {
  id: number;
  name: string;
  color: string;
};

export type Task = {
  contact_id: Identifier;
  type: string;
  text: string;
  due_date: string;
  done_date?: string | null;
  sales_id?: Identifier;
} & Pick<RaRecord, "id">;

export type ActivityCompanyCreated = {
  type: typeof COMPANY_CREATED;
  company_id: Identifier;
  company: Company;
  sales_id: Identifier;
  date: string;
} & Pick<RaRecord, "id">;

export type ActivityContactCreated = {
  type: typeof CONTACT_CREATED;
  company_id: Identifier;
  sales_id?: Identifier;
  contact: Contact;
  date: string;
} & Pick<RaRecord, "id">;

export type ActivityContactNoteCreated = {
  type: typeof CONTACT_NOTE_CREATED;
  sales_id?: Identifier;
  contactNote: ContactNote;
  date: string;
} & Pick<RaRecord, "id">;

export type ActivityDealCreated = {
  type: typeof DEAL_CREATED;
  company_id: Identifier;
  sales_id?: Identifier;
  deal: Deal;
  date: string;
};

export type ActivityDealNoteCreated = {
  type: typeof DEAL_NOTE_CREATED;
  sales_id?: Identifier;
  dealNote: DealNote;
  date: string;
};

export type Activity = RaRecord &
  (
    | ActivityCompanyCreated
    | ActivityContactCreated
    | ActivityContactNoteCreated
    | ActivityDealCreated
    | ActivityDealNoteCreated
  );

export interface RAFile {
  src: string;
  title: string;
  path?: string;
  rawFile: File;
  type?: string;
}

export type AttachmentNote = RAFile;

export interface LabeledValue {
  value: string;
  label: string;
}

export type DealStage = LabeledValue;

export interface NoteStatus extends LabeledValue {
  color: string;
}

export interface ContactGender {
  value: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

// --- Claims domain (public-adjuster workflow) ---

export type Carrier = {
  name: string;
  naic_code?: string;
  claims_phone?: string;
  claims_email?: string;
  claims_fax?: string;
  claims_address?: string;
  website?: string;
  notes?: string;
  created_at?: string;
} & Pick<RaRecord, "id">;

export type CarrierAdjuster = {
  carrier_id?: Identifier | null;
  first_name?: string;
  last_name?: string;
  license_number?: string;
  license_state?: string;
  email?: string;
  phone?: string;
  role?:
    | "staff"
    | "independent"
    | "desk"
    | "field"
    | "reinspector"
    | "supervisor"
    | string;
  notes?: string;
  created_at?: string;
} & Pick<RaRecord, "id">;

export type PolicyEndorsement = {
  name: string;
  description?: string;
  limit?: number;
  notes?: string;
};

export type PolicyExclusion = {
  name: string;
  description?: string;
};

export type Policy = {
  contact_id: Identifier;
  carrier_id?: Identifier | null;
  policy_number?: string;
  policy_type?: string;
  effective_date?: string;
  expiration_date?: string;
  state_abbr?: string;
  premium_amount?: number;
  coverage_a_dwelling?: number;
  coverage_b_other_structures?: number;
  coverage_c_personal_property?: number;
  coverage_d_loss_of_use?: number;
  coverage_e_personal_liability?: number;
  coverage_f_medical_payments?: number;
  all_other_perils_deductible?: number;
  hurricane_deductible_pct?: number;
  hurricane_deductible_amount?: number;
  wind_hail_deductible_pct?: number;
  flood_deductible?: number;
  endorsements?: PolicyEndorsement[];
  exclusions?: PolicyExclusion[];
  summary?: string;
  document_url?: string;
  raw_extracted?: Record<string, unknown>;
  notes?: string;
  sales_id?: Identifier;
  created_at?: string;
} & Pick<RaRecord, "id">;

export type ClaimStatus =
  | "intake"
  | "filed"
  | "adjuster_assigned"
  | "inspection_scheduled"
  | "inspected"
  | "estimate_pending"
  | "negotiation"
  | "partial_payment"
  | "reopen"
  | "denied"
  | "appraisal"
  | "mediation"
  | "litigation"
  | "settled"
  | "closed";

export type Claim = {
  contact_id: Identifier;
  policy_id?: Identifier | null;
  carrier_id?: Identifier | null;
  carrier_adjuster_id?: Identifier | null;
  deal_id?: Identifier | null;
  claim_number?: string;
  internal_claim_number?: string;
  date_of_loss?: string;
  date_reported?: string;
  type_of_loss?: string;
  cause_of_loss?: string;
  loss_location_address?: string;
  loss_location_city?: string;
  loss_location_state?: string;
  loss_location_zip?: string;
  status: ClaimStatus | string;
  description?: string;
  assigned_pa_sales_id?: Identifier;
  sales_id?: Identifier;
  created_at?: string;
  updated_at?: string;

  // Denormalized fields available on the claims_summary view
  insured_first_name?: string;
  insured_last_name?: string;
  carrier_name?: string;
  carrier_naic?: string;
  carrier_adjuster_name?: string;
  carrier_adjuster_license?: string;
  policy_number?: string;
  policy_type?: string;
  settlement_amount?: number;
  settlement_method?: string;
  settled_at?: string;
  days_to_settle?: number;
  nb_estimates?: number;
} & Pick<RaRecord, "id">;

export type Estimate = {
  claim_id: Identifier;
  source:
    | "carrier"
    | "public_adjuster"
    | "contractor"
    | "engineer"
    | "other"
    | string;
  source_name?: string;
  software?: string;
  estimate_date?: string;
  rcv_total?: number;
  acv_total?: number;
  depreciation_total?: number;
  deductible_applied?: number;
  net_payable?: number;
  overhead_pct?: number;
  profit_pct?: number;
  sales_tax?: number;
  document_url?: string;
  summary?: string;
  notes?: string;
  sales_id?: Identifier;
  created_at?: string;
} & Pick<RaRecord, "id">;

export type EstimateLineItem = {
  estimate_id: Identifier;
  room?: string;
  category?: string;
  code?: string;
  description?: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  rcv?: number;
  acv?: number;
  depreciation?: number;
  age_life?: string;
  condition?: string;
  notes?: string;
} & Pick<RaRecord, "id">;

export type SettlementMethod =
  | "negotiation"
  | "appraisal"
  | "mediation"
  | "litigation"
  | "denied"
  | "withdrawn";

export type Settlement = {
  claim_id: Identifier;
  settled_at?: string;
  settlement_amount?: number;
  supplemental_amount?: number;
  depreciation_recoverable?: number;
  deductible_amount?: number;
  net_to_insured?: number;
  method?: SettlementMethod | string;
  pa_involved?: boolean;
  attorney_involved?: boolean;
  attorney_firm?: string;
  attorney_name?: string;
  mediator_appraiser_name?: string;
  mediator_appraiser_role?:
    | "mediator"
    | "umpire"
    | "carrier_appraiser"
    | "insured_appraiser"
    | string;
  days_to_settle?: number;
  our_role?:
    | "lead_pa"
    | "co_with_attorney"
    | "handed_to_attorney"
    | "reinspection_only"
    | string;
  notes?: string;
  sales_id?: Identifier;
  created_at?: string;
} & Pick<RaRecord, "id">;

// --- State-law compliance KB ---

export type StateLawStatus = "draft" | "active" | "retired";

export type StateLawSummary = {
  state_abbr: string;
  topic: string;
  title: string;
  summary: string;
  source_citation?: string | null;
  applies_to?: string[];
  last_reviewed_at?: string | null;
  reviewed_by_sales_id?: Identifier | null;
  status: StateLawStatus;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
} & Pick<RaRecord, "id">;

// --- Gmail integration ---

export type GmailConnection = {
  sales_id: Identifier;
  google_email: string;
  refresh_token: string;
  scopes?: string[];
  last_synced_at?: string | null;
  last_sync_status?: "ok" | "error" | "running" | null;
  last_sync_error?: string | null;
  created_at?: string;
  updated_at?: string;
} & Pick<RaRecord, "id">;

export type EmailTriageClassification =
  | "claim_correspondence"
  | "new_lead"
  | "admin"
  | "marketing"
  | "spam"
  | "unknown";

export type EmailTriageUrgency = "high" | "medium" | "low";
export type EmailTriageStatus = "new" | "reviewed" | "archived" | "dismissed";

export type EmailTriage = {
  sales_id: Identifier;
  gmail_thread_id: string;
  latest_message_id?: string | null;
  subject?: string | null;
  from_email?: string | null;
  from_name?: string | null;
  snippet?: string | null;
  body_excerpt?: string | null;
  received_at?: string | null;
  claim_id?: Identifier | null;
  contact_id?: Identifier | null;
  carrier_id?: Identifier | null;
  carrier_adjuster_id?: Identifier | null;
  classification?: EmailTriageClassification | string;
  urgency?: EmailTriageUrgency | string;
  summary?: string | null;
  suggested_action?: string | null;
  ai_confidence?: number | null;
  ai_rationale?: string | null;
  status: EmailTriageStatus | string;
  created_at?: string;
} & Pick<RaRecord, "id">;
