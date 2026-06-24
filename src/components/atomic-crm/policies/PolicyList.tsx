import { CreateButton } from "@/components/admin/create-button";
import { DataTable } from "@/components/admin/data-table";
import { ExportButton } from "@/components/admin/export-button";
import { List } from "@/components/admin/list";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { ReferenceField } from "@/components/admin/reference-field";

import { TopToolbar } from "../layout/TopToolbar";
import { POLICY_TYPES, US_STATES } from "../claimsConsts";

const PolicyListActions = () => (
  <TopToolbar>
    <ExportButton />
    <CreateButton label="New Policy" />
  </TopToolbar>
);

const filters = [
  <SearchInput source="q" alwaysOn />,
  <SelectInput
    source="policy_type"
    choices={POLICY_TYPES as unknown as { value: string; label: string }[]}
    helperText={false}
  />,
  <SelectInput
    source="state_abbr"
    choices={US_STATES as unknown as { value: string; label: string }[]}
    label="State"
    helperText={false}
  />,
];

export function PolicyList() {
  return (
    <List
      filters={filters}
      actions={<PolicyListActions />}
      sort={{ field: "created_at", order: "DESC" }}
      perPage={25}
    >
      <DataTable rowClick="edit">
        <DataTable.Col source="policy_number" label="Policy #" />
        <DataTable.Col source="policy_type" label="Type" />
        <DataTable.Col label="Insured">
          <ReferenceField source="contact_id" reference="contacts" />
        </DataTable.Col>
        <DataTable.Col label="Carrier">
          <ReferenceField source="carrier_id" reference="carriers" />
        </DataTable.Col>
        <DataTable.Col source="state_abbr" label="State" />
        <DataTable.Col source="effective_date" label="Effective" />
        <DataTable.Col source="expiration_date" label="Expires" />
      </DataTable>
    </List>
  );
}
