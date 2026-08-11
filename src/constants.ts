export const SERVER_NAME = "fitbit-mcp-server";
export const SERVER_VERSION = "0.6.2";
export const NPM_PACKAGE_NAME = "fitbit-mcp-unofficial";
export const PINNED_NPM_PACKAGE = `${NPM_PACKAGE_NAME}@${SERVER_VERSION}`;

export const FITBIT_API_BASE_URL = "https://api.fitbit.com";
export const FITBIT_AUTH_URL = "https://www.fitbit.com/oauth2/authorize";
export const FITBIT_TOKEN_URL = "https://api.fitbit.com/oauth2/token";
export const FITBIT_REVOKE_URL = "https://api.fitbit.com/oauth2/revoke";

export const DEFAULT_SCOPES = [
  "activity",
  "heartrate",
  "profile",
  "settings",
  "sleep",
  "weight",
  "nutrition"
];

export const DEFAULT_LIMIT = 30;
export const MAX_FITBIT_LIMIT = 100;
export const DEFAULT_MAX_PAGES = 1;
export const MAX_PAGES = 10;
