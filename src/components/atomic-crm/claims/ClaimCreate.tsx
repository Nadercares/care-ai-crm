import { Create } from "@/components/admin/create";
import { SimpleForm } from "@/components/admin/simple-form";
import { Card, CardContent } from "@/components/ui/card";

import { ClaimInputs } from "./ClaimInputs";

export function ClaimCreate() {
  return (
    <Create redirect="show">
      <Card>
        <CardContent className="pt-6">
          <SimpleForm defaultValues={{ status: "intake" }} sanitizeEmptyValues>
            <ClaimInputs />
          </SimpleForm>
        </CardContent>
      </Card>
    </Create>
  );
}
