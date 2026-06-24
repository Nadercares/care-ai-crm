import type { Claim } from "../types";
import { ClaimList } from "./ClaimList";
import { ClaimCreate } from "./ClaimCreate";
import { ClaimEdit } from "./ClaimEdit";
import { ClaimShow } from "./ClaimShow";

export default {
  list: ClaimList,
  create: ClaimCreate,
  edit: ClaimEdit,
  show: ClaimShow,
  recordRepresentation: (record: Claim) =>
    record.claim_number ||
    record.internal_claim_number ||
    `Claim #${record.id}`,
};
