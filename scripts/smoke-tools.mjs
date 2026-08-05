import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const expectedTools = [
  'fitbit_agent_manifest', 'fitbit_cache_status', 'fitbit_capabilities', 'fitbit_connection_status',
  'fitbit_daily_summary', 'fitbit_data_inventory', 'fitbit_demo', 'fitbit_exchange_code',
  'fitbit_get_activity', 'fitbit_get_activity_day', 'fitbit_get_auth_url', 'fitbit_get_breathing_rate_day',
  'fitbit_get_food_day', 'fitbit_get_heart_day', 'fitbit_get_heart_intraday', 'fitbit_get_hrv_day',
  'fitbit_get_profile', 'fitbit_get_sleep_day', 'fitbit_get_spo2_day', 'fitbit_get_water_day',
  'fitbit_get_weight_day', 'fitbit_heart_series', 'fitbit_list_activities', 'fitbit_list_devices', 'fitbit_list_sleep',
  'fitbit_onboarding', 'fitbit_privacy_audit', 'fitbit_profile_get', 'fitbit_profile_update',
  'fitbit_quickstart', 'fitbit_revoke_access', 'fitbit_weekly_summary', 'fitbit_wellness_context'
];

const expectedResources = [
  'fitbit://agent-manifest', 'fitbit://capabilities', 'fitbit://inventory', 'fitbit://latest/activity',
  'fitbit://profile', 'fitbit://summary/daily', 'fitbit://summary/weekly'
];
const expectedPrompts = ['fitbit_daily_checkin', 'fitbit_intraday_investigation', 'fitbit_weekly_review'];

const client = new Client({ name: 'fitbit-mcp-smoke-test', version: '0.0.0' });
const transport = new StdioClientTransport({ command: 'node', args: ['dist/index.js'] });
await client.connect(transport);
try {
  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, expectedTools.sort());

  const resources = await client.listResources();
  const resourceUris = resources.resources.map((resource) => resource.uri).sort();
  assert.deepEqual(resourceUris, expectedResources.sort());

  const prompts = await client.listPrompts();
  const promptNames = prompts.prompts.map((prompt) => prompt.name).sort();
  assert.deepEqual(promptNames, expectedPrompts.sort());

  const prompt = await client.getPrompt({ name: 'fitbit_daily_checkin', arguments: { focus: 'sleep' } });
  assert.ok(prompt.messages[0]?.content?.type === 'text');

  const auditResult = await client.callTool({ name: 'fitbit_privacy_audit', arguments: { response_format: 'json' } });
  assert.equal(auditResult.structuredContent?.unofficial, true);
  assert.ok(auditResult.structuredContent?.secret_env_vars?.includes('FITBIT_CLIENT_SECRET'));

  const capabilitiesResult = await client.callTool({ name: 'fitbit_capabilities', arguments: { response_format: 'json' } });
  assert.equal(capabilitiesResult.structuredContent?.unofficial, true);
  assert.ok(capabilitiesResult.structuredContent?.api_boundary?.does_not_include?.includes('raw accelerometer/device telemetry'));
  assert.ok(capabilitiesResult.structuredContent?.recommended_agent_flow?.some((step) => step.includes('fitbit_connection_status')));

  const inventoryResult = await client.callTool({ name: 'fitbit_data_inventory', arguments: { response_format: 'json' } });
  assert.equal(inventoryResult.structuredContent?.kind, 'data_inventory');
  assert.equal(typeof inventoryResult.structuredContent?.source, 'string');

  const manifestResult = await client.callTool({ name: 'fitbit_agent_manifest', arguments: { client: 'hermes', response_format: 'json' } });
  assert.equal(manifestResult.structuredContent?.client, 'hermes');
  assert.ok(manifestResult.structuredContent?.hermes?.common_tool_names?.includes('mcp_fitbit_fitbit_connection_status'));
  assert.equal(manifestResult.structuredContent?.hermes?.no_gateway_restart_for_data_access, true);

  const statusResult = await client.callTool({ name: 'fitbit_connection_status', arguments: { client: 'hermes', response_format: 'json' } });
  assert.equal(statusResult.structuredContent?.ok, false);
  assert.ok(statusResult.structuredContent?.missing_env?.includes('FITBIT_CLIENT_ID'));
  assert.equal(statusResult.structuredContent?.client, 'hermes');

  console.log(JSON.stringify({ ok: true, tools: toolNames.length, resources: resourceUris.length, prompts: promptNames.length }, null, 2));
} finally {
  await client.close();
}
