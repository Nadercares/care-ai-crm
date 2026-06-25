import { CreateButton } from "@/components/admin/create-button";
import { DataTable } from "@/components/admin/data-table";
import { ExportButton } from "@/components/admin/export-button";
import { List } from "@/components/admin/list";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";

import { TopToolbar } from "../layout/TopToolbar";
import { ClaimStatusBadge } from "./ClaimStatusBadge";
import { CLAIM_STATUSES, US_STATES } from "../claimsConsts";

const ClaimListActions = () => (
  <TopToolbar>
    <ExportButton />
    <CreateButton label="New Claim" />
  </TopToolbar>
);

const filters = [
  <SearchInput source="q" alwaysOn />,
  <SelectInput
    source="status"
    choices={CLAIM_STATUSES as unknown as { value: string; label: string }[]}
    helperText={false}
  />,
  <SelectInput
    source="loss_location_state"
    choices={US_STATES as unknown as { value: string; label: string }[]}
    helperText={false}
    label="State"
  />,
];

export function ClaimList() {
  return (
    <List
      resource="claims_summary"
      filters={filters}
      actions={<ClaimListActions />}
      sort={{ field: "created_at", order: "DESC" }}
      perPage={25}
    >
      <DataTable rowClick={(id) => `/claims/${id}/show`}>
        <DataTable.Col source="claim_number" label="Claim #" />
        <DataTable.Col
          label="Insured"
          source="insured_last_name"
          render={(record: any) =>
            `${record.insured_first_name ?? ""} ${record.insured_last_name ?? ""}`.trim() ||
            "—"
          }
        />
        <DataTable.Col source="carrier_name" label="Carrier" />
        <DataTable.Col source="type_of_loss" label="Loss" />
        <DataTable.Col source="loss_location_state" label="State" />
        <DataTable.Col source="date_of_loss" label="Date of loss" />
        <DataTable.Col label="Status">
          <ClaimStatusBadge />
        </DataTable.Col>
        <DataTable.Col
          source="settlement_amount"
          label="Settlement"
          render={(record: any) =>
            record.settlement_amount != null
              ? `$${Number(record.settlement_amount).toLocaleString()}`
              : "—"
          }
        />
      </DataTable>
    </List>
  );
}
