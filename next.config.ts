import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@whiskeysockets/baileys",
    "playwright",
    "whatsapp-rust-bridge",
    "pino",
    "qrcode",
  ],
};

export default nextConfig;
