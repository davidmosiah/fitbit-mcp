import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function userPrompt(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

export function registerFitbitPrompts(server: McpServer): void {
  server.registerPrompt("fitbit_daily_checkin", {
    title: "Fitbit Daily Check-in",
    description: "Ask an agent to create a practical daily health and training check-in from Fitbit.",
    argsSchema: { focus: z.string().optional().describe("Optional focus, e.g. sleep, training, recovery, weight, nutrition.") }
  }, ({ focus }) => userPrompt(`Use Fitbit MCP for a daily check-in${focus ? ` focused on ${focus}` : ""}.

Required flow:
1. Call fitbit_connection_status.
2. If ready, call fitbit_daily_summary with response_format=json.
3. Only drill into low-level tools if the summary shows a concrete question.

Return:
- main signal
- what changed or needs attention
- 3 practical actions for today
- confidence and missing data
- no medical diagnosis.`));

  server.registerPrompt("fitbit_weekly_review", {
    title: "Fitbit Weekly Review",
    description: "Ask an agent to review Fitbit trends across activity, sleep and heart context.",
    argsSchema: { goal: z.string().optional().describe("Optional goal, e.g. fat loss, tennis conditioning, endurance base, sleep repair.") }
  }, ({ goal }) => userPrompt(`Use Fitbit MCP for a weekly review${goal ? ` for this goal: ${goal}` : ""}.

Required flow:
1. Call fitbit_connection_status.
2. Call fitbit_weekly_summary with response_format=json.
3. Use fitbit_get_sleep_day, fitbit_get_heart_day or fitbit_get_hrv_day only to investigate specific bottlenecks.

Return:
- scorecard
- bottlenecks
- next-week actions
- risks/unknowns
- no medical diagnosis.`));

  server.registerPrompt("fitbit_intraday_investigation", {
    title: "Fitbit Intraday Heart Investigation",
    description: "Investigate one day of Fitbit heart-rate samples when API access permits intraday data.",
    argsSchema: { date: z.string().describe("yyyy-MM-dd or today"), detail_level: z.enum(["1sec", "1min", "5min", "15min"]).optional() }
  }, ({ date, detail_level }) => userPrompt(`Call fitbit_get_heart_intraday for date=${date}, detail_level=${detail_level ?? "1min"}, response_format=json.

Explain:
- what the samples can and cannot prove
- notable periods or missing data
- whether follow-up should use sleep/activity tools
- no diagnosis or alarmism.`));
}
