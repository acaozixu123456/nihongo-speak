import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pre-made recordings are named by a hash of sentence + voice, so a file never changes.
  async headers() {
    return [{ source: "/voice/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
};

export default nextConfig;
