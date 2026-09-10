import createMiddleware from 'next-intl/middleware';
import {NextResponse, type NextRequest} from 'next/server';
import {routing} from './i18n/routing';
import {MIRROR_PATHS} from './mirror/index';
import {TRAILING_SLASH} from './lib/site-routing-config';
import {SITE_DOMAIN} from './lib/site-config';
import {isIndexableHost} from './lib/seo/indexable-host';

const intl = createMiddleware(routing);

/** Non-production hosts must not be indexed (see isIndexableHost). Applied to
 *  every proxied response — template pages and mirrored pages alike. */
function withIndexingGuard(request: NextRequest, response: NextResponse): NextResponse {
  if (!isIndexableHost(request.headers.get('host'), SITE_DOMAIN)) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return response;
}

/** Mirrored pages (replicate mode) keep the original's URLs verbatim, so they
 *  must never be locale-prefixed or redirected by next-intl. They are served by
 *  the prerendered handler under /api/mirror-page, reached only through this
 *  rewrite; the handler's canonical points back at the public URL. */
export const MIRROR_HANDLER_PREFIX = '/api/mirror-page';

export default function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith(MIRROR_HANDLER_PREFIX)) return NextResponse.next();
  const key = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  if (MIRROR_PATHS.has(key)) {
    const url = request.nextUrl.clone();
    const inner = key === '/' ? '' : key;
    url.pathname = `${MIRROR_HANDLER_PREFIX}${inner}${TRAILING_SLASH ? '/' : ''}`;
    return withIndexingGuard(request, NextResponse.rewrite(url));
  }
  return withIndexingGuard(request, intl(request));
}

export const config = {
  // Exclude API, Next internals, and ANY path containing a dot (robots.txt,
  // sitemap.xml, llms.txt, favicon.ico, and every static asset under
  // /images, /videos). Without the dot-exclusion the proxy locale-prefixes
  // /sitemap.xml → /da/sitemap.xml (a route that doesn't exist → 404), which
  // silently breaks the very robots/sitemap that robots.ts points crawlers at.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
};
