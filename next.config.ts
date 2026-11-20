import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 上传接口允许 100MB 文件；额外空间用于 multipart 表单边界及字段。
    proxyClientMaxBodySize: "105mb",
  },
};

export default nextConfig;
