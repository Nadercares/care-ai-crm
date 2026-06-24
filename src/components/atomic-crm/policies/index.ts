import type { Policy } from "../types";
import { PolicyList } from "./PolicyList";
import { PolicyCreate } from "./PolicyCreate";
import { PolicyEdit } from "./PolicyEdit";

export default {
  list: PolicyList,
  create: PolicyCreate,
  edit: PolicyEdit,
  recordRepresentation: (record: Policy) =>
    record.policy_number
      ? `${record.policy_number}${record.policy_type ? ` (${record.policy_type})` : ""}`
      : `Policy #${record.id}`,
};
