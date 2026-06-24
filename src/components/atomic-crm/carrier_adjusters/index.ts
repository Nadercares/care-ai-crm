import type { CarrierAdjuster } from "../types";

export default {
  recordRepresentation: (record: CarrierAdjuster) => {
    const name = [record.first_name, record.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    const license = record.license_number ? ` (${record.license_number})` : "";
    return name ? `${name}${license}` : `Adjuster #${record.id}`;
  },
};
