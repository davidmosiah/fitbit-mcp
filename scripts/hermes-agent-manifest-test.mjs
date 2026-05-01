import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const pinnedPackage = `fitbit-mcp-unofficial@${packageJson.version}`;
const dir = mkdtempSync(join(tmpdir(), 'fitbit-mcp-hermes-agent-'));

const client = new Client({ name: 'fitbit-mcp-hermes-agent-test', version: '0.0.0' });
const transport = new StdioClientTransport({ command: 'node', args: ['dist/index.js'] });

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  assert.ok(toolNames.includes('fitbit_agent_manifest'), 'Hermes-ready agent manifest tool should be registered.');

  const resources = await client.listResources();
  const resourceUris = resources.resources.map((resource) => resource.uri);
  assert.ok(resourceUris.includes('fitbit://agent-manifest'), 'Agent manifest resource should be registered.');

  const manifestResult = await client.callTool({
    name: 'fitbit_agent_manifest',
    arguments: { client: 'hermes', response_format: 'json' }
  });
  const manifest = manifestResult.structuredContent;
  assert.equal(manifest.client, 'hermes');
  assert.equal(manifest.hermes.tool_name_prefix, 'mcp_fitbit_');
  assert.equal(manifest.hermes.no_gateway_restart_for_data_access, true);
  assert.match(manifest.hermes.reload_after_config_change, /\/reload-mcp/);
  assert.ok(manifest.hermes.common_tool_names.includes('mcp_fitbit_fitbit_connection_status'));
  assert.ok(JSON.stringify(manifest.hermes.recommended_config).includes(pinnedPackage));
  assert.ok(manifest.agent_rules.some((rule) => /do not restart/i.test(rule)));

  const manifestResource = await client.readResource({ uri: 'fitbit://agent-manifest' });
  const text = manifestResource.contents[0]?.text ?? '';
  assert.match(text, /mcp_fitbit_fitbit_connection_status/);
  assert.match(text, /\/reload-mcp/);

  const setup = spawnSync(process.execPath, [
    'dist/index.js',
    'setup',
    '--client',
    'hermes',
    '--client-id',
    'client-id',
    '--client-secret',
    'client-secret',
    '--redirect-uri',
    'http://127.0.0.1:3000/callback',
    '--no-auth',
    '--json'
  ], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: dir }
  });
  assert.equal(setup.status, 0, setup.stderr);
  const setupPayload = JSON.parse(setup.stdout);
  assert.equal(setupPayload.client, 'hermes');
  assert.ok(setupPayload.hermes_skill_path.endsWith('.hermes/skills/fitbit-mcp/SKILL.md'));
  assert.ok(setupPayload.next_step.includes('/reload-mcp'));
  assert.ok(existsSync(setupPayload.hermes_skill_path), 'Hermes setup should write the packaged Hermes skill.');

  const hermesConfig = readFileSync(setupPayload.client_config_path, 'utf8');
  assert.match(hermesConfig, new RegExp(pinnedPackage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(readFileSync(setupPayload.hermes_skill_path, 'utf8'), /mcp_fitbit_fitbit_connection_status/);

  const doctor = spawnSync(process.execPath, ['dist/index.js', 'doctor', '--client', 'hermes', '--json'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: dir }
  });
  assert.equal(doctor.status, 0, doctor.stderr);
  const doctorPayload = JSON.parse(doctor.stdout);
  assert.equal(doctorPayload.client, 'hermes');
  assert.equal(doctorPayload.client_checks.hermes.config_exists, true);
  assert.equal(doctorPayload.client_checks.hermes.fitbit_server_configured, true);
  assert.equal(doctorPayload.client_checks.hermes.package_pinned, true);
  assert.equal(doctorPayload.client_checks.hermes.skill_installed, true);
  assert.ok(doctorPayload.client_checks.hermes.recommendations.some((item) => item.includes('/reload-mcp')));

  const mergeDir = mkdtempSync(join(tmpdir(), 'fitbit-mcp-hermes-merge-'));
  mkdirSync(join(mergeDir, '.hermes'), { recursive: true, mode: 0o700 });
  writeFileSync(join(mergeDir, '.hermes', 'config.yaml'), [
    'mcp_servers:',
    '  whoop:',
    '    command: npx',
    '    args:',
    '      - -y',
    '      - whoop-mcp-unofficial',
    ''
  ].join('\n'), { mode: 0o600 });
  const mergeSetup = spawnSync(process.execPath, [
    'dist/index.js',
    'setup',
    '--client',
    'hermes',
    '--client-id',
    'client-id',
    '--client-secret',
    'client-secret',
    '--redirect-uri',
    'http://127.0.0.1:3000/callback',
    '--no-auth',
    '--json'
  ], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: mergeDir }
  });
  assert.equal(mergeSetup.status, 0, mergeSetup.stderr);
  const mergedConfig = readFileSync(join(mergeDir, '.hermes', 'config.yaml'), 'utf8');
  assert.equal((mergedConfig.match(/^mcp_servers:/gm) ?? []).length, 1, 'Hermes setup should merge into an existing mcp_servers block instead of duplicating it.');
  assert.match(mergedConfig, /whoop:/);
  assert.match(mergedConfig, /fitbit:/);
  assert.match(mergedConfig, new RegExp(pinnedPackage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  rmSync(mergeDir, { recursive: true, force: true });

  console.log(JSON.stringify({ ok: true, hermes_agent_manifest: true, pinned_package: pinnedPackage }, null, 2));
} finally {
  await client.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
