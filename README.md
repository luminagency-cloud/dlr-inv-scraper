# Dealer Inventory Scraper

Automated tool to compare vehicle inventory across multiple dealerships. Scrapes current on-lot inventory by Make and Model from dealer websites and generates comparison CSV reports.

## Quick Start

### Prerequisites
- Node.js 16+ installed ([Download](https://nodejs.org/))
- Internet connection
- CSV file with dealer information

### Installation

```bash
# 1. Extract the zip file
unzip dealer-inventory-scraper.zip
cd dealer-inventory-scraper

# 2. Install dependencies
npm install

# 3. Run the scraper
node scraper.js dealers_cdjr.csv
```

## Usage

### Basic Command
```bash
node scraper.js <dealer_csv_file>
```

### Example
```bash
# Scrape CDJR dealers
node scraper.js dealers_cdjr.csv

# Scrape GMC dealers
node scraper.js dealers_gmc.csv
```

### Output
Creates timestamped CSV file:
```
dealers_cdjr_inventory_2024-12-17.csv
```

## Input Format

Create a CSV file with your dealer list:

**Required Columns:**
- `Dealer_Name` - Display name for the dealer
- `Base_URL` - Inventory page URL
- `Platform` - Website platform (currently supports: `DDC`)

**Example: dealers_cdjr.csv**
```csv
Dealer_Name,Base_URL,Platform
Elmwood CDJR,https://www.elmwoodcdjr.com/new-inventory/index.htm,DDC
Newport Jeep Ram,https://www.newportjeepram.com/new-inventory/index.htm,DDC
Baldhill Dodge,https://www.baldhilldodgechrysler.net/new-inventory/index.htm,DDC
```

## Output Format

CSV with Make, Model, and counts per dealer:

```csv
Make,Model,Elmwood CDJR,Newport Jeep Ram,Baldhill Dodge
Chrysler,Pacifica,3,1,4
Chrysler,Voyager,0,0,0
Dodge,Charger 2-Door,1,0,2
Dodge,Durango,3,2,1
Jeep,Compass,15,8,12
Jeep,Gladiator,10,6,8
Jeep,Grand Cherokee,42,20,35
Jeep,Wrangler,35,18,34
Ram,1500,20,25,40
Ram,2500,8,10,28
Ram,3500,6,5,19
```

### Output Details
- **Sorted**: By Make (A-Z), then Model (A-Z)
- **Zero values**: Model not in stock at that dealer
- **ERROR**: Dealer site failed to scrape (others still processed)
- **Filename**: `{input_name}_inventory_{YYYY-MM-DD}.csv`

## Supported Platforms

### DDC (dealer.com)
Currently the only supported platform. Handles sites like:
- `*.dealer.com`
- dealer.com-hosted inventory pages

**How it works:**
1. Navigates to `?make={MAKE}&status=1-1` (on-lot filter)
2. Expands Model filter section
3. Extracts model counts from checkboxes

### Adding New Platforms
See `design.md` for details on adding support for other dealer website providers.

## Troubleshooting

### "Unknown platform" Error
```
❌ Dealer XYZ failed: Unknown platform: AutoTrader
```
**Solution**: Platform not yet supported. See `design.md` for how to add new platforms, or contact developer.

### Selector Not Found
```
Note: Could not expand Model filter, trying to read anyway...
```
**Not an error** - site structure might differ slightly. If counts are missing, the selector logic needs updating.

### Network Timeout
```
❌ Dealer ABC failed: Timeout navigating to page
```
**Causes**:
- Dealer site is down
- Slow internet connection
- Site blocking automated access

**Solution**:
- Verify site loads in normal browser
- Run script again (has 2 automatic retries)
- Check if site has changed structure

### Zero Inventory for All Models
**Possible causes**:
1. Dealer actually has no inventory (check site manually)
2. Site changed filter structure (selectors need updating)
3. Wrong URL provided (verify Base_URL in CSV)

### All Dealers Show ERROR
**Check**:
- Internet connection working
- Node.js version 16+ (`node --version`)
- Dependencies installed (`npm install`)
- CSV file formatted correctly

## Best Practices

### Running Weekly
1. Keep dealer CSV files in a dedicated folder
2. Name output files clearly: `cdjr_inventory_2024-12-17.csv`
3. Archive previous runs for historical comparison
4. Spot-check a few values against live sites

### Managing Multiple Groups
Create separate CSV files:
```
dealers_cdjr.csv      # Chrysler/Dodge/Jeep/Ram dealers
dealers_gmc.csv       # GMC/Buick dealers  
dealers_luxury.csv    # Jaguar/Land Rover dealers
```

Run independently:
```bash
node scraper.js dealers_cdjr.csv
node scraper.js dealers_gmc.csv
node scraper.js dealers_luxury.csv
```

### Performance
- **Sequential processing**: ~30-60 seconds per dealer
- **Expected runtime**: 3 dealers = 2-3 minutes, 10 dealers = 5-10 minutes
- Script shows progress as it runs

## Error Handling

The scraper is designed to be **fault-tolerant**:

✅ One dealer fails → Others still process  
✅ One make fails → Other makes still process  
✅ Can't find a model → Counts as 0  
✅ Reports all errors at end of run

**Example output with errors:**
```
━━━ Processing: Newport Jeep Ram ━━━
   Detecting available makes...
   Found makes: Jeep, Ram
   Scraping Jeep...
      Jeep: 6 models, 52 units
   Scraping Ram...
      Ram: 5 models, 40 units
✅ Newport Jeep Ram complete

━━━ Processing: Broken Dealer ━━━
❌ Broken Dealer failed: Timeout navigating to page

✅ Output written to: dealers_cdjr_inventory_2024-12-17.csv

⚠️  Failed Dealers (1):
   - Broken Dealer: Timeout navigating to page
```

## Advanced Usage

### Debugging
Run with more verbose output:
```bash
# Add debugging to see what's happening
DEBUG=puppeteer:* node scraper.js dealers_cdjr.csv
```

### Headful Mode (see browser)
Edit `scraper.js` line ~25:
```javascript
// Change this:
const browser = await puppeteer.launch({
  headless: 'new',  // Change to false to see browser
  
// To this:
const browser = await puppeteer.launch({
  headless: false,  // Now you can watch it work
```

### Custom Delays
If sites are slow to load, increase wait times in `scraper.js`:
```javascript
// Search for:
await sleep(2000);

// Increase to:
await sleep(5000);  // Wait 5 seconds instead of 2
```

## Development

### Project Structure
```
dealer-inventory-scraper/
├── package.json       # Dependencies and metadata
├── scraper.js         # Main scraper logic
├── design.md          # Architecture documentation
├── README.md          # This file
├── dealers_cdjr.csv   # Example input
└── .gitignore         # Ignore output and node_modules
```

### Dependencies
- **puppeteer** - Headless Chrome browser automation
- **csv-parse** - Parse input CSV files
- **csv-stringify** - Generate output CSV files

### Testing Changes
```bash
# After editing scraper.js:
node scraper.js dealers_cdjr.csv

# Compare output against known good results
```

## FAQ

**Q: How often should I run this?**  
A: Weekly is typical for inventory tracking. Run more often if needed (daily, bi-weekly).

**Q: Can I run multiple dealer groups at once?**  
A: Not directly. Run each CSV separately. You can combine outputs afterward if needed.

**Q: What if a dealer changes their website?**  
A: The script may fail for that dealer. Check the error message and update selectors in `scraper.js` (or contact developer).

**Q: Can I add more dealers to an existing CSV?**  
A: Yes! Just add new rows to the CSV file and re-run the script.

**Q: Does this work for used car inventory?**  
A: Currently filters to "On The Lot" new vehicles (`status=1-1`). Used vehicles would need different status codes.

**Q: Can I export to Excel?**  
A: The CSV output opens directly in Excel, Google Sheets, or any spreadsheet program.

**Q: Will I get banned from dealer sites?**  
A: The script uses realistic delays and user agents. It's designed to be respectful of dealer sites. We've had no issues so far.

## Support

For issues, questions, or feature requests:

1. Check `design.md` for architecture details
2. Review this README's Troubleshooting section
3. Run in headful mode to see what's happening
4. Contact developer with:
   - Error message
   - Dealer URL that failed
   - Your Node.js version (`node --version`)

## License

Internal business use. See `design.md` for usage guidelines.

---

**Version**: 1.0.0  
**Last Updated**: December 2024  
**Supported Platforms**: DDC (dealer.com)
