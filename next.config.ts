import type { NextConfig } from 'next';
import type { WebpackConfigContext } from 'next/dist/server/config-shared'; // 导入 WebpackConfigContext 类型
import type { Header, Rewrite } from 'next/dist/lib/load-custom-routes'; // 导入 Header 和 Rewrite 类型

const nextConfig: NextConfig = {
    webpack(config: any, { isServer }: WebpackConfigContext) {
        config.module.rules.push({
            test: /\.svg$/,
            use: ["@svgr/webpack"], // 将 SVG 文件转换为 React 组件
        });
        // 仅在客户端构建时才需要设置 fallback
        if (!isServer) {
            config.resolve.fallback = {
                child_process: false,
                // 如果还有其他需要 polyfill 的模块，可以继续添加
                // fs: false,
                // net: false,
                // tls: false,
            };
        }
        return config;
    },
    turbopack: {
        rules: {
            '*.svg': {
                loaders: ['@svgr/webpack'],
                as: '*.js',
            },
        },
    },
    output: "standalone",
    images: { unoptimized: false },
    allowedDevOrigins: ["*.jyj.cx"],
};

const CorsHeaders: Header["headers"] = [
    { key: "Access-Control-Allow-Credentials", value: "true" },
    { key: "Access-Control-Allow-Origin", value: "*" },
    { key: "Access-Control-Allow-Methods", value: "*" },
    { key: "Access-Control-Allow-Headers", value: "*" },
    { key: "Access-Control-Max-Age", value: "86400" },
];

nextConfig.headers = async () => {
    return [{ source: "/api/:path*", headers: CorsHeaders }];
};

nextConfig.rewrites = async () => {
    const ret: Rewrite[] = [
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
