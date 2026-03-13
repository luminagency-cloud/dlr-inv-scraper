# Dealer Inventory Scraper

Automated tool that scrapes current on-lot vehicle inventory from dealer websites, generates comparison CSV reports by Make/Model, uploads results to Google Drive, and sends email notifications. Runs daily via GitHub Actions.

## Overview

Two dealer groups are configured, each running on its own schedule:

| Group | Input File | Workflow | Schedule |
|-------|-----------|----------|----------|
| CDJR  | `input/dealers_cdjr.csv` | `daily-cdjr.yml` | Sunday ~10pm EST |
| Buick | `input/dealers_buick.csv` | `daily-buick.yml` | SUnday ~ 11pm |

Each automated run:
1. Runs preflight checks (Drive + Gmail credentials)
2. Sends a "starting" email notification
3. Scrapes all dealers in the group's CSV
4. Writes the output CSV to `output/`
5. Uploads the CSV to Google Drive
6. Sends a completion email with results summary

---

## Local Development

No credentials are needed to run the scraper locally. The support scripts (`preflight.js`, `upload-site.js`, `notify-email.js`) skip gracefully when credentials are absent.

### Prerequisites
- Node.js 16+ ([Download](https://nodejs.org/))
- Internet connection

### Installation

```bash
npm install
```

### Running Locally

```bash
# Scrape CDJR dealers
node scraper.js input/dealers_cdjr.csv

# Scrape Buick dealers
node scraper.js input/dealers_buick.csv

# Verbose output (shows selector attempts, page steps)
node scraper.js input/dealers_cdjr.csv -v
```

Output CSV is written to `output/` (created automatically):
```
output/dealers_cdjr_inventory_2025-03-05.csv
```

**Note:** Without `CI=true`, the browser runs in headed (visible) mode so you can watch it work. The CI workflows set `CI=true` to run headless.

---

## GitHub Actions (Automated Runs)

### Required GitHub Secrets

Go to **Settings → Secrets → Actions** in the repository and add:

| Secret | Description |
|--------|-------------|
| `GDRIVE_CLIENT_ID` | Google OAuth2 client ID |
| `GDRIVE_CLIENT_SECRET` | Google OAuth2 client secret |
| `GDRIVE_REFRESH_TOKEN` | OAuth2 refresh token (see `get-gdrive-token.js`) |
| `GDRIVE_FOLDER_ID` | Google Drive folder ID for output uploads |
| `GMAIL_USER` | Gmail address for sending notifications |
| `GMAIL_APP_PASSWORD` | Gmail App Password (not account password) |
| `NOTIFY_TO` | Email address to receive run notifications |

### Manual Trigger

On the **Actions** tab in GitHub, select a workflow and click **Run workflow**.

### Workflow Files

- `.github/workflows/daily-cdjr.yml` — CDJR group, runs at 8 AM EST
- `.github/workflows/daily-buick.yml` — Buick group, runs at 10 AM EST

---

## Input Format

CSV files live in the `input/` directory.

**Required columns:**

| Column | Description |
|--------|-------------|
| `Dealer_Name` | Display name for the dealer |
| `Base_URL` | Inventory page URL |
| `Platform` | Website platform (currently: `DDC`) |

**Example: `input/dealers_cdjr.csv`**
```csv
Dealer_Name,Base_URL,Platform
Elmwood CDJR,https://www.elmwoodcdjr.com/new-inventory/index.htm,DDC
Newport Jeep Ram,https://www.newportjeepram.com/new-inventory/index.htm,DDC
Baldhill Dodge,https://www.baldhilldodgechrysler.net/new-inventory/index.htm,DDC
```

---

## Output Format

CSV with Make, Model, and vehicle counts per dealer:

```csv
Make,Model,Elmwood CDJR,Newport Jeep Ram,Baldhill Dodge
Chrysler,Pacifica,3,1,4
Dodge,Durango,3,2,1
Jeep,Compass,15,8,12
Jeep,Grand Cherokee,42,20,35
Ram,1500,20,25,40
```

- **Sorted** by Make (A-Z), then Model (A-Z)
- **Zero** = model not currently in stock at that dealer
- **ERROR** = dealer site failed to scrape (others continue)
- **Filename** = `{input_name}_inventory_{YYYY-MM-DD}.csv`

---

## Adding a New Dealer Group

1. Create `input/dealers_XXX.csv` with the dealer list
2. Copy an existing workflow file and update:
   - `name:` — display name
   - `cron:` — desired schedule (in UTC)
   - The CSV filename in the `Run scraper` step
3. Add the workflow to `.github/workflows/daily-XXX.yml`
4. The same shared secrets are used by all groups

---

## Supported Platforms

### DDC (dealer.com)

Handles sites hosted on `dealer.com`. Navigates to `?make={MAKE}&status=1-1` (on-lot filter), expands the Model filter, and extracts counts from checkboxes.

### Adding New Platforms

See `PROJECT.md` for the platform handler architecture and how to add support for other dealer website providers.

---

## Troubleshooting

### "Unknown platform" Error
```
❌ Dealer XYZ failed: Unknown platform: AutoTrader
```
Platform not yet supported. See `PROJECT.md` for how to add new platforms.

### Selector Not Found
```
Note: Could not expand Model filter, trying to read anyway...
```
Not necessarily an error — site structure may differ slightly. If counts are missing, run with `-v` to see which selectors were attempted, then update `scraper.js`.

### Network Timeout
```
❌ Dealer ABC failed: Timeout navigating to page
```
Causes: site down, slow connection, or bot detection. The script has 2 automatic retries. Verify the URL loads in a normal browser.

### Zero Inventory for All Models
1. Dealer actually has no inventory (check site manually)
2. Site changed filter structure — run with `-v` to debug
3. Wrong URL in the CSV

### Preflight Fails (CI only)
```
Google Drive ... FAILED
```
Check that all `GDRIVE_*` secrets are correct. Use `node get-gdrive-token.js` to generate a fresh refresh token if needed.

---

## Project Structure

```
dealer-inventory-scraper/
├── .github/
│   └── workflows/
│       ├── daily-cdjr.yml       # CDJR workflow (8 AM EST)
│       └── daily-buick.yml      # Buick workflow (10 AM EST)
├── input/
│   ├── dealers_cdjr.csv         # CDJR dealer list
│   └── dealers_buick.csv        # Buick dealer list
├── output/                      # Generated CSV files (git-ignored)
├── scraper.js                   # Main scraper — reads CSV, writes output/
├── preflight.js                 # Validates Drive + Gmail credentials (CI only)
├── upload-site.js               # Uploads output CSV to Google Drive (CI only)
├── notify-email.js              # Sends start/end email notifications (CI only)
├── get-gdrive-token.js          # Helper: generate OAuth2 refresh token
├── package.json
├── PROJECT.md                   # Detailed architecture and implementation spec
└── README.md                    # This file
```

---

## Performance

- **Sequential**: ~30–60 seconds per dealer
- **Typical runtime**: 5 dealers ≈ 4–6 minutes, 10 dealers ≈ 8–12 minutes

---

## FAQ

**Q: How do I add a dealer to an existing group?**
Add a new row to the group's CSV in `input/` and re-run.

**Q: Can two groups run at the same time?**
Each group is a separate workflow job with its own runner — they can overlap safely.

**Q: Does this work for used inventory?**
Currently filters to "On The Lot" new vehicles (`status=1-1`). Used vehicles need different status codes.

**Q: What if a dealer changes their website?**
The script will fail for that dealer. Run with `-v` to see which selectors failed, then update the selector arrays in `scraper.js`.

**Q: How do I refresh the Google Drive token?**
Run `node get-gdrive-token.js` locally to generate a new refresh token, then update the `GDRIVE_REFRESH_TOKEN` secret.

---

**Version**: 1.2.0
**Last Updated**: March 2025
**Supported Platforms**: DDC (dealer.com)
