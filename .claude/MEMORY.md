# Project Memory — Dealer Inventory Scraper

## Workflow
- **Solo developer** — commit and push directly to `main`, no PRs
- Repo: `https://github.com/luminagency-cloud/dlr-inv-scraper.git`

## Architecture
- Two dealer groups, each controlled by a matching pair of files:
  - `input/dealers_cdjr.csv` + `.github/workflows/daily-cdjr.yml` (runs 8 AM EST)
  - `input/dealers_buick.csv` + `.github/workflows/daily-buick.yml` (runs 10 AM EST)
- To add a new dealer group: add a CSV to `input/` and a workflow YAML to `.github/workflows/`
- All groups share the same GitHub secrets (Drive + Gmail credentials)

## Local Dev
- `node scraper.js input/dealers_cdjr.csv` — no credentials needed, writes to `output/`
- Without `CI=true` the browser runs headed (visible); CI sets `CI=true` for headless
- `preflight.js`, `upload-site.js`, `notify-email.js` all skip gracefully when credentials are absent

## Automated Run Flow (GitHub Actions)
1. `preflight.js` — validates Drive + Gmail creds
2. `notify-email.js` (NOTIFY_MODE=start) — sends "starting" email
3. `scraper.js input/dealers_XXX.csv` — scrapes, writes `output/*.csv`
4. `upload-site.js` — uploads CSV to Google Drive
5. `notify-email.js` — sends completion email with log summary

## Key Files
- `scraper.js` — core scraper, DDC platform handler
- `PROJECT.md` — detailed architecture and implementation spec (master reference)
- `get-gdrive-token.js` — run locally to generate a new `GDRIVE_REFRESH_TOKEN`

## Platform Support
- **DDC** (dealer.com) only — navigates `?make={MAKE}&status=1-1`, expands Model filter, reads checkbox counts
- See `PROJECT.md` for how to add new platform handlers

## GitHub Secrets Required
`GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`, `GDRIVE_REFRESH_TOKEN`, `GDRIVE_FOLDER_ID`,
`GMAIL_USER`, `GMAIL_APP_PASSWORD`, `NOTIFY_TO`
