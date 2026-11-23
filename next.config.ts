import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages:["playwright-core","yazl"],
  // Keep isolated browser rehearsals separate from an already running workspace server.
  distDir: process.env.DOCUMENT_UI_REHEARSAL === "check" ? ".next-document-check" : process.env.DOCUMENT_UI_REHEARSAL === "1" ? ".next-document-rehearsal" : ".next",
  experimental: {
    // 上传接口允许 100MB 文件；额外空间用于 multipart 表单边界及字段。
    proxyClientMaxBodySize: "105mb",
  },
};

export default nextConfig;
