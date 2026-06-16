import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "mysql2", "mssql", "papaparse", "xlsx"],
  experimental: {
    serverActions: {
      allowedOrigins: ["*"],
      bodySizeLimit: "110mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        port: "",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
