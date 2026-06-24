import { useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { useNotify, useRecordContext } from "ra-core";
import {
  Sparkles,
  Upload,
  FileText,
  Loader2,
  AlertTriangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { ATTACHMENTS_BUCKET } from "../providers/commons/attachments";
import { getSupabaseClient } from "../providers/supabase/supabase";
import type { Policy } from "../types";

interface Extraction {
  policy_number?: string | null;
  policy_type?: string | null;
  carrier_name?: string | null;
  naic_code?: string | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  state_abbr?: string | null;
  premium_amount?: number | null;
  coverage_a_dwelling?: number | null;
  coverage_b_other_structures?: number | null;
  coverage_c_personal_property?: number | null;
  coverage_d_loss_of_use?: number | null;
  coverage_e_personal_liability?: number | null;
  coverage_f_medical_payments?: number | null;
  all_other_perils_deductible?: number | null;
  hurricane_deductible_pct?: number | null;
  hurricane_deductible_amount?: number | null;
  wind_hail_deductible_pct?: number | null;
  flood_deductible?: number | null;
  endorsements?: Array<{
    name: string;
    description?: string | null;
    limit?: number | null;
  }>;
  exclusions?: Array<{ name: string; description?: string | null }>;
  summary?: string;
  confidence_notes?: string;
}

// Fields the extractor will overwrite on the form. Carrier-name match is
// out of scope (carriers are a separate table); we surface the extracted
// name in confidence_notes / summary instead.
const FORM_FIELDS: ReadonlyArray<keyof Extraction> = [
  "policy_number",
  "policy_type",
  "effective_date",
  "expiration_date",
  "state_abbr",
  "premium_amount",
  "coverage_a_dwelling",
  "coverage_b_other_structures",
  "coverage_c_personal_property",
  "coverage_d_loss_of_use",
  "coverage_e_personal_liability",
  "coverage_f_medical_payments",
  "all_other_perils_deductible",
  "hurricane_deductible_pct",
  "hurricane_deductible_amount",
  "wind_hail_deductible_pct",
  "flood_deductible",
];

export function PolicyExtractor() {
  const record = useRecordContext<Policy>();
  const { setValue, getValues } = useFormContext();
  const notify = useNotify();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [lastExtraction, setLastExtraction] = useState<Extraction | null>(null);

  const policyId = record?.id;
  const documentUrl = (getValues("document_url") ?? record?.document_url) as
    | string
    | undefined;
  const canExtract = Boolean(policyId && documentUrl) && !extracting;

  const onFileSelected = async (file: File) => {
    if (!policyId) {
      notify("Save the policy first so the PDF has a place to live.", {
        type: "warning",
      });
      return;
    }
    setUploading(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const path = `policies/${policyId}/${Date.now()}-${safeName}`;
      const { error } = await getSupabaseClient()
        .storage.from(ATTACHMENTS_BUCKET)
        .upload(path, file, {
          contentType: file.type || "application/pdf",
          upsert: false,
        });
      if (error) throw error;
      setValue("document_url", path, { shouldDirty: true });
      notify("Policy PDF uploaded. Click Extract with AI to summarise it.", {
        type: "info",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(`Upload failed: ${msg}`, { type: "error" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const runExtract = async () => {
    if (!policyId) return;
    setExtracting(true);
    setLastExtraction(null);
    try {
      const supabase = getSupabaseClient();
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session?.session?.access_token;
      if (!accessToken) {
        throw new Error("Not authenticated");
      }

      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-policy`;
      const res = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ policy_id: policyId }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Extract failed (${res.status}): ${detail}`);
      }
      const payload = (await res.json()) as { extraction: Extraction };
      const extraction = payload.extraction;
      setLastExtraction(extraction);

      // Patch form fields. Only write fields the model returned non-null.
      for (const key of FORM_FIELDS) {
        const value = extraction[key];
        if (value !== null && value !== undefined) {
          setValue(key, value, { shouldDirty: true, shouldValidate: true });
        }
      }
      if (extraction.summary) {
        setValue("summary", extraction.summary, { shouldDirty: true });
      }
      if (extraction.endorsements && extraction.endorsements.length > 0) {
        setValue("endorsements", extraction.endorsements, {
          shouldDirty: true,
        });
      }
      if (extraction.exclusions && extraction.exclusions.length > 0) {
        setValue("exclusions", extraction.exclusions, { shouldDirty: true });
      }
      setValue("raw_extracted", extraction, { shouldDirty: true });

      notify("Extraction applied to form. Review every field before saving.", {
        type: "success",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(msg, { type: "error" });
    } finally {
      setExtracting(false);
    }
  };

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Policy PDF + AI extraction
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!policyId && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Save this policy first (any required fields), then come back to
              upload the PDF.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFileSelected(f);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!policyId || uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {uploading
              ? "Uploading…"
              : documentUrl
                ? "Replace PDF"
                : "Upload policy PDF"}
          </Button>

          <Button
            type="button"
            size="sm"
            disabled={!canExtract}
            onClick={() => void runExtract()}
          >
            {extracting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {extracting ? "Extracting…" : "Extract with AI"}
          </Button>

          {documentUrl && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {documentUrl.split("/").pop()}
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          AI extraction is decision-support only. Every field must be reviewed
          before this policy is relied on for claim work.
        </p>

        {lastExtraction?.confidence_notes && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <strong>Confidence notes from the model:</strong>{" "}
              {lastExtraction.confidence_notes}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
