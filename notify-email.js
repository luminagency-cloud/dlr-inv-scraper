const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

async function notify() {
  const exitCode = parseInt(process.env.SCRAPE_EXIT_CODE || '1', 10);
  const status = exitCode === 0 ? 'SUCCESS' : 'FAILED';
  const today = new Date().toISOString().slice(0, 10);

  // Read the run log
  const logFile = path.join(process.cwd(), 'output', 'run.log');
  let logContent = '';
  if (fs.existsSync(logFile)) {
    const lines = fs.readFileSync(logFile, 'utf-8').split('\n');
    logContent = lines.slice(-40).join('\n');
  }

  // Find the output CSV filename
  const outputDir = path.join(process.cwd(), 'output');
  let csvFile = '';
  if (fs.existsSync(outputDir)) {
    const files = fs.readdirSync(outputDir)
      .filter(f => f.endsWith('.csv') && f.includes('_inventory_'));
    if (files.length > 0) csvFile = files[files.length - 1];
  }

  // Extract dealer result lines from log
  const dealerLines = [];
  const errorLines = [];
  if (logContent) {
    for (const line of logContent.split('\n')) {
      // Lines like "  Dealer Name ... 123 vehicles   (Jeep: 45  Ram: 78)"
      if (/^\s{2}\S.*\.\.\.\s/.test(line)) dealerLines.push(line.trim());
      // Lines with ERROR or FAILED
      if (/ERROR|FAILED|fatal/i.test(line)) errorLines.push(line.trim());
    }
  }

  const folderId = process.env.GDRIVE_FOLDER_ID || '';
  const folderUrl = folderId ? `https://drive.google.com/drive/folders/${folderId}` : '';

  const bodyText = [
    `Status:  ${status}`,
    `Date:    ${today}`,
    `File:    ${csvFile || '(none generated)'}`,
    '',
    folderUrl ? `Folder:  ${folderUrl}` : '',
    '',
    '--- Dealer Results ---',
    dealerLines.length > 0 ? dealerLines.join('\n') : '(no dealer lines found)',
    '',
    errorLines.length > 0 ? '--- Errors ---\n' + errorLines.join('\n') : '',
    '',
    '--- Last 40 lines of log ---',
    logContent || '(no log file)',
  ].filter(l => l !== undefined).join('\n');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.NOTIFY_TO,
    subject: `[Dealer Scraper] ${status} - ${today}`,
    text: bodyText,
  });

  console.log(`Email sent to ${process.env.NOTIFY_TO} — ${status}`);
}

notify().catch(err => {
  console.error('Email notification failed:', err.message);
  process.exit(1);
});
