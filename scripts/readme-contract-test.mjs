/**
 * Gate for the README, not the code.
 *
 * `scripts/demo-contract-test.mjs` proves `fitbit_demo` matches the server. It
 * says nothing about the README — and the README is what a human reads first,
 * on a public GitHub page, before installing anything. The same defect class
 * (a published contract nobody compares with reality) is free to live there.
 *
 * This gate covers the two ways the README can lie about the server:
 *
 * 1. A ```json block that claims to be tool OUTPUT.
 *    Today this repo has none — both ```json blocks (README.md and
 *    docs/quickstart.md) are MCP *client config* (`mcpServers`), which is an
 *    install snippet, not a payload, and is therefore out of scope here.
 *    Rather than assert that absence, the gate CLASSIFIES every ```json block
 *    it finds: `mcpServers` is config and is skipped; anything else must be
 *    tagged with an HTML comment naming the tool it came from
 *
 *        <!-- payload-example: fitbit_daily_summary -->
 *        <!-- payload-example: fitbit_daily_summary.scorecard -->   (subtree)
 *
 *    and is then compared, recursive key path by recursive key path, against
 *    the real payload — failing in BOTH directions (invented key / omitted
 *    key). An untagged, non-config block fails: an example nobody can verify
 *    is exactly how the drift got here. So the first person to paste a payload
 *    into the README gets the comparison automatically.
 *
 *    Chain of truth, stated so nobody mistakes it for more: README block is
 *    compared against `buildDemoPayload()`, and that demo payload is itself
 *    compared against the real `buildDailySummary` / `buildWellnessContext` /
 *    `applyPrivacy` code paths by `demo-contract-test.mjs`, which runs in the
 *    same `npm test`. Break either link and one of the two gates fails.
 *
 * 2. The published TOOL / PROMPT / RESOURCE lists.
 *    Those are the README's other contract, and 0.5.0 shipped a README that
 *    omitted 6 of 32 registered tools — including `fitbit_demo` itself — and 3
 *    of 7 resources. The lists are compared against a REAL MCP session over
 *    stdio (`node dist/index.js`), not a grep of the source, and fail in both
 *    directions: a name the README invents, and a name the server serves that
 *    the README never mentions.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildDemoPayload } from '../dist/services/demo.js';

const DOCS = ['README.md', ...readdirSync('docs').filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];

/* ------------------------------------------------------------------ *
 * 1. ```json blocks: config is skipped, payload examples are compared *
 * ------------------------------------------------------------------ */

/** Every ```json fence in a markdown file, with any payload-example tag above it. */
function jsonBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== '```json') continue;
    const end = lines.indexOf('```', i + 1);
    assert.notEqual(end, -1, 'unterminated ```json fence');
    // The tag, when present, sits on one of the two lines above the fence.
    const tag = lines
      .slice(Math.max(0, i - 2), i)
      .map((line) => line.match(/<!--\s*payload-example:\s*([^\s>]+)\s*-->/)?.[1])
      .find(Boolean);
    blocks.push({ line: i + 1, tag, body: lines.slice(i + 1, end).join('\n') });
    i = end;
  }
  return blocks;
}

function keyPaths(value, prefix = '', out = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) keyPaths(item, `${prefix}[]`, out);
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  for (const key of Object.keys(value)) {
    const p = prefix ? `${prefix}.${key}` : key;
    out.add(p);
    keyPaths(value[key], p, out);
  }
  return out;
}

const demo = buildDemoPayload().sample;

/** Resolve `fitbit_daily_summary` or `fitbit_daily_summary.scorecard` in the demo sample. */
function resolveTag(tag) {
  const [tool, ...rest] = tag.split('.');
  assert.ok(
    demo[tool],
    `payload-example tag "${tag}" names "${tool}", which fitbit_demo does not sample. ` +
      `A README example can only be verified against a tool this repo can actually build.`
  );
  let node = demo[tool];
  for (const step of rest) {
    assert.ok(
      node !== null && typeof node === 'object' && step in node,
      `payload-example tag "${tag}": "${step}" is not a key of the real payload.`
    );
    node = node[step];
  }
  return node;
}

const failures = [];
let configBlocks = 0;
let payloadBlocks = 0;
let verifiedPaths = 0;

for (const doc of DOCS) {
  const text = readFileSync(doc, 'utf8');
  for (const block of jsonBlocks(text)) {
    const where = `${doc}:${block.line}`;
    let parsed;
    try {
      parsed = JSON.parse(block.body);
    } catch (error) {
      failures.push(`\n  ${where}: \`\`\`json block is not valid JSON — ${error.message}`);
      continue;
    }

    const isConfig = parsed !== null && typeof parsed === 'object' && 'mcpServers' in parsed;
    if (isConfig) {
      if (block.tag) {
        failures.push(
          `\n  ${where}: tagged payload-example but the block is MCP client config (mcpServers).`
        );
      } else {
        configBlocks += 1;
        console.log(`SKIP ${where} — MCP client config, not tool output`);
      }
      continue;
    }

    if (!block.tag) {
      failures.push(
        `\n  ${where}: \`\`\`json block is not MCP client config, so it reads as tool output —` +
          `\n  and nothing compares it with what the server returns. Tag it with` +
          `\n    <!-- payload-example: <tool_name> -->  (or <tool_name>.<subtree>)` +
          `\n  so this gate can verify it, or make it obviously config.`
      );
      continue;
    }

    payloadBlocks += 1;
    const realPaths = keyPaths(resolveTag(block.tag));
    const docPaths = keyPaths(parsed);
    const invented = [...docPaths].filter((k) => !realPaths.has(k)).sort();
    const missing = [...realPaths].filter((k) => !docPaths.has(k)).sort();
    verifiedPaths += docPaths.size;

    if (invented.length > 0 || missing.length > 0) {
      const lines = [`\n  ${where} (${block.tag}):`];
      if (invented.length > 0) {
        lines.push(
          `  ${invented.length} key(s) the README shows that the server NEVER returns:`,
          ...invented.map((k) => `    - ${k}`)
        );
      }
      if (missing.length > 0) {
        lines.push(
          `  ${missing.length} key(s) the server returns that the README omits:`,
          ...missing.map((k) => `    + ${k}`)
        );
      }
      failures.push(lines.join('\n'));
    } else {
      console.log(`PASS ${where} — ${docPaths.size} key paths match ${block.tag}`);
    }
  }
}

/* ------------------------------------------------------------- *
 * 2. Published tool / prompt / resource lists vs the live server *
 * ------------------------------------------------------------- */

const readme = readFileSync('README.md', 'utf8');

/** Body of a `## <heading>` section, up to the next `## `. */
function section(heading) {
  const match = readme.match(new RegExp(`\\n## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`));
  assert.ok(
    match,
    `README.md has no "## ${heading}" section. This gate reads the published list from it — ` +
      `renaming or deleting the section is not a way to pass.`
  );
  return match[1];
}

function backticked(body, pattern) {
  return [...body.matchAll(/`([^`]+)`/g)].map((hit) => hit[1]).filter((token) => pattern.test(token));
}

const client = new Client({ name: 'fitbit-mcp-readme-contract', version: '0.0.0' });
const transport = new StdioClientTransport({ command: 'node', args: ['dist/index.js'] });
await client.connect(transport);
let live;
try {
  live = {
    Tools: (await client.listTools()).tools.map((t) => t.name),
    Prompts: (await client.listPrompts()).prompts.map((p) => p.name),
    Resources: (await client.listResources()).resources.map((r) => r.uri)
  };
} finally {
  await client.close();
}

/**
 * Surfaces the server serves but the README deliberately does not publish.
 * Deliberately empty: adding a name here to silence the gate defeats it. Each
 * entry would need a stated reason.
 */
const UNPUBLISHED_BY_DESIGN = new Set([]);

const LISTS = [
  // Digits matter: fitbit_get_spo2_day is a real tool name.
  { heading: 'Tools', pattern: /^fitbit_[a-z0-9_]+$/, label: 'tool' },
  { heading: 'Prompts', pattern: /^fitbit_[a-z0-9_]+$/, label: 'prompt' },
  { heading: 'Resources', pattern: /^fitbit:\/\/\S+$/, label: 'resource' }
];

for (const { heading, pattern, label } of LISTS) {
  const published = new Set(backticked(section(heading), pattern));
  const served = new Set(live[heading]);

  const invented = [...published].filter((n) => !served.has(n)).sort();
  const unpublished = [...served].filter((n) => !published.has(n) && !UNPUBLISHED_BY_DESIGN.has(n)).sort();

  if (invented.length > 0 || unpublished.length > 0) {
    const lines = [`\n  README "## ${heading}" drifted from the running server:`];
    if (invented.length > 0) {
      lines.push(
        `  ${invented.length} ${label}(s) the README advertises that the server does not serve:`,
        ...invented.map((n) => `    - ${n}`)
      );
    }
    if (unpublished.length > 0) {
      lines.push(
        `  ${unpublished.length} ${label}(s) the server serves that the README never mentions:`,
        ...unpublished.map((n) => `    + ${n}`)
      );
    }
    failures.push(lines.join('\n'));
  } else {
    console.log(`PASS README "## ${heading}" — ${published.size} ${label}(s) match the live server`);
  }
}

if (failures.length > 0) {
  console.error('\nFAIL README drifted from what the server actually does:');
  console.error(failures.join('\n'));
  console.error(
    '\nFix README.md so it matches the server.' +
      '\nDo not widen UNPUBLISHED_BY_DESIGN or delete the block to silence this —' +
      '\nthat is how a public README starts lying.\n'
  );
  process.exit(1);
}

console.log(
  `\nreadme-contract: ${configBlocks} config block(s) skipped, ` +
    `${payloadBlocks} payload example(s) verified (${verifiedPaths} key paths), ` +
    `3 published lists matched against a live MCP session`
);
console.log(
  JSON.stringify({ ok: true, suite: 'readme-contract', config_blocks: configBlocks, payload_blocks: payloadBlocks })
);
