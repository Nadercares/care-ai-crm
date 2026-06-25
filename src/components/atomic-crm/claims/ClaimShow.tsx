import { Show } from "@/components/admin/show";
import { SimpleShowLayout } from "@/components/admin/simple-show-layout";
import { TextField } from "@/components/admin/text-field";
import { DateField } from "@/components/admin/date-field";
import { ReferenceField } from "@/components/admin/reference-field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ClaimStatusBadge } from "./ClaimStatusBadge";
import { ClaimCalendarCard } from "./ClaimCalendarCard";
import { ClaimDropboxCard } from "./ClaimDropboxCard";
import { ClaimStormCard } from "./ClaimStormCard";
import { EstimateComparator } from "./EstimateComparator";
import { StateLawChecklist } from "./StateLawChecklist";

export function ClaimShow() {
  return (
    <Show>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <span>Claim</span>
              <ClaimStatusBadge />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SimpleShowLayout>
              <TextField source="claim_number" label="Claim #" />
              <TextField source="internal_claim_number" label="Internal #" />
              <DateField source="date_of_loss" />
              <DateField source="date_reported" />
              <TextField source="type_of_loss" label="Type of loss" />
              <TextField source="cause_of_loss" label="Cause of loss" />
              <TextField source="description" label="Description" />
            </SimpleShowLayout>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Parties</CardTitle>
          </CardHeader>
          <CardContent>
            <SimpleShowLayout>
              <ReferenceField
                source="contact_id"
                reference="contacts"
                label="Insured"
              />
              <ReferenceField
                source="carrier_id"
                reference="carriers"
                label="Carrier"
              />
              <ReferenceField
                source="carrier_adjuster_id"
                reference="carrier_adjusters"
                label="Carrier adjuster"
              />
              <ReferenceField
                source="policy_id"
                reference="policies"
                label="Policy"
              />
              <ReferenceField
                source="assigned_pa_sales_id"
                reference="sales"
                label="Assigned PA"
              />
            </SimpleShowLayout>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Loss location</CardTitle>
          </CardHeader>
          <CardContent>
            <SimpleShowLayout>
              <TextField source="loss_location_address" label="Address" />
              <TextField source="loss_location_city" label="City" />
              <TextField source="loss_location_state" label="State" />
              <TextField source="loss_location_zip" label="ZIP" />
            </SimpleShowLayout>
          </CardContent>
        </Card>

        <div className="lg:col-span-3">
          <ClaimCalendarCard />
        </div>

        <div className="lg:col-span-3">
          <ClaimDropboxCard />
        </div>

        <div className="lg:col-span-3">
          <ClaimStormCard />
        </div>

        <div className="lg:col-span-3">
          <EstimateComparator />
        </div>

        <div className="lg:col-span-3">
          <StateLawChecklist />
        </div>
      </div>
    </Show>
  );
}
