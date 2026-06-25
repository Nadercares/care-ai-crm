import { Edit } from "@/components/admin/edit";
import { SimpleForm } from "@/components/admin/simple-form";
import { Card, CardContent } from "@/components/ui/card";

import { PolicyInputs } from "./PolicyInputs";

export function PolicyEdit() {
  return (
    <Edit redirect="list" mutationMode="pessimistic">
      <Card>
        <CardContent className="pt-6">
          <SimpleForm sanitizeEmptyValues>
            <PolicyInputs />
          </SimpleForm>
        </CardContent>
      </Card>
    </Edit>
  );
}
