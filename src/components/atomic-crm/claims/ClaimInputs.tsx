import { required } from "ra-core";
import { TextInput } from "@/components/admin/text-input";
import { SelectInput } from "@/components/admin/select-input";
import { DateInput } from "@/components/admin/date-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { Separator } from "@/components/ui/separator";

import { CLAIM_STATUSES, TYPE_OF_LOSS, US_STATES } from "../claimsConsts";

export function ClaimInputs() {
  return (
    <div className="space-y-6 w-full">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Insured & policy
        </h3>
        <ReferenceInput source="contact_id" reference="contacts" />
        <ReferenceInput source="policy_id" reference="policies" filter={{}} />
        <ReferenceInput source="carrier_id" reference="carriers" />
        <ReferenceInput
          source="carrier_adjuster_id"
          reference="carrier_adjusters"
        />
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Claim
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextInput
            source="claim_number"
            helperText="Carrier-issued claim number"
          />
          <TextInput
            source="internal_claim_number"
            helperText="Our internal number"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DateInput source="date_of_loss" />
          <DateInput source="date_reported" />
        </div>
        <SelectInput
          source="status"
          choices={
            CLAIM_STATUSES as unknown as { value: string; label: string }[]
          }
          validate={required()}
          helperText={false}
        />
        <SelectInput
          source="type_of_loss"
          choices={
            TYPE_OF_LOSS as unknown as { value: string; label: string }[]
          }
          helperText={false}
        />
        <TextInput
          source="cause_of_loss"
          multiline
          helperText="Brief description of how the loss occurred"
        />
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Loss location
        </h3>
        <TextInput source="loss_location_address" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <TextInput source="loss_location_city" />
          <SelectInput
            source="loss_location_state"
            choices={US_STATES as unknown as { value: string; label: string }[]}
            helperText={false}
          />
          <TextInput source="loss_location_zip" />
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Assignment & notes
        </h3>
        <ReferenceInput
          source="assigned_pa_sales_id"
          reference="sales"
          label="Assigned public adjuster"
        />
        <TextInput
          source="description"
          multiline
          rows={4}
          helperText="Internal description / notes"
        />
      </section>
    </div>
  );
}
