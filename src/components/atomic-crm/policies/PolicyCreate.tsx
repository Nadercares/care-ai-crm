import { Create } from "@/components/admin/create";
import { SimpleForm } from "@/components/admin/simple-form";
import { Card, CardContent } from "@/components/ui/card";

import { PolicyInputs } from "./PolicyInputs";

export function PolicyCreate() {
  return (
    <Create redirect="list">
      <Card>
        <CardContent className="pt-6">
          <SimpleForm sanitizeEmptyValues>
            <PolicyInputs />
          </SimpleForm>
        </CardContent>
      </Card>
    </Create>
  );
}
