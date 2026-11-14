import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync, realpathSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve, relative, dirname, join, sep } from "node:path";

export const DESIGN_CONTRACT = "1.99.0";
export const STAGES = ["concept", "representative", "final"];
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const jsonHash = (value) => hash(JSON.stringify(value));
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

export function inside(root, path) {
  const abs = resolve(root, path);
  const rel = relative(resolve(root), abs);
  if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(root) === abs) throw new Error(`path outside file scope: ${path}`);
  let ancestor = abs;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  {
    const actual = relative(realpathSync(root), realpathSync(ancestor));
    if (actual === ".." || actual.startsWith(`..${sep}`)) throw new Error(`symlink outside site: ${path}`);
  }
  return abs;
}

/** The machine's local minute, `YYYY-MM-DDThh:mm` — the form of `date +%Y-%m-%dT%H:%M`
 *  that every other decisions.md entry is stamped with; resumption orders by it. */
export function localMinute(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  renameSync(temp, path);
}

export function filesUnder(root, dir) {
  const abs = resolve(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? filesUnder(root, path) : entry.isFile() ? [path] : [];
  }).sort();
}

export function fileHashes(root, paths) {
  return Object.fromEntries([...new Set(paths)].sort().map((path) => {
    try { return [path, hash(readFileSync(inside(root, path)))]; }
    catch (error) { throw new Error(`required input unreadable: ${path}: ${error.code || error.message}`); }
  }));
}

const markers = ["run-contract.json", "build-manifest.json", "design-manifest.json", "design-review.json"];
export function runIdentity(root) {
  const found = markers.filter((file) => existsSync(join(root, ".redesign-state", file)))
    .map((file) => ({ file, data: readJson(join(root, ".redesign-state", file)) }));
  if (found.some(({ file, data }) => (file === "run-contract.json" || data.schemaVersion > 1) && data.schemaVersion !== 2)) throw new Error("unsupported run schema; keep its original kit");
  if (!found.some(({ data }) => data.schemaVersion === 2)) return { schemaVersion: 1 };
  const contract = found.find(({ file }) => file === "run-contract.json")?.data;
  const index = found.find(({ file }) => file === "design-review.json")?.data;
  if (!contract || !index || contract.schemaVersion !== 2 || !contract.runId || index.runId !== contract.runId)
    throw new Error("schema-2 run identity is incomplete; restore the matching run contract and review index");
  for (const { file, data } of found) {
    if (data.schemaVersion !== 2 || data.runId !== contract.runId) throw new Error(`run identity mismatch: ${file}`);
  }
  return contract;
}

export function classifyRun(root) {
  try {
    const identity = runIdentity(root);
    if (identity.schemaVersion === 2) return { state: "active", ...identity };
    const state = join(root, ".redesign-state");
    for (const name of ["build-manifest.json", "publish-gate.md"]) {
      if (existsSync(join(state, name))) return { state: "existing", reason: name };
    }
    for (const name of ["brand.md", "design-direction.md"]) {
      if (!existsSync(join(root, name))) continue;
      const text = readFileSync(join(root, name), "utf8");
      if (text.trim() && !/Not Yet Populated|\{\{COMPANY_NAME\}\}/i.test(text)) return { state: "existing", reason: name };
    }
    for (const name of ["decisions.md", "review-findings.md", "compliance-log.md"]) {
      if (existsSync(join(state, name)) && /^\d{4}-\d\d-\d\dT/m.test(readFileSync(join(state, name), "utf8"))) return { state: "existing", reason: name };
    }
    const pages = filesUnder(root, "src/app").filter((path) => /(?:^|\/)page\.tsx$/.test(path));
    const starterPages = new Set(["src/app/[locale]/page.tsx", "src/app/[locale]/[...rest]/page.tsx"]);
    if (pages.some((path) => !starterPages.has(path))) return { state: "existing", reason: "non-template routes" };
    const home = join(root, "src/app/[locale]/page.tsx");
    if (existsSync(home) && !readFileSync(home, "utf8").includes("Your project is ready. Open Claude Code")) return { state: "existing", reason: "built homepage" };
    return { state: "new" };
  } catch (error) { return { state: "unknown", reason: error.message }; }
}

export function initializeRun(root, plugin, config = {}) {
  const state = classifyRun(root);
  if (state.state === "active") return state;
  if (state.state !== "new") throw new Error(`refusing to initialize ${state.state} site: ${state.reason}; use an isolated fresh copy`);
  const contract = { schemaVersion: 2, mode: "redesign", runId: randomUUID(), plugin, designContract: DESIGN_CONTRACT, provider: config.provider || "configured", models: config.models || {}, createdAt: new Date().toISOString() };
  atomicJson(join(root, ".redesign-state/run-contract.json"), contract);
  atomicJson(join(root, ".redesign-state/design-review.json"), { schemaVersion: 2, runId: contract.runId, stages: {} });
  return contract;
}

export function designManifest(root) {
  const contract = runIdentity(root);
  if (contract.schemaVersion !== 2) throw new Error("design evidence requires an initialized schema-2 run");
  const manifest = readJson(join(root, ".redesign-state/design-manifest.json"));
  if (manifest.schemaVersion !== 2 || manifest.runId !== contract.runId) throw new Error("design manifest run mismatch");
  if (!manifest.primaryLocale || !manifest.locales?.includes(manifest.primaryLocale)) throw new Error("primary locale missing from locales");
  if (!Array.isArray(manifest.concepts) || manifest.concepts.length !== 3 || new Set(manifest.concepts.map((c) => c.id)).size !== 3) throw new Error("exactly three distinct concepts required");
  for (const c of manifest.concepts) {
    if (!/^[a-z0-9-]+$/.test(c.id) || !c.path?.startsWith(`.redesign-state/concepts/${c.id}/`)) throw new Error("invalid concept path/id");
    inside(root, c.path);
  }
  if (!Array.isArray(manifest.routes) || !manifest.routes.some((r) => r.route === "/")) throw new Error("route inventory must include homepage");
  if (new Set(manifest.routes.map((r) => r.route)).size !== manifest.routes.length) throw new Error("duplicate design routes");
  if (manifest.routes.some((r) => !r.route.startsWith("/") || !r.family)) throw new Error("routes require absolute route and composition family");
  if (!Array.isArray(manifest.slots) || !Array.isArray(manifest.assets)) throw new Error("slots and consumed assets must be explicit arrays");
  return manifest;
}

export function requiredCoverage(manifest, stage) {
  if (!STAGES.includes(stage)) throw new Error(`unknown design stage ${stage}`);
  if (stage === "concept") return manifest.concepts.flatMap((c) => [1440, 390].map((width) => ({ target: c.id, locale: manifest.primaryLocale, width })));
  const representatives = manifest.routes.filter((r) => r.route === "/" || r.representative);
  if (manifest.routes.length > 1 && representatives.length < 2) throw new Error("representative inner route required");
  const families = [...new Set(manifest.routes.map((r) => r.family))];
  const targets = stage === "representative" ? representatives : manifest.routes.filter((r) => r.route === "/" || r.core || families.some((family) => manifest.routes.find((item) => item.family === family) === r));
  const locales = [...new Set([manifest.primaryLocale, manifest.longestLocale || manifest.primaryLocale])];
  if (locales.some((locale) => !manifest.locales.includes(locale))) throw new Error("longest locale missing from locales");
  return targets.flatMap((r) => locales.flatMap((locale) => [1440, 390].map((width) => ({ target: r.route, locale, width }))));
}

export function visualAssets(root, manifest, { concepts = false } = {}) {
  const paths = new Set(concepts ? [...manifest.assets, ...manifest.concepts.flatMap((c) => c.assets || [])] : [...manifest.assets, ...manifest.slots.flatMap((s) => s.assetPaths || [])]);
  const sources = concepts ? manifest.concepts.flatMap((c) => filesUnder(root, dirname(c.path))) : [...filesUnder(root, "src"), ...filesUnder(root, "messages")];
  for (const file of sources) {
    if (!/\.(tsx?|jsx?|css|json|mjs|html)$/.test(file)) continue;
    const text = readFileSync(inside(root, file), "utf8");
    for (const match of text.matchAll(/\/(?:images|fonts|video)\/[^"'`\s)<>?#]+/g)) {
      if (/https?:\/\/[^\s"\'`<>]*$/.test(text.slice(0, match.index))) continue;
      if (!/[${}]/.test(match[0])) paths.add(`public${match[0]}`);
    }
  }
  return [...paths].sort();
}

// What the concept round was made from. These must hold still while the studies
// are captured and judged, but a recorded round judges the studies: a later fact
// repair or plan reconciliation does not reopen it.
const COMPANY_INPUTS = ["brand.md", "content-strategy.md", "SITE_PLAN_TEMPLATE.md"];
const studyFiles = (files) => Object.fromEntries(Object.entries(files).filter(([path]) => !COMPANY_INPUTS.includes(path)));

export function designInputs(root, stage) {
  const manifest = designManifest(root);
  // Concepts need the company and its messaging, not the page list: the site
  // planner runs beside the concept round, so its plan is not a concept input.
  const required = COMPANY_INPUTS;
  let paths;
  let config;
  if (stage === "concept") {
    paths = [...required.filter((path) => path !== "SITE_PLAN_TEMPLATE.md"), ...manifest.concepts.flatMap((c) => filesUnder(root, dirname(c.path))), ...visualAssets(root, manifest, { concepts: true })];
    config = { concepts: manifest.concepts, primaryLocale: manifest.primaryLocale };
  } else {
    if (!manifest.concepts.some((c) => c.id === manifest.selectedId)) throw new Error("selected concept missing");
    paths = [...required, "design-direction.md", "design-system.md", "IMAGE_SLOTS.md", ...manifest.routes.flatMap((r) => r.contentPaths || []), ...filesUnder(root, "src"), ...filesUnder(root, "messages"), ...visualAssets(root, manifest)];
    for (const name of ["next.config.ts", "package.json"]) if (existsSync(join(root, name))) paths.push(name);
    config = manifest;
  }
  const files = fileHashes(root, paths);
  const coverage = requiredCoverage(manifest, stage);
  return { inputHash: jsonHash({ files, config, coverage, contract: DESIGN_CONTRACT }), files, coverage };
}

export function productionEvidence(root, baseUrl) {
  const evidence = readJson(join(root, ".redesign-state/production-build.json"));
  if (evidence.inputHash !== designInputs(root, "final").inputHash || evidence.buildId !== readFileSync(join(root, ".next/BUILD_ID"), "utf8").trim()) throw new Error("production build is stale; run dev-server serve --build");
  if (baseUrl && new URL(evidence.baseUrl).origin !== new URL(baseUrl).origin) throw new Error("capture URL differs from the recorded production server");
  return evidence;
}

const productionIdentity = evidence => jsonHash({ inputHash: evidence.inputHash, buildId: evidence.buildId, origin: new URL(evidence.baseUrl).origin });

function checkReport(report, manifest, stage) {
  if (!["pass", "revise", "blocked"].includes(report.verdict)) throw new Error("review must have pass/revise/blocked verdict");
  if (!Array.isArray(report.findings) || !Array.isArray(report.dimensions) || report.dimensions.length < 7) throw new Error("review requires findings and seven observed dimensions");
  if (report.dimensions.some((d) => !d.dimension || !d.observation || !(d.score >= 1 && d.score <= 5))) throw new Error("unanchored design dimension");
  if (report.verdict !== "pass") return;
  if (report.findings.some((f) => f.essential || f.severity === "critical")) throw new Error("essential design findings cannot pass");
  if (!report.portfolioComparison || typeof report.portfolioComparison.available !== "boolean" || !report.portfolioComparison.notes) throw new Error("portfolio comparison or recorded absence required");
  if (manifest.portfolioAvailable && !report.portfolioComparison.available) throw new Error("available portfolio must be compared");
  if (!report.fontChecks?.length || report.fontChecks.some((f) => !f.loaded || !f.languageCoverage || !f.license)) throw new Error("font loading, language and license evidence required");
  if (stage === "concept") {
    if (!manifest.concepts.some((c) => c.id === report.winner)) throw new Error("winner must name a rendered concept");
    if (!report.pairwiseDifferences || report.pairwiseDifferences.length < 3) throw new Error("three pairwise concept comparisons required");
  }
}

export function essentialFailures(root, manifest, stage, report) {
  if (stage === "concept") return [];
  if (manifest.slotsSourceHash !== hash(readFileSync(join(root, "IMAGE_SLOTS.md")))) return ["slot inventory is not synchronized; run design-review sync-slots"];
  const routes = new Set(requiredCoverage(manifest, stage).map((c) => c.target));
  return manifest.slots.filter((slot) => slot.essentialForDesign && (stage === "final" || !slot.route || routes.has(slot.route))).flatMap((slot) => {
    if (slot.resolution === "justified-none") {
      const reviewed = report.alternativeCompositions?.find((a) => a.slotId === slot.id && a.verdict === "pass" && a.rationale);
      return reviewed && slot.alternativeRationale ? [] : [`${slot.id}: alternative composition not reviewed`];
    }
    if (!["catalog-reuse", "image-present", "drawn-in-code"].includes(slot.resolution) || !slot.assetPaths?.length) return [`${slot.id}: asset-needed`];
    try { fileHashes(root, slot.assetPaths); return []; } catch { return [`${slot.id}: asset missing`]; }
  });
}

const coverageKey = (c) => `${c.target}:${c.locale}:${c.width}`;
export function recordDesignReview(root, { stage, captures, report, reviewer }) {
  const contract = runIdentity(root);
  const manifest = designManifest(root);
  const inputs = designInputs(root, stage);
  if (captures.inputHash !== inputs.inputHash || captures.stage !== stage || captures.runId !== contract.runId) throw new Error("render inputs are stale or belong to another run/stage");
  if (stage !== "concept" && productionIdentity(captures.production) !== productionIdentity(productionEvidence(root))) throw new Error("capture does not match the current production build");
  if (!reviewer?.model || !reviewer?.provider || !reviewer?.effort) throw new Error("reviewer provenance required");
  checkReport(report, manifest, stage);
  const missing = inputs.coverage.filter((c) => !captures.screenshots?.some((shot) => coverageKey(shot) === coverageKey(c)));
  if (missing.length) throw new Error(`missing screenshot coverage: ${missing.map(coverageKey).join(", ")}`);
  if (!/^[a-f0-9-]{36}$/.test(captures.captureId) || !captures.capturedAt) throw new Error("capture receipt missing; run design-review capture");
  const captureDir = `.redesign-state/design-captures/${captures.captureId}/`;
  if (jsonHash(readJson(inside(root, `${captureDir}capture.json`))) !== jsonHash(captures)) throw new Error("capture receipt changed; use the original capture.json");
  for (const shot of captures.screenshots) {
    if (!shot.path.startsWith(captureDir)) throw new Error("screenshot outside capture attempt");
    const bytes = readFileSync(inside(root, shot.path));
    if (hash(bytes) !== shot.hash) throw new Error(`screenshot changed: ${shot.path}`);
    if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error(`screenshot is not a PNG: ${shot.path}`);
    if (shot.status !== 200) throw new Error(`render unavailable: ${coverageKey(shot)}`);
    const selected = stage !== "concept" || shot.target === report.winner;
    if (report.verdict === "pass" && selected && (!shot.fontsReady || shot.overflow || shot.brokenImages?.length || bytes.readUInt32BE(16) !== shot.width)) throw new Error(`render not ready: ${coverageKey(shot)}`);
  }
  const essential = essentialFailures(root, manifest, stage, report);
  if (report.verdict === "pass" && essential.length) throw new Error(essential.join("; "));
  const indexPath = join(root, ".redesign-state/design-review.json");
  const index = readJson(indexPath);
  const prior = STAGES[STAGES.indexOf(stage) - 1];
  if (prior && !index.stages[prior]) throw new Error(`missing prior ${prior} review`);
  if (prior) {
    const entry = index.stages[prior];
    const previous = readJson(inside(root, entry.path));
    if (hash(readFileSync(inside(root, entry.path))) !== entry.hash || previous.report.verdict !== "pass") throw new Error(`prior ${prior} review is not passing/intact`);
    if (stage === "representative" && (conceptChoice(root)?.pick ?? previous.report.winner) !== manifest.selectedId) throw new Error("selected concept differs from the reviewed winner and from the operator's recorded pick");
  }
  const attempt = randomUUID();
  const path = `.redesign-state/design-reviews/${stage}/${attempt}.json`;
  const choice = stage === "representative" ? conceptChoice(root) : null;
  const record = { schemaVersion: 2, runId: contract.runId, producerContract: DESIGN_CONTRACT, stage, attempt, createdAt: new Date().toISOString(), ...inputs, captures, reviewer, report, essentialFailures: essential, previous: prior ? index.stages[prior] : null, ...(choice ? { choice } : {}) };
  atomicJson(inside(root, path), record);
  index.stages[stage] = { path, hash: hash(readFileSync(inside(root, path))) };
  for (const later of STAGES.slice(STAGES.indexOf(stage) + 1)) delete index.stages[later];
  atomicJson(indexPath, index);
  return record;
}

export function validateDesignReview(root, stage = "final", { current = true } = {}) {
  try {
    const identity = runIdentity(root);
    if (identity.schemaVersion !== 2) return { result: "PASS", notes: "legacy run; design evidence not required" };
    const index = readJson(join(root, ".redesign-state/design-review.json"));
    const entry = index.stages[stage];
    if (!entry) throw new Error(`missing ${stage} design review`);
    const bytes = readFileSync(inside(root, entry.path));
    if (hash(bytes) !== entry.hash) throw new Error("review record changed");
    const record = JSON.parse(bytes);
    if (record.runId !== identity.runId || record.producerContract !== DESIGN_CONTRACT || record.stage !== stage || record.report.verdict !== "pass") throw new Error("review does not pass the current design contract");
    if (current && (stage === "concept"
      ? jsonHash(studyFiles(record.files)) !== jsonHash(studyFiles(designInputs(root, stage).files))
      : record.inputHash !== designInputs(root, stage).inputHash)) throw new Error("design source/assets changed since review");
    if (current && stage !== "concept" && productionIdentity(record.captures.production) !== productionIdentity(productionEvidence(root))) throw new Error("review captures do not match the current production build");
    for (const shot of record.captures.screenshots) if (hash(readFileSync(inside(root, shot.path))) !== shot.hash) throw new Error("reviewed screenshot changed");
    if (record.previous && hash(readFileSync(inside(root, record.previous.path))) !== record.previous.hash) throw new Error("prior stage evidence changed");
    return { result: "PASS", notes: `${stage} design review and rendered inputs verified` };
  } catch (error) { return { result: "FAIL", notes: error.message }; }
}

// The operator's answer to the concept round. A pick names the direction the
// representative build carries (it may differ from the art-director's winner);
// a redo sends the round back to the design lead with the operator's notes and
// does not count against the art-director's one-revision budget. Either is
// refused once the representative build is frozen: by then routes are built
// against the old direction, and changing it is a new run, not a choice.
export function conceptChoice(root) {
  try {
    const index = readJson(join(root, ".redesign-state/design-review.json"));
    const entry = index.stages?.concept;
    const last = (index.choices || []).at(-1);
    return entry && last?.action === "pick" && last.conceptRecord === entry.hash ? last : null;
  } catch { return null; }
}

const FEEDBACK = ".redesign-state/concepts/feedback.md";
export function chooseConcept(root, { pick, redo, notes }) {
  const contract = runIdentity(root);
  if (contract.schemaVersion !== 2) throw new Error("concept choice requires a schema-2 run");
  if (!!pick === (redo !== undefined)) throw new Error("give exactly one of --pick <concept-id> or --redo \"<notes>\"");
  if (redo !== undefined && !redo.trim()) throw new Error("a redo needs notes saying what to change");
  if (existsSync(join(root, ".redesign-state/design-freeze.json"))) throw new Error("the representative build is already frozen; changing direction now is a new run");
  const manifestPath = join(root, ".redesign-state/design-manifest.json");
  const manifest = designManifest(root);
  const indexPath = join(root, ".redesign-state/design-review.json");
  const index = readJson(indexPath);
  const entry = index.stages.concept;
  const at = new Date().toISOString();
  let choice;
  if (pick) {
    if (!manifest.concepts.some((c) => c.id === pick)) throw new Error(`no concept named ${pick}; choose one of ${manifest.concepts.map((c) => c.id).join(", ")}`);
    if (validateDesignReview(root, "concept", { current: false }).result !== "PASS") throw new Error("no passing concept review to pick from; record the art-director's judgment first, or ask for a redo");
    choice = { action: "pick", pick, notes: notes?.trim() || null, conceptRecord: entry.hash, winner: readJson(inside(root, entry.path)).report.winner, at };
    if (manifest.selectedId !== pick) for (const later of STAGES.slice(1)) delete index.stages[later];
    manifest.selectedId = pick;
  } else {
    choice = { action: "redo", notes: redo.trim(), round: (index.choices || []).filter((c) => c.action === "redo").length + 1, concepts: manifest.concepts.map((c) => c.id), conceptRecord: entry?.hash || null, at };
    index.stages = {};
    manifest.selectedId = null;
  }
  index.choices = [...(index.choices || []), choice];
  atomicJson(manifestPath, manifest);
  atomicJson(indexPath, index);
  if (choice.notes) {
    const feedback = join(root, FEEDBACK);
    const head = existsSync(feedback) ? readFileSync(feedback, "utf8") : "# Operator feedback on the concepts\n\nBinding client requirements for the design lead: fold each into `design-direction.md` before the next round or the representative build.\n";
    mkdirSync(dirname(feedback), { recursive: true });
    writeFileSync(feedback, `${head.trimEnd()}\n\n## ${at} — ${pick ? `pick ${pick}` : `redo round ${choice.round}`}\n\n${choice.notes}\n`);
  }
  return { ...choice, selectedId: manifest.selectedId, feedback: choice.notes ? FEEDBACK : null };
}

// One page the operator can look at: every concept rendered at both widths, the
// art-director's recommendation and reasons, and how to answer. The sheet in
// the site links the capture PNGs; `standalone` also writes a self-contained
// copy (images inlined) that can be attached or published on its own.
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function conceptSheetHtml({ manifest, report, screenshots, choices, image }) {
  const tag = (id) => (id === report.winner ? "Recommended" : id === report.runnerUp ? "Runner-up" : "");
  const concepts = manifest.concepts.map((concept) => {
    const shots = screenshots.filter((s) => s.target === concept.id).sort((a, b) => b.width - a.width);
    const label = tag(concept.id);
    return `<section class="concept${concept.id === report.winner ? " winner" : ""}">
  <h2>Concept ${escapeHtml(concept.id)}${label ? ` <span class="tag">${label}</span>` : ""}</h2>
  <div class="shots">${shots.map((shot) => `
    <figure class="w${shot.width}"><figcaption>${shot.width >= 1000 ? "Desktop" : "Mobile"} (${shot.width}px)</figcaption><div class="frame"><img src="${image(shot.path)}" alt="Concept ${escapeHtml(concept.id)} at ${shot.width}px"></div></figure>`).join("")}
  </div>
</section>`;
  }).join("\n");
  const list = (title, items) => (items.length ? `<section class="notes"><h2>${title}</h2><ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul></section>` : "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Concept review</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f5f2; --card: #fff; --ink: #1d1d1b; --muted: #6b6a66; --line: #dddbd5; --accent: #2f5d50; }
  @media (prefers-color-scheme: dark) { :root { --bg: #141413; --card: #1e1e1c; --ink: #ecebe6; --muted: #a3a29c; --line: #34332f; --accent: #8fc2b1; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 1400px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  .lead { color: var(--muted); margin: 0 0 24px; }
  .concept, .notes, .answer { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 20px; margin: 0 0 20px; }
  .concept.winner { border-color: var(--accent); }
  h2 { font-size: 20px; margin: 0 0 12px; }
  .tag { font-size: 13px; font-weight: 600; color: var(--accent); border: 1px solid var(--accent); border-radius: 999px; padding: 2px 10px; vertical-align: middle; }
  .shots { display: flex; gap: 20px; align-items: flex-start; }
  figure { margin: 0; min-width: 0; }
  figure.w1440 { flex: 1 1 auto; }
  figure.w390 { flex: 0 0 300px; }
  figcaption { font-size: 13px; color: var(--muted); margin: 0 0 6px; }
  .frame { max-height: 75vh; overflow: auto; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
  .frame img { display: block; width: 100%; height: auto; }
  ul { margin: 0; padding-left: 20px; }
  li { margin: 4px 0; }
  code { font: 14px ui-monospace, monospace; background: var(--bg); padding: 2px 6px; border-radius: 4px; overflow-wrap: anywhere; }
  @media (max-width: 760px) { .shots { flex-direction: column; } figure.w390 { flex-basis: auto; width: 100%; max-width: 390px; } }
</style>
</head>
<body>
<main>
<h1>Concept review, round ${choices.filter((c) => c.action === "redo").length + 1}</h1>
<p class="lead">Art-director verdict: <strong>${escapeHtml(report.verdict)}</strong>. Recommends <strong>${escapeHtml(report.winner ?? "none")}</strong>${report.runnerUp ? `, runner-up <strong>${escapeHtml(report.runnerUp)}</strong>` : ""}.${report.firstImpression ? ` ${escapeHtml(report.firstImpression)}` : ""}</p>
${concepts}
${list("How they differ", (report.pairwiseDifferences || []).map(escapeHtml))}
${list("Art-director findings", report.findings.map((f) => `<strong>${escapeHtml(f.severity)}</strong> (${escapeHtml(f.where)}): ${escapeHtml(f.what)}`))}
${list("Earlier answers", choices.map((c) => `${escapeHtml(c.at)}: ${c.action === "pick" ? `picked ${escapeHtml(c.pick)}` : `new round asked for after round ${c.round}${c.concepts?.length ? ` (${c.concepts.map(escapeHtml).join(", ")})` : ""}`}${c.notes ? ` — ${escapeHtml(c.notes)}` : ""}`))}
<section class="answer"><h2>Your answer</h2>
<p>Name the concept to build, with any contained changes ("A, but with B's menu"), and Claude builds it. If you dislike them or want larger changes, say what to change and Claude makes three new concepts from your feedback. Claude records it with <code>design-review.mjs choose --pick &lt;concept&gt; [--notes "…"]</code> or <code>design-review.mjs choose --redo "…"</code>.</p></section>
</main>
</body>
</html>
`;
}

export function writeConceptSheet(root, { standalone } = {}) {
  const index = readJson(join(root, ".redesign-state/design-review.json"));
  const entry = index.stages?.concept;
  if (!entry) throw new Error("no concept review recorded yet");
  const record = readJson(inside(root, entry.path));
  const manifest = designManifest(root);
  const sheet = ".redesign-state/concepts/REVIEW.html";
  const parts = { manifest, report: record.report, screenshots: record.captures.screenshots, choices: index.choices || [] };
  const linked = (path) => relative(dirname(join(root, sheet)), join(root, path)).split(sep).join("/");
  writeFileSync(join(root, sheet), conceptSheetHtml({ ...parts, image: linked }));
  if (standalone) {
    const inline = (path) => `data:image/png;base64,${readFileSync(inside(root, path)).toString("base64")}`;
    mkdirSync(dirname(resolve(standalone)), { recursive: true });
    writeFileSync(resolve(standalone), conceptSheetHtml({ ...parts, image: inline }));
  }
  return { path: sheet, standalone: standalone ? resolve(standalone) : null, winner: record.report.winner, runnerUp: record.report.runnerUp, screenshots: record.captures.screenshots.map((s) => s.path) };
}
