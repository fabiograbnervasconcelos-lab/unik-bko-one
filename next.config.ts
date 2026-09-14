import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  serverExternalPackages: [
    "@whiskeysockets/baileys",
    "playwright",
    "whatsapp-rust-bridge",
    "pino",
    "qrcode",
  ],
};

export default nextConfig;
