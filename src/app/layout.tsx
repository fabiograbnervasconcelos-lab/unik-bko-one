import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { isWhatsAppCrmMode } from "@/lib/app-mode";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/** APP_MODE vem do Railway em runtime — metadata não pode ser fixa no build. */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  if (isWhatsAppCrmMode()) {
    return {
      title: "Unik WhatsApp CRM — Robô vendedores NIO",
      description:
        "Robô WhatsApp para vendedores consultarem o CRM NIO e faturas. Número do robô: 48 99645-0101.",
    };
  }
  return {
    title: "Unik BKO One — CRM × GED360",
    description:
      "Consulta Resultado da Análise no GED360, avisa de hora em hora no WhatsApp 48 99194-0908 e nos grupos BKO One Urgente e Gerentes One.",
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`dark ${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
