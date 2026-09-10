import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import { withBotId } from 'botid/next/config';
import { resolve } from 'path';
import { TRAILING_SLASH } from './src/lib/site-routing-config';
import { MIRROR_FRAME_SRC, MIRROR_REDIRECTS } from './src/mirror/index';
import { selectionBridgeConfig } from './src/lib/selection/config';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const projectRoot = resolve(import.meta.dirname);
const selectionBridge = selectionBridgeConfig();

const securityHeaders = [
  ...(selectionBridge.xFrameOptions ? [{
    key: 'X-Frame-Options',
    value: selectionBridge.xFrameOptions,
  }] : []),
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    // Starter CSP — tighten per-site based on actual script/style sources needed.
    // The web-designer agent should adjust this when adding third-party scripts.
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://va.vercel-scripts.com",
      // Mirrored sites' widget libraries spin up blob: workers (image decoding, lazy loading).
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://vitals.vercel-insights.com https://va.vercel-scripts.com",
      // Mirrored pages (replicate mode) embed the original's maps and videos;
      // the installer records their origins. Empty on a redesign site.
      ...(MIRROR_FRAME_SRC.length ? [`frame-src ${MIRROR_FRAME_SRC.join(' ')}`] : []),
      selectionBridge.frameAncestors,
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    // Next sizes static-generation workers from the CPU count; on a 16-core
    // machine that is 15 workers at over a gigabyte each, which took a whole
    // desktop session down mid-pipeline. Four is plenty for a site this size.
    cpus: 4,
  },
  trailingSlash: TRAILING_SLASH,
  // Mirrored sites (replicate mode): a kept script may build a root-relative
  // resource URL at runtime (`/wp-content/plugins/x/flags/da.svg`) that no
  // attribute rewrite could see. After public files and routes have had their
  // chance, any unmatched path with a file extension resolves to the mirrored
  // origin tree; on a redesign site the tree is empty and the 404 is unchanged.
  // Mirrored sites: the original's own permanent redirects, carried so the
  // inbound links that held the old slugs keep landing. Empty on a redesign
  // site; the redirect-mapping step appends its own entries to this list.
  async redirects() {
    return [
      ...MIRROR_REDIRECTS.map((r) => ({ ...r, permanent: true })),
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        {
          source: '/:path(.*\\.(?:svg|png|jpe?g|gif|webp|avif|ico|css|js|mjs|json|woff2?|ttf|otf|eot|mp4|webm|mp3|pdf|xml|txt))',
          destination: '/_mirror/origin/:path',
        },
      ],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  webpack: (config) => {
    // Ensure CSS @import "tailwindcss" resolves from the project's node_modules,
    // even if the dev server is started from a parent directory.
    config.resolve.modules = [
      resolve(projectRoot, 'node_modules'),
      ...(config.resolve.modules || ['node_modules']),
    ];
    return config;
  },
};

export default withBotId(withNextIntl(nextConfig));
