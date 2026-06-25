import { required } from "ra-core";
import { TextInput } from "@/components/admin/text-input";

export function CarrierInputs() {
  return (
    <div className="space-y-4 w-full">
      <TextInput source="name" validate={required()} helperText={false} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TextInput source="naic_code" label="NAIC code" />
        <TextInput source="website" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TextInput source="claims_phone" />
        <TextInput source="claims_email" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TextInput source="claims_fax" />
        <TextInput source="claims_address" />
      </div>
      <TextInput source="notes" multiline rows={3} />
    </div>
  );
}
