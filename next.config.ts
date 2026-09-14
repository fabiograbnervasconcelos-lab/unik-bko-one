import type { NextConfig } from "next";

const publicHosts = (process.env.PUBLIC_HOSTS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", ...publicHosts],
  serverExternalPackages: [
    "@whiskeysockets/baileys",
    "playwright",
    "whatsapp-rust-bridge",
    "pino",
    "qrcode",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://*.here.now https://here.now",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
