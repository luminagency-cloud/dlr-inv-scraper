# DESIGN.md - Dealer Inventory Scraper Architecture

## Overview
Automated web scraping tool to compare vehicle inventory across multiple dealerships. Designed for weekly manual execution to track local market inventory trends.

## Use Case
- **Primary User**: Marketing/sales professional tracking competitive inventory
- **Frequency**: Weekly manual runs (no automation/cron required)
- **Scope**: Local geographic markets (typically 5-10 competing dealers)
- **Output**: CSV comparison table for presentation/analysis

## System Architecture

```
┌─────────────────┐
│  dealers_*.csv  │  ← Input: Dealer list with URLs and platform types
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  scraper.js     │  ← Main orchestrator
└────────┬────────┘
         │
         ├─────────────────────────────────────┐
         │                                     │
         ▼                                     ▼
┌──────────────────┐                 ┌──────────────────┐
│ Platform Handler │                 │ Platform Handler │
│      (DDC)       │                 │   (Future: TBD)  │
└────────┬─────────┘                 └──────────────────┘
         │
         ├─► Detect Makes
         ├─► For Each Make:
         │      └─► Navigate to filtered view
         │      └─► Expand Model filter
         │      └─► Extract model counts
         │
         ▼
┌─────────────────┐
│  Raw Data per   │
│     Dealer      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Build Master   │  ← Combine all dealers
│  Model Union    │  ← Create comparison matrix
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Output CSV with │
│   Timestamp     │
└─────────────────┘
```

## Data Flow

### Input Format
**CSV File** (`dealers_cdjr.csv`):
```csv
Dealer_Name,Base_URL,Platform
Elmwood CDJR,https://www.elmwoodcdjr.com/new-inventory/index.htm,DDC
Newport Jeep Ram,https://www.newportjeepram.com/new-inventory/index.htm,DDC
Baldhill Dodge,https://www.baldhilldodgechrysler.net/new-inventory/index.htm,DDC
```

### Processing Steps

1. **Load Dealer List**
   - Parse CSV file
   - Validate required fields
   - Group by platform type

2. **Launch Browser**
   - Single Puppeteer instance for all operations
   - Realistic user agent and viewport
   - Reuse pages where possible for speed

3. **Per-Dealer Processing**
   ```javascript
   For each dealer:
     Try {
       1. Detect Makes (auto-discover from site)
       2. For each Make:
          a. Navigate to ?make={MAKE}&status=1-1
          b. Expand Model filter section
          c. Extract model names + counts from checkboxes
       3. Return dealer inventory structure
     } Catch {
       Log error, continue to next dealer
     }
   ```

4. **Build Master Table**
   - Union all Make+Model combinations across dealers
   - Sort by Make (alphabetical), then Model (alphabetical)
   - Fill matrix: count if available, 0 if model not stocked, ERROR if dealer failed

5. **Output CSV**
   - Filename: `{input}_inventory_{YYYY-MM-DD}.csv`
   - Format:
     ```csv
     Make,Model,Dealer1,Dealer2,Dealer3
     Chrysler,Pacifica,3,1,4
     Chrysler,Voyager,0,0,0
     Dodge,Durango,2,1,5
     ...
     ```

## Platform Handler Architecture

### Current: DDC (dealer.com)

**URL Structure:**
- Base: `https://dealer.com/new-inventory/index.htm`
- Filter on-lot: `?status=1-1`
- Filter make: `?make={MAKE}&status=1-1`

**Navigation Pattern:**
1. Load filtered URL
2. Wait for JavaScript rendering (2-3 seconds)
3. Find and click Model filter expand button (multiple selector strategies)
4. Extract checkbox labels with counts
5. Parse format: `"Model Name 15"` or `"Model Name (15)"`

**Selectors Attempted (in order):**
```javascript
// For Model expansion:
- 'button[aria-label*="Model"]'
- '.filter-section:has-text("Model") button'
- 'button:has-text("+"):near(:text("Model"))'
- '.facet-title:has-text("Model") + button'

// For Make detection:
- Look for filter section with "Make" heading
- Extract from labels/checkboxes
- Fallback: parse from URL parameters in page links
- Last resort: use CDJR defaults (Chrysler, Dodge, Jeep, Ram)
```

### Future Platforms

When new platform is encountered:

1. **Identify Platform**
   - Inspect page source
   - Identify inventory system (URL patterns, filter mechanisms)
   - Document in this file

2. **Create Handler Function**
   ```javascript
   async function scrapeXYZInventory(browser, dealer) {
     // Platform-specific logic
     return { dealer, makes: [...] };
   }
   ```

3. **Register Handler**
   ```javascript
   const platformHandlers = {
     DDC: scrapeDDCInventory,
     XYZ: scrapeXYZInventory,  // Add new platform
   };
   ```

4. **Update Documentation**

## Error Handling

### Graceful Degradation
```
Error at dealer level → Log error, mark as ERROR in output, continue
Error at make level   → Log warning, skip that make, continue
Error at model level  → Log warning, count as 0, continue
```

### Retry Logic
- Each dealer gets 2 retry attempts
- 2-second delay between retries
- Different error types:
  - Network timeout → Retry
  - Selector not found → Continue (might be empty inventory)
  - Platform unknown → Immediate fail

### Error Output
```
Console:
  ❌ Newport Jeep Ram failed: Timeout navigating to page

CSV:
  Make,Model,Elmwood,Newport,Baldhill
  Jeep,Wrangler,42,ERROR,35
```

## Configuration & Extensibility

### Adding New Make Groups
Create new CSV file:
```bash
# CDJR dealers
dealers_cdjr.csv

# GM dealers  
dealers_gmc.csv

# Luxury dealers
dealers_luxury.csv
```

Run separately:
```bash
node scraper.js dealers_cdjr.csv
node scraper.js dealers_gmc.csv
```

### Adding New Platforms

1. Inspect new dealer site
2. Document URL patterns and DOM structure
3. Write platform handler function
4. Add to `platformHandlers` object
5. Test with single dealer first

Example:
```javascript
async function scrapeAutoTraderInventory(browser, dealer) {
  // AutoTrader-specific navigation
  // ...
  return { dealer, makes: [...] };
}

const platformHandlers = {
  DDC: scrapeDDCInventory,
  AutoTrader: scrapeAutoTraderInventory,
};
```

## Performance Considerations

### Current Approach
- **Browser reuse**: One Puppeteer instance for all dealers
- **Sequential processing**: Dealers processed one at a time
- **Speed**: ~30-60 seconds per dealer (network dependent)

### Potential Optimizations (if needed)
- Parallel dealer processing (multiple browser instances)
- Page pooling (reuse pages between makes)
- Caching of Make lists (if sites don't change often)

**Decision**: Start simple. Only optimize if scraping 20+ dealers becomes too slow.

## Testing Strategy

### Manual Testing Workflow
1. Run against known good dealers (Elmwood, Newport, Baldhill)
2. Compare output CSV against Comet results
3. Verify:
   - All makes detected correctly
   - All models present
   - Counts match expected values
   - 0s where models don't exist
   - Sorting is correct (Make A-Z, Model A-Z)

### Edge Cases to Test
- Dealer site temporarily down → ERROR in output, others continue
- Make with no on-lot inventory → Empty models object
- Model name with special characters → Proper escaping
- Very large inventory (100+ models) → Performance acceptable

## Future Enhancements

### Short-term
- [ ] Better error messages (which selector failed?)
- [ ] Progress indicators (X of Y dealers complete)
- [ ] Validate CSV format before processing

### Medium-term
- [ ] Web UI for non-technical users
- [ ] Historical data storage (append to database/CSV archive)
- [ ] Delta reports (changes since last run)

### Long-term
- [ ] Scheduled execution (if needed)
- [ ] Email reports
- [ ] Dashboard visualization
- [ ] Multiple market support (different regions)

## Deployment Models

### Current: Local Execution
User runs from command line on their machine.

**Pros**: Simple, no infrastructure  
**Cons**: Requires Node.js installed

### Option B: Packaged Executable
Use pkg or electron-builder to create standalone app.

**Pros**: No Node.js required, double-click to run  
**Cons**: Large file size (~100MB with Chrome)

### Option C: Web Application
Node.js server with web UI, deployed to cloud/local server.

**Pros**: No client installation, accessible from anywhere  
**Cons**: Requires server hosting, more complex

## Technical Decisions

### Why Puppeteer over Playwright?
- Simpler installation (batteries included)
- Smaller API surface for maintenance
- Good enough for current needs

### Why Not Comet/Browser Agent?
- Need repeatable, transferable process
- Client needs to run independently
- Want codebase control for debugging/customization

### Why Sequential over Parallel?
- Simpler code
- Avoids overwhelming dealer sites
- Easier to debug
- Fast enough for current scale (3-10 dealers)

### Why CSV over JSON?
- Easy to import to Excel/Google Sheets
- Client familiar with format
- Simple to manipulate/sort after generation

## Maintenance Notes

### When Dealer Sites Change
1. Scraper will fail with selector errors
2. Inspect page source at failing dealer
3. Update selectors in `scrapeMakeModels()` or `detectMakes()`
4. Test against all dealers
5. Document changes in git commit

### When New Platform Needed
1. Get example dealer URL
2. Manually navigate and observe behavior
3. Document URL patterns and filter mechanisms
4. Write handler function
5. Test in isolation before adding to main script

### Monitoring for Changes
- If weekly runs start failing consistently
- If counts seem way off (all dealers suddenly have 0 inventory)
- If new makes/models appear that weren't in previous runs

## Code Organization

```
dealer-inventory-scraper/
├── package.json           # Dependencies
├── scraper.js             # Main script
├── design.md              # This file
├── README.md              # User documentation
├── dealers_cdjr.csv       # Example input (CDJR group)
├── .gitignore             # Ignore node_modules, output files
└── output/                # Generated CSV files (gitignored)
    └── dealers_cdjr_inventory_2024-12-17.csv
```

## Security Considerations

- No credentials stored (public dealer sites)
- No PII collected (only public inventory data)
- User agent set to identify as legitimate browser
- Respectful scraping (sequential, realistic delays)
- Sites can block via robots.txt (respect if detected)

## License & Usage

- For internal business use
- Not for resale or redistribution
- Respect dealer site terms of service
- Use reasonable rate limits
