import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "*.trycloudflare.com",
    "trycloudflare.com",
    "cozy-delta-bsqr.here.now",
    "*.here.now",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://cozy-delta-bsqr.here.now https://sable-hollow-2jgv.here.now https://*.here.now https://here.now https://*.up.railway.app https://*.railway.app https://*.onrender.com",
          },
        ],
      },
    ];
  },
  serverExternalPackages: [
    "@whiskeysockets/baileys",
    "playwright",
    "whatsapp-rust-bridge",
    "pino",
    "qrcode",
  ],
};

export default nextConfig;
