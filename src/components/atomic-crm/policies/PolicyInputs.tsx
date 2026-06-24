import { required } from "ra-core";
import { TextInput } from "@/components/admin/text-input";
import { NumberInput } from "@/components/admin/number-input";
import { SelectInput } from "@/components/admin/select-input";
import { DateInput } from "@/components/admin/date-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { Separator } from "@/components/ui/separator";

import { POLICY_TYPES, US_STATES } from "../claimsConsts";

export function PolicyInputs() {
  return (
    <div className="space-y-6 w-full">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Insured & carrier
        </h3>
        <ReferenceInput
          source="contact_id"
          reference="contacts"
          label="Insured (contact)"
        >
          {/* default autocomplete; required validation on the wrapped input */}
        </ReferenceInput>
        <ReferenceInput source="carrier_id" reference="carriers" />
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Policy basics
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextInput
            source="policy_number"
            validate={required()}
            helperText={false}
          />
          <SelectInput
            source="policy_type"
            choices={
              POLICY_TYPES as unknown as { value: string; label: string }[]
            }
            helperText={false}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <DateInput source="effective_date" />
          <DateInput source="expiration_date" />
          <SelectInput
            source="state_abbr"
            choices={US_STATES as unknown as { value: string; label: string }[]}
            label="State"
            helperText={false}
          />
        </div>
        <NumberInput source="premium_amount" label="Annual premium" />
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Coverages (homeowners-style)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <NumberInput source="coverage_a_dwelling" label="A — Dwelling" />
          <NumberInput
            source="coverage_b_other_structures"
            label="B — Other structures"
          />
          <NumberInput
            source="coverage_c_personal_property"
            label="C — Personal property"
          />
          <NumberInput
            source="coverage_d_loss_of_use"
            label="D — Loss of use"
          />
          <NumberInput
            source="coverage_e_personal_liability"
            label="E — Personal liability"
          />
          <NumberInput
            source="coverage_f_medical_payments"
            label="F — Medical payments"
          />
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Deductibles
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <NumberInput
            source="all_other_perils_deductible"
            label="All other perils ($)"
          />
          <NumberInput
            source="hurricane_deductible_pct"
            label="Hurricane (% of Cov A)"
          />
          <NumberInput
            source="hurricane_deductible_amount"
            label="Hurricane ($ calc)"
          />
          <NumberInput
            source="wind_hail_deductible_pct"
            label="Wind/hail (% of Cov A)"
          />
          <NumberInput source="flood_deductible" label="Flood ($)" />
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Document & notes
        </h3>
        <TextInput
          source="document_url"
          label="Policy document URL"
          helperText="Link to PDF in storage / Dropbox"
        />
        <TextInput
          source="summary"
          multiline
          rows={4}
          helperText="AI-extracted or hand-entered summary of coverages, endorsements, exclusions"
        />
        <TextInput source="notes" multiline rows={3} />
      </section>
    </div>
  );
}
