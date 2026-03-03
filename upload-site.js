const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');

async function upload() {
  const client = new ftp.Client();
  try {
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      secure: false   // set true if FTPS is supported
    });

    const remoteDir = process.env.FTP_REMOTE_DIR || '/public_html/reports';
    await client.ensureDir(remoteDir);

    const outputDir = path.join(process.cwd(), 'output');
    const files = fs.readdirSync(outputDir)
      .filter(f => f.endsWith('.csv') && f.includes('_inventory_'));

    if (files.length === 0) {
      console.log('No inventory CSV files found to upload.');
      return;
    }

    for (const file of files) {
      await client.uploadFrom(path.join(outputDir, file), `${remoteDir}/${file}`);
      console.log(`Uploaded: ${file}`);
    }
  } finally {
    client.close();
  }
}

upload().catch(err => {
  console.error('FTP upload failed:', err.message);
  process.exit(1);
});
