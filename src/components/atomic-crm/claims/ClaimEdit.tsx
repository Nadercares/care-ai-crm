import { Edit } from "@/components/admin/edit";
import { SimpleForm } from "@/components/admin/simple-form";
import { Card, CardContent } from "@/components/ui/card";

import { ClaimInputs } from "./ClaimInputs";

export function ClaimEdit() {
  return (
    <Edit redirect="show" mutationMode="pessimistic">
      <Card>
        <CardContent className="pt-6">
          <SimpleForm sanitizeEmptyValues>
            <ClaimInputs />
          </SimpleForm>
        </CardContent>
      </Card>
    </Edit>
  );
}
