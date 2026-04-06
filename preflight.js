// Validates Google Drive and Gmail credentials before the scraper runs.
// If either check fails, exits with code 1 and the workflow stops early.

const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const { loadLocalEnv } = require('./config');
const { createDriveAuthClient, getDriveAuthMode, getDriveConfig, hasDriveCredentials } = require('./gdrive-auth');

let passed = true;

loadLocalEnv();

function formatDriveError(err, authMode) {
  if (err?.message === 'unauthorized_client' && authMode === 'oauth') {
    return 'unauthorized_client (the OAuth client ID/secret no longer matches the refresh token; update the GitHub secrets with a matching OAuth client and refresh token)';
  }

  return err?.message || 'Unknown Google Drive error';
}

async function checkDrive() {
  process.stdout.write('  Google Drive ... ');
  try {
    const { folderId } = getDriveConfig();
    if (!folderId) {
      throw new Error('Missing GDRIVE_FOLDER_ID');
    }

    const auth = createDriveAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    const authMode = getDriveAuthMode();

    // Test write access: create a tiny file then immediately delete it
    const { Readable } = require('stream');
    const res = await drive.files.create({
      requestBody: { name: '_preflight_test.txt', parents: [folderId] },
      media: { mimeType: 'text/plain', body: Readable.from(['preflight']) },
      fields: 'id',
    });
    await drive.files.delete({ fileId: res.data.id });

    console.log(`OK (${authMode})`);
  } catch (err) {
    console.log(`FAILED — ${formatDriveError(err, getDriveAuthMode())}`);
    passed = false;
  }
}

async function checkEmail() {
  process.stdout.write('  Gmail SMTP    ... ');
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
    await transporter.verify();
    console.log('OK');
  } catch (err) {
    console.log(`FAILED — ${err.message}`);
    passed = false;
  }
}

async function main() {
  const hasDriveCreds = hasDriveCredentials();
  const hasEmailCreds = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD;

  if (!hasDriveCreds && !hasEmailCreds) {
    console.log('\nPreflight checks: skipped (no credentials configured — local run)\n');
    return;
  }

  console.log('\nPreflight checks:');
  if (hasDriveCreds) await checkDrive(); else console.log('  Google Drive ... skipped (no credentials)');
  if (hasEmailCreds) await checkEmail(); else console.log('  Gmail SMTP    ... skipped (no credentials)');
  console.log();

  if (!passed) {
    console.error('One or more preflight checks failed. Aborting run.');
    process.exit(1);
  }
  console.log('All checks passed.\n');
}

main();
