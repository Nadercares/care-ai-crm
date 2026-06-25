import { EmailTriageList } from "./EmailTriageList";

export default {
  list: EmailTriageList,
  recordRepresentation: (record: { subject?: string; id: number }) =>
    record.subject || `Thread ${record.id}`,
};
