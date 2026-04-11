import { CRM } from "@/components/atomic-crm/root/CRM";
import { ChatPanel } from "./components/care-ai/ChatPanel";
import { careI18nProvider } from "./api/i18nProvider";

const App = () => (
  <>
    <CRM title="CARE AI CRM" i18nProvider={careI18nProvider} />
    <ChatPanel />
  </>
);

export default App;
