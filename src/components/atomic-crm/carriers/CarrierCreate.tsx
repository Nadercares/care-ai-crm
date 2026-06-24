import { Create } from "@/components/admin/create";
import { SimpleForm } from "@/components/admin/simple-form";
import { Card, CardContent } from "@/components/ui/card";

import { CarrierInputs } from "./CarrierInputs";

export function CarrierCreate() {
  return (
    <Create redirect="list">
      <Card>
        <CardContent className="pt-6">
          <SimpleForm sanitizeEmptyValues>
            <CarrierInputs />
          </SimpleForm>
        </CardContent>
      </Card>
    </Create>
  );
}
