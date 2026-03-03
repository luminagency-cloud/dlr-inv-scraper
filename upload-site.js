const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

async function upload() {
  const keyJson = JSON.parse(process.env.GDRIVE_SERVICE_ACCOUNT_JSON);
  const folderId = process.env.GDRIVE_FOLDER_ID;

  const auth = new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  const drive = google.drive({ version: 'v3', auth });

  const outputDir = path.join(process.cwd(), 'output');
  const files = fs.readdirSync(outputDir)
    .filter(f => f.endsWith('.csv') && f.includes('_inventory_'));

  if (files.length === 0) {
    console.log('No inventory CSV files found to upload.');
    return;
  }

  for (const file of files) {
    const filePath = path.join(outputDir, file);

    // Check if a file with this name already exists in the folder
    const existing = await drive.files.list({
      q: `name='${file}' and '${folderId}' in parents and trashed=false`,
      fields: 'files(id)',
    });

    if (existing.data.files.length > 0) {
      // Update existing file contents
      await drive.files.update({
        fileId: existing.data.files[0].id,
        media: { mimeType: 'text/csv', body: fs.createReadStream(filePath) },
      });
      console.log(`Updated: ${file}`);
    } else {
      // Upload as new file
      await drive.files.create({
        requestBody: { name: file, parents: [folderId] },
        media: { mimeType: 'text/csv', body: fs.createReadStream(filePath) },
        fields: 'id',
      });
      console.log(`Uploaded: ${file}`);
    }
  }
}

upload().catch(err => {
  console.error('Google Drive upload failed:', err.message);
  process.exit(1);
});
