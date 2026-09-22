import { Dashboard } from "@/components/dashboard";
import { WhatsAppCrmPanel } from "@/components/whatsapp-crm-panel";
import { isWhatsAppCrmMode } from "@/lib/app-mode";

/** APP_MODE vem do Railway em runtime — não pré-renderizar no build Docker. */
export const dynamic = "force-dynamic";

export default function Home() {
  if (isWhatsAppCrmMode()) {
    return <WhatsAppCrmPanel />;
  }
  return <Dashboard />;
}
