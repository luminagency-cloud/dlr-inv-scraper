// Validates Google Drive and Gmail credentials before the scraper runs.
// If either check fails, exits with code 1 and the workflow stops early.

const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const nodemailer = require('nodemailer');

let passed = true;

async function checkDrive() {
  process.stdout.write('  Google Drive ... ');
  try {
    const folderId = process.env.GDRIVE_FOLDER_ID;

    const auth = new OAuth2Client(process.env.GDRIVE_CLIENT_ID, process.env.GDRIVE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: process.env.GDRIVE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth });

    // Test write access: create a tiny file then immediately delete it
    const { Readable } = require('stream');
    const res = await drive.files.create({
      requestBody: { name: '_preflight_test.txt', parents: [folderId] },
      media: { mimeType: 'text/plain', body: Readable.from(['preflight']) },
      fields: 'id',
    });
    await drive.files.delete({ fileId: res.data.id });

    console.log('OK');
  } catch (err) {
    console.log(`FAILED — ${err.message}`);
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
  console.log('\nPreflight checks:');
  await checkDrive();
  await checkEmail();
  console.log();

  if (!passed) {
    console.error('One or more preflight checks failed. Aborting run.');
    process.exit(1);
  }
  console.log('All checks passed.\n');
}

main();
