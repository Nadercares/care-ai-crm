import { Edit } from "@/components/admin/edit";
import { SimpleForm } from "@/components/admin/simple-form";
import { Card, CardContent } from "@/components/ui/card";

import { CarrierInputs } from "./CarrierInputs";

export function CarrierEdit() {
  return (
    <Edit redirect="list" mutationMode="pessimistic">
      <Card>
        <CardContent className="pt-6">
          <SimpleForm sanitizeEmptyValues>
            <CarrierInputs />
          </SimpleForm>
        </CardContent>
      </Card>
    </Edit>
  );
}
