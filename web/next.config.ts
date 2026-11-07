import path from "node:path";
import type { NextConfig } from "next";

const allowedDevOrigins = (process.env.NEXT_DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins,
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
