import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const template = fileURLToPath(new URL('../', import.meta.url));
const imports = 'import { selectionBridgeScript } from "@/lib/selection/bridge";\nimport { selectionBridgeConfig } from "@/lib/selection/config";\n';
const layoutSetup = 'const selectionBridge = selectionBridgeConfig();\nconst selectionBridgeSource = selectionBridge.origin ? selectionBridgeScript(selectionBridge.origin) : null;\n\n';
const scriptTag = '{selectionBridgeSource ? <script dangerouslySetInnerHTML={{ __html: selectionBridgeSource }} /> : null}';

function replaceOnce(source, pattern, replacement, file) {
  const matches = typeof pattern === 'string' ? source.split(pattern).length - 1 : [...source.matchAll(new RegExp(pattern.source, 'g'))].length;
  if (matches !== 1) throw new Error(`Manual selection integration required: ${file}`);
  return source.replace(pattern, replacement);
}

export function planSelectionUpgrade(siteDir) {
  const site = realpathSync(siteDir);
  if (site === realpathSync(template)) throw new Error('Choose an existing site, not the kit template');
  const changes = [];
  function read(file) {
    const path = join(site, file);
    for (let part = path; part !== site; part = dirname(part)) {
      if (!part.startsWith(site + sep)) throw new Error('Invalid site path');
      if (lstatSync(part, {throwIfNoEntry: false})?.isSymbolicLink()) throw new Error(`Symlink requires manual integration: ${file}`);
    }
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  }
  function edit(file, transform) {
    const before = read(file);
    if (before === null) throw new Error(`Missing site file: ${file}`);
    const after = transform(before);
    if (after !== before) changes.push({file, before, after});
  }
  for (const name of ['bridge.ts', 'config.ts']) {
    const file = `src/lib/selection/${name}`;
    const before = read(file);
    const after = readFileSync(join(template, file), 'utf8');
    if (before !== null && before !== after) throw new Error(`Customized selection file requires manual integration: ${file}`);
    if (before === null) changes.push({file, before, after});
  }
  edit('next.config.ts', source => {
    if (source.includes('selectionBridgeConfig')) {
      if (!source.includes('selectionBridge.frameAncestors') || !source.includes('selectionBridge.xFrameOptions')) throw new Error('Incomplete selection headers');
      return source;
    }
    source = replaceOnce(source, /\{\s*key:\s*['"]X-Frame-Options['"],\s*value:\s*['"]DENY['"],?\s*\}/,
      "...(selectionBridge.xFrameOptions ? [{key: 'X-Frame-Options', value: selectionBridge.xFrameOptions}] : [])", 'next.config.ts');
    source = replaceOnce(source, '"frame-ancestors \'none\'"', 'selectionBridge.frameAncestors', 'next.config.ts');
    return "import { selectionBridgeConfig } from './src/lib/selection/config';\nconst selectionBridge = selectionBridgeConfig();\n" + source;
  });
  edit('src/app/[locale]/layout.tsx', source => {
    if (source.includes('selectionBridgeSource')) {
      if (!source.includes(scriptTag)) throw new Error('Incomplete selection layout');
      return source;
    }
    source = replaceOnce(source, 'export default async function LocaleLayout', layoutSetup + 'export default async function LocaleLayout', 'locale layout');
    if (source.includes('<head>')) source = replaceOnce(source, '<head>', `<head>\n        ${scriptTag}`, 'locale head');
    else {
      if (/<head\b/.test(source)) throw new Error('Custom head requires manual selection integration');
      source = replaceOnce(source, /<body\b/, `<head>${scriptTag}</head>\n      <body`, 'locale body');
    }
    return imports + source;
  });
  const mirror = 'src/app/api/mirror-page/[[...path]]/route.ts';
  if (read(mirror) !== null) edit(mirror, source => {
    if (source.includes('injectSelectionBridge')) {
      if (!source.includes('const html = injectSelectionBridge(absolutiseSocialImages(withForm, SITE_URL));')) throw new Error('Incomplete mirror selection integration');
      return source;
    }
    const current = readFileSync(join(template, mirror), 'utf8');
    const start = current.indexOf('const selectionBridge =');
    const end = current.indexOf('export function generateStaticParams()', start);
    if (start < 0 || end < 0) throw new Error('Kit selection integration is unavailable');
    source = replaceOnce(source, 'export function generateStaticParams()', current.slice(start, end) + 'export function generateStaticParams()', mirror);
    source = replaceOnce(source, 'const html = absolutiseSocialImages(withForm, SITE_URL);',
      'const html = injectSelectionBridge(absolutiseSocialImages(withForm, SITE_URL));', mirror);
    return imports + source;
  });
  return {site, changes};
}

export function upgradeSelection(siteDir, {apply = false} = {}) {
  const plan = planSelectionUpgrade(siteDir);
  if (apply) {
    for (const {file, after} of plan.changes) {
      const path = join(plan.site, file);
      mkdirSync(dirname(path), {recursive: true});
      writeFileSync(path, after);
    }
  }
  return plan.changes.map(({file}) => file);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length < 1 || args.length > 2 || (args[1] && args[1] !== '--apply')) throw new Error('Usage: node upgrade-selection.mjs SITE_DIRECTORY [--apply]');
    const files = upgradeSelection(args[0], {apply: args[1] === '--apply'});
    console.log(files.length ? `${args[1] ? 'Updated' : 'Would update'}:\n${files.join('\n')}` : 'Selection integration already present');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
