// One-time helper: run locally to get a refresh token for GitHub Secrets.
// Usage: GDRIVE_CLIENT_ID=xxx GDRIVE_CLIENT_SECRET=yyy node get-gdrive-token.js
const { OAuth2Client } = require('google-auth-library');
const http = require('http');
const url = require('url');

const CLIENT_ID = process.env.GDRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET env vars first.');
  process.exit(1);
}

const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/drive.file'],
  prompt: 'consent',
});

console.log('\nOpen this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for callback on http://localhost:3000 ...\n');

const server = http.createServer(async (req, res) => {
  const { code, error } = url.parse(req.url, true).query;
  if (error) { res.end('<p>Denied.</p>'); console.error(error); server.close(); return; }
  if (!code) { res.end(''); return; }
  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.end('<p>Success! Close this tab and return to the terminal.</p>');
    server.close();
    console.log('\nAdd these to GitHub Secrets:\n');
    console.log(`GDRIVE_CLIENT_ID     = ${CLIENT_ID}`);
    console.log(`GDRIVE_CLIENT_SECRET = ${CLIENT_SECRET}`);
    console.log(`GDRIVE_REFRESH_TOKEN = ${tokens.refresh_token}`);
    console.log('\nKeep GDRIVE_FOLDER_ID as-is.');
  } catch (err) {
    res.end('<p>Token exchange failed.</p>');
    console.error(err.message);
    server.close();
  }
});
server.listen(3000);
