import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { upgradeSelection } from './upgrade-selection.mjs';

test('existing site selection upgrade preserves content, previews writes, and rejects unknown wiring before writes', () => {
  const site = mkdtempSync(join(tmpdir(), 'selection-upgrade-'));
  const write = (file, text) => { mkdirSync(dirname(join(site, file)), {recursive: true}); writeFileSync(join(site, file), text); };
  const read = file => readFileSync(join(site, file), 'utf8');
  const config = `import type { NextConfig } from "next";
const securityHeaders = [{key: 'X-Frame-Options', value: 'DENY'}, {key: 'Content-Security-Policy', value: ["default-src 'self'", "frame-ancestors 'none'"].join('; ')}];
const nextConfig: NextConfig = {async headers() {return [{source: '/(.*)', headers: securityHeaders}]}};
export default nextConfig;`;
  const layout = `import Header from '@/components/Header';
export default async function LocaleLayout({children}: {children: React.ReactNode}) {
return <html lang="da"><head><meta name="custom" content="preserved" /></head><body className="brand"><Header />{children}<footer>Company footer</footer></body></html>;
}`;
  const mirror = `import {absolutiseSocialImages} from '@/lib/mirror/head';
const SITE_URL = 'https://example.test';
export function generateStaticParams() {return [];}
export function GET() {const withForm = '<html><head></head><body>Existing mirror content</body></html>';
const html = absolutiseSocialImages(withForm, SITE_URL);
return new Response(html);}`;
  try {
    write('next.config.ts', config);
    write('src/app/[locale]/layout.tsx', layout);
    write('src/app/api/mirror-page/[[...path]]/route.ts', mirror);
    write('src/mirror/pages/index.html', '<h1>Existing captured page</h1>');
    write('messages/da.json', '{"title":"Existing customer text"}');
    assert.equal(upgradeSelection(site).length, 5);
    assert.equal(read('next.config.ts'), config);
    assert.equal(existsSync(join(site, 'src/lib/selection/bridge.ts')), false);
    write('next.config.ts', config.replace("value: 'DENY'", "value: 'SAMEORIGIN'"));
    assert.throws(() => upgradeSelection(site, {apply: true}), /Manual selection integration/);
    assert.equal(existsSync(join(site, 'src/lib/selection/bridge.ts')), false);
    assert.equal(read('src/app/[locale]/layout.tsx'), layout);
    write('next.config.ts', config);
    assert.equal(upgradeSelection(site, {apply: true}).length, 5);
    assert.deepEqual(upgradeSelection(site, {apply: true}), []);
    assert.match(read('next.config.ts'), /selectionBridge.frameAncestors/);
    const changedLayout = read('src/app/[locale]/layout.tsx');
    assert.ok(changedLayout.indexOf('dangerouslySetInnerHTML') < changedLayout.indexOf('<body'));
    assert.match(changedLayout, /<meta name="custom" content="preserved" \/>/);
    assert.match(changedLayout, /<body className="brand"><Header \/>\{children\}<footer>Company footer<\/footer>/);
    assert.match(read('src/app/api/mirror-page/[[...path]]/route.ts'), /const html = injectSelectionBridge\(absolutiseSocialImages\(withForm, SITE_URL\)\)/);
    assert.equal(read('src/mirror/pages/index.html'), '<h1>Existing captured page</h1>');
    assert.equal(read('messages/da.json'), '{"title":"Existing customer text"}');
  } finally { rmSync(site, {recursive: true, force: true}); }
});
