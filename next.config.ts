import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'export',          // static SPA: all security is enforced in Postgres (RLS + SECURITY DEFINER API)
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};
export default config;
