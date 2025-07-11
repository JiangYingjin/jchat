import webpack from "webpack";

console.log("[Next] build mode standalone");

const disableChunk = !!process.env.DISABLE_CHUNK;
console.log("[Next] build with chunk: ", !disableChunk);

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });
    if (disableChunk) {
      config.plugins.push(
        new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })
      );
    }

    config.resolve.fallback = {
      child_process: false,
    };

    return config;
  },
  output: "standalone",
  images: {
    unoptimized: false,
  },
  experimental: {
    forceSwcTransforms: true,
  },
};

const CorsHeaders = [
  { key: "Access-Control-Allow-Credentials", value: "true" },
  { key: "Access-Control-Allow-Origin", value: "*" },
  {
    key: "Access-Control-Allow-Methods",
    value: "*",
  },
  {
    key: "Access-Control-Allow-Headers",
    value: "*",
  },
  {
    key: "Access-Control-Max-Age",
    value: "86400",
  },
];

nextConfig.headers = async () => {
  return [
    {
      source: "/api/:path*",
      headers: CorsHeaders,
    },
  ];
};

nextConfig.rewrites = async () => {
  const ret = [
    {
      source: "/google-fonts/:path*",
      destination: "https://fonts.googleapis.com/:path*",
    },
  ];

  return {
    beforeFiles: ret,
  };
};

export default nextConfig;
