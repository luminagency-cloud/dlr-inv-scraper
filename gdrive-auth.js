const fs = require('fs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
const { loadLocalEnv } = require('./config');

const TOKEN_CACHE_PATH = path.join(process.cwd(), '.gdrive-token.json');
const DEFAULT_REDIRECT_URI = 'http://localhost:3000';

function readCachedTokens() {
  if (!fs.existsSync(TOKEN_CACHE_PATH)) return null;

  try {
    return JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeCachedTokens(tokens) {
  fs.writeFileSync(TOKEN_CACHE_PATH, `${JSON.stringify(tokens, null, 2)}\n`);
}

function getDriveConfig() {
  loadLocalEnv();

  const clientId = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
  const folderId = process.env.GDRIVE_FOLDER_ID;
  const redirectUri = process.env.GDRIVE_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  const cachedTokens = readCachedTokens();
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN || cachedTokens?.refresh_token;

  return {
    clientId,
    clientSecret,
    folderId,
    redirectUri,
    cachedTokens,
    refreshToken,
    tokenCachePath: TOKEN_CACHE_PATH,
  };
}

function getDriveAuthMode(config = getDriveConfig()) {
  if (config.clientId && config.clientSecret && config.refreshToken) return 'oauth';
  return null;
}

function hasDriveCredentials(config = getDriveConfig()) {
  return Boolean(getDriveAuthMode(config));
}

function createDriveAuthClient() {
  const config = getDriveConfig();
  const authMode = getDriveAuthMode(config);

  if (!authMode) {
    return null;
  }

  const auth = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
  auth.setCredentials({
    ...(config.cachedTokens || {}),
    refresh_token: config.refreshToken,
  });

  auth.on('tokens', tokens => {
    if (!tokens || Object.keys(tokens).length === 0) return;

    const mergedTokens = {
      ...(readCachedTokens() || {}),
      ...tokens,
      refresh_token: tokens.refresh_token || config.refreshToken,
    };

    writeCachedTokens(mergedTokens);
  });

  return auth;
}

module.exports = {
  createDriveAuthClient,
  getDriveAuthMode,
  getDriveConfig,
  hasDriveCredentials,
  readCachedTokens,
  writeCachedTokens,
};
