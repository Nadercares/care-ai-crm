import type { Carrier } from "../types";
import { CarrierList } from "./CarrierList";
import { CarrierCreate } from "./CarrierCreate";
import { CarrierEdit } from "./CarrierEdit";

export default {
  list: CarrierList,
  create: CarrierCreate,
  edit: CarrierEdit,
  recordRepresentation: (record: Carrier) => record.name,
};
