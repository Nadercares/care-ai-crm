import { CreateButton } from "@/components/admin/create-button";
import { DataTable } from "@/components/admin/data-table";
import { ExportButton } from "@/components/admin/export-button";
import { List } from "@/components/admin/list";
import { SearchInput } from "@/components/admin/search-input";

import { TopToolbar } from "../layout/TopToolbar";

const CarrierListActions = () => (
  <TopToolbar>
    <ExportButton />
    <CreateButton label="New Carrier" />
  </TopToolbar>
);

const filters = [<SearchInput source="q" alwaysOn />];

export function CarrierList() {
  return (
    <List
      filters={filters}
      actions={<CarrierListActions />}
      sort={{ field: "name", order: "ASC" }}
      perPage={25}
    >
      <DataTable rowClick="edit">
        <DataTable.Col source="name" />
        <DataTable.Col source="naic_code" label="NAIC" />
        <DataTable.Col source="claims_phone" label="Claims phone" />
        <DataTable.Col source="claims_email" label="Claims email" />
        <DataTable.Col source="website" />
      </DataTable>
    </List>
  );
}
