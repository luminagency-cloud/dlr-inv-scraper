# PROJECT SPECIFICATION: Dealer Inventory Scraper
## Version 1.0 | Complete Implementation Guide

---

## EXECUTIVE SUMMARY

**Purpose**: Automated browser-based scraper to extract on-lot vehicle inventory counts by Make and Model from multiple competing dealerships in a local market.

**Technology Stack**: Node.js + Puppeteer (v24.3.0+)

**Primary Platform**: DDC (dealer.com) - hosting ~70% of dealer websites

**Output**: Timestamped CSV comparison table sorted by Make, then Model

**User**: Marketing professional, non-technical client on Mac

---

## BUSINESS CONTEXT

### Use Case
- Track competitive inventory levels across 5-10 local dealers
- Generate weekly reports for client presentations
- Compare inventory trends over time
- Identify market opportunities (models in short supply)

### Execution Model
- Manual trigger (no automation/scheduling)
- Run separately per make group (CDJR, GMC, luxury, etc.)
- 3-10 dealers per group typical
- Runtime: 2-5 minutes per group

### Success Criteria
- Accurate counts matching manual verification
- Graceful handling of site failures (continue processing)
- Repeatable results week-over-week
- Transferable to non-technical client

---

## DATA FLOW OVERVIEW

```
┌─────────────────────────────────────────────────────────┐
│ INPUT: dealers_cdjr.csv                                 │
│   Dealer_Name, Base_URL, Platform                       │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│ FOR EACH DEALER:                                        │
│                                                         │
│  1. Auto-Detect Makes from Website                     │
│     └─► Navigate to base URL with on-lot filter        │
│     └─► Scrape available Make values                   │
│                                                         │
│  2. FOR EACH MAKE:                                      │
│     a. Navigate to Make-filtered URL                   │
│     b. Locate Model filter section in sidebar          │
│     c. Click + button to expand Model section          │
│     d. Extract model checkboxes with counts            │
│     e. Parse: "☐ Model Name 15" → {Model: count}       │
│                                                         │
│  3. Store Results:                                      │
│     {                                                   │
│       dealer: "Elmwood CDJR",                          │
│       makes: [                                          │
│         {                                               │
│           make: "Jeep",                                 │
│           models: {                                     │
│             "Compass": 15,                              │
│             "Wrangler": 42,                             │
│             ...                                         │
│           }                                             │
│         }                                               │
│       ]                                                 │
│     }                                                   │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│ BUILD MASTER TABLE:                                     │
│                                                         │
│  1. Union all Make+Model combinations                  │
│  2. Sort: Make (A-Z), then Model (A-Z)                 │
│  3. Create matrix: rows=models, cols=dealers           │
│  4. Fill: actual count, 0 if not stocked, ERROR if fail│
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│ OUTPUT: dealers_cdjr_inventory_2024-12-17.csv          │
│                                                         │
│ Make,Model,Elmwood,Newport,Baldhill                    │
│ Chrysler,Pacifica,3,1,4                                │
│ Jeep,Wrangler,42,18,35                                 │
│ ...                                                     │
└─────────────────────────────────────────────────────────┘
```

---

## DDC PLATFORM SPECIFICATION

### Known Site Structure

**URL Patterns:**
```
Base:     https://dealer.com/new-inventory/index.htm
On-Lot:   https://dealer.com/new-inventory/index.htm?status=1-1
Filtered: https://dealer.com/new-inventory/index.htm?make=Jeep&status=1-1
```

**Status Codes:**
- `1-1` = On The Lot (use this)
- `7-7` = In Transit (ignore)
- `13-13` = Being Built (ignore)

**Page Layout:**
```
┌─────────────────────────────────────────────────────┐
│ Header / Navigation                                 │
├──────────────┬──────────────────────────────────────┤
│              │                                      │
│  LEFT        │  VEHICLE RESULTS GRID                │
│  SIDEBAR     │                                      │
│              │  [Vehicle cards display here]        │
│  Filters:    │                                      │
│              │                                      │
│  [ ] Make    │                                      │
│    + ←Click │                                      │
│      ☐ Chrysler 3                                  │
│      ☐ Dodge 4                                     │
│      ☐ Jeep 102                                    │
│      ☐ Ram 34                                      │
│              │                                      │
│  [ ] Model   │                                      │
│    + ←Click  │                                      │
│      ☐ Compass 15                                  │
│      ☐ Gladiator 10                                │
│      ☐ Grand Cherokee 42                           │
│      ☐ Wrangler 35                                 │
│      ...more models                                │
│              │                                      │
│  [ ] Year    │                                      │
│  [ ] Price   │                                      │
│              │                                      │
└──────────────┴──────────────────────────────────────┘
```

---

## CRITICAL IMPLEMENTATION STEPS

### STEP 1: Navigate to Base URL with On-Lot Filter

**URL Construction:**
```javascript
const url = `${dealer.baseUrl}?status=1-1`;
```

**Navigation:**
```javascript
await page.goto(url, { 
  waitUntil: 'domcontentloaded',  // Faster than networkidle2
  timeout: 30000 
});

// CRITICAL: Wait for JavaScript to render filters
await page.waitForTimeout(2000);
```

**Why the delay?**
- DDC sites use heavy JavaScript
- Filters are dynamically rendered
- Premature interaction causes selectors to fail

---

### STEP 2: Detect Available Makes

**Objective**: Discover which makes this dealer stocks (not all CDJR dealers stock all 4 makes)

**Method**: Look for Make filter section in left sidebar

**Expected HTML Structure (example):**
```html
<div class="filter-section" data-filter="make">
  <div class="filter-header">
    <h3>Make</h3>
    <button class="expand-button" aria-expanded="false">+</button>
  </div>
  
  <div class="filter-options" style="display: none;">
    <label>
      <input type="checkbox" name="make" value="Chrysler">
      Chrysler <span class="count">(3)</span>
    </label>
    <label>
      <input type="checkbox" name="make" value="Jeep">
      Jeep <span class="count">(102)</span>
    </label>
    <!-- More makes... -->
  </div>
</div>
```

**Navigation Steps:**

1. **Find Make section:**
```javascript
// Look for section containing "Make" heading
const makeSection = await page.$('div:has(> h3:text("Make")), div:has(> h4:text("Make"))');

if (!makeSection) {
  throw new Error('Could not locate Make filter section');
}
```

2. **Click expand button (the + button):**
```javascript
// Find + button within Make section
const expandButton = await makeSection.$('button.expand-button, button[aria-label*="expand"], button:has-text("+")');

if (expandButton) {
  await expandButton.click();
  await page.waitForTimeout(500);  // Wait for expand animation
}
```

3. **Extract make names:**
```javascript
const makes = await makeSection.$$eval('label, .option', elements => {
  return elements.map(el => {
    const text = el.textContent.trim();
    // Parse "Jeep (102)" or "Jeep 102" → extract "Jeep"
    const match = text.match(/^([A-Za-z\s]+?)(?:\s*[\(\[]?\d+[\)\]]?)?$/);
    return match ? match[1].trim() : null;
  }).filter(Boolean);
});
```

**Expected Output:**
```javascript
['Chrysler', 'Dodge', 'Jeep', 'Ram']
```

**Fallback Strategy:**
If Make detection fails, use common CDJR makes as default:
```javascript
const DEFAULT_CDJR_MAKES = ['Chrysler', 'Dodge', 'Jeep', 'Ram'];
```

---

### STEP 3: For Each Make - Navigate to Filtered View

**URL Construction:**
```javascript
const url = `${dealer.baseUrl}?make=${encodeURIComponent(make)}&status=1-1`;
```

**Example:**
```
https://www.elmwoodcdjr.com/new-inventory/index.htm?make=Jeep&status=1-1
```

**Navigation:**
```javascript
await page.goto(url, { 
  waitUntil: 'domcontentloaded',
  timeout: 30000 
});

// CRITICAL: Wait for filters to render
await page.waitForTimeout(2000);
```

**Verification (optional but recommended):**
```javascript
// Verify we're on filtered page
const pageTitle = await page.title();
const urlCheck = page.url();

console.log(`  Loaded: ${urlCheck}`);
console.log(`  Title: ${pageTitle}`);
```

---

### STEP 4: Expand Model Filter Section

**This is THE CRITICAL STEP - the heart of the scraping process**

**Objective**: Click the + button next to "Model" in the left sidebar to reveal all model checkboxes

**Why this matters:**
- DDC sites collapse filter sections by default
- Model list is hidden until expanded
- Without expansion, you get 0 results

**Expected HTML Structure:**
```html
<div class="filter-section" data-filter="model">
  <div class="filter-header">
    <h3>Model</h3>
    <button class="expand-button" aria-expanded="false">+</button>  ← MUST CLICK THIS
  </div>
  
  <!-- HIDDEN until button clicked -->
  <div class="filter-options" style="display: none;">
    <label>
      <input type="checkbox" name="model" value="Compass">
      Compass <span class="count">15</span>
    </label>
    <label>
      <input type="checkbox" name="model" value="Wrangler">
      Wrangler <span class="count">42</span>
    </label>
    <!-- More models... -->
  </div>
</div>
```

**Implementation (try multiple selectors):**

```javascript
async function expandModelFilter(page) {
  const selectors = [
    // Strategy 1: ARIA label
    'button[aria-label*="Model"][aria-label*="expand"]',
    'button[aria-label*="Model"]',
    
    // Strategy 2: Text content
    'button:has-text("Model")',
    'button:near(:text("Model"))',
    
    // Strategy 3: Structure-based
    'div:has(> h3:text("Model")) button',
    'div:has(> h4:text("Model")) button',
    '.filter-section:has(:text("Model")) button.expand-button',
    
    // Strategy 4: Symbol-based
    'button:has-text("+"):near(:text("Model"))',
    
    // Strategy 5: Class-based
    '[class*="model"] button[class*="expand"]',
    '.filter-model button'
  ];

  for (const selector of selectors) {
    try {
      const button = await page.$(selector);
      if (button) {
        console.log(`    ✓ Found Model expand button using: ${selector}`);
        
        // Check if already expanded
        const isExpanded = await button.evaluate(el => 
          el.getAttribute('aria-expanded') === 'true'
        );
        
        if (!isExpanded) {
          await button.click();
          await page.waitForTimeout(1000);  // Wait for animation
          console.log(`    ✓ Expanded Model filter`);
        } else {
          console.log(`    ✓ Model filter already expanded`);
        }
        
        return true;
      }
    } catch (e) {
      continue;
    }
  }

  console.log(`    ⚠ Could not find Model expand button, trying to read anyway...`);
  return false;
}
```

**Critical Success Factor:**
- The expand MUST happen before reading checkboxes
- Without expansion, `$$eval` on checkboxes returns []
- This is the most common failure point

---

### STEP 5: Extract Model Counts from Checkboxes

**Objective**: Parse the expanded Model filter to get model names and inventory counts

**Expected Checkbox Format:**

```
☐ Compass 15
☐ Gladiator 10
☐ Grand Cherokee 42
☐ Grand Wagoneer 5
☐ Wagoneer 8
☐ Wrangler 35
```

or with parentheses:

```
☐ Compass (15)
☐ Wrangler (42)
```

**Parsing Strategy:**

```javascript
async function extractModelCounts(page) {
  const models = await page.$$eval(
    'div:has(> h3:text("Model")) label, div:has(> h4:text("Model")) label, .filter-model label',
    elements => {
      const modelCounts = {};
      
      elements.forEach(label => {
        const text = label.textContent.trim();
        
        // Match patterns:
        // "Wrangler 42"
        // "Wrangler (42)"
        // "Grand Cherokee 42"
        // "Grand Cherokee  (15)"
        const match = text.match(/^(.+?)\s+[\(\[]?(\d+)[\)\]]?$/);
        
        if (match) {
          const modelName = match[1].trim();
          const count = parseInt(match[2], 10);
          
          if (modelName && !isNaN(count)) {
            modelCounts[modelName] = count;
          }
        }
      });
      
      return modelCounts;
    }
  );

  return models;
}
```

**Expected Output:**
```javascript
{
  "Compass": 15,
  "Gladiator": 10,
  "Grand Cherokee": 42,
  "Grand Wagoneer": 5,
  "Wagoneer": 8,
  "Wrangler": 35
}
```

**Edge Cases to Handle:**

1. **Multi-word model names:**
   - "Grand Cherokee" ✓
   - "Grand Wagoneer" ✓
   - "3500 Chassis Cab" ✓

2. **Models with numbers in name:**
   - "Ram 1500" → May appear as "1500" (parent filter already set to Ram)
   - "Ram 2500" → "2500"

3. **Empty inventory:**
   - If make has no on-lot models, return {}
   - Don't fail, just log: "No models found for {make}"

4. **Truncated lists:**
   - Some sites show "View More" button
   - Detect and click if present:
   ```javascript
   const viewMoreButton = await page.$('button:has-text("View More"), button:has-text("Show All")');
   if (viewMoreButton) {
     await viewMoreButton.click();
     await page.waitForTimeout(500);
   }
   ```

---

### STEP 6: Data Aggregation

**Structure per dealer:**
```javascript
{
  dealer: "Elmwood CDJR",
  makes: [
    {
      make: "Chrysler",
      models: {
        "Pacifica": 3,
        "Voyager": 0
      }
    },
    {
      make: "Jeep",
      models: {
        "Compass": 15,
        "Gladiator": 10,
        "Grand Cherokee": 42,
        "Wrangler": 35
      }
    }
  ]
}
```

---

### STEP 7: Build Master Comparison Table

**Process:**

1. **Collect all unique Make+Model combinations:**
```javascript
const allModels = new Set();

results.forEach(dealerData => {
  dealerData.makes.forEach(makeData => {
    Object.keys(makeData.models).forEach(model => {
      allModels.add(`${makeData.make}|${model}`);
    });
  });
});
```

2. **Sort by Make, then Model:**
```javascript
const sortedModels = Array.from(allModels)
  .map(key => {
    const [make, model] = key.split('|');
    return { make, model };
  })
  .sort((a, b) => {
    if (a.make !== b.make) return a.make.localeCompare(b.make);
    return a.model.localeCompare(b.model);
  });
```

3. **Build table rows:**
```javascript
const tableData = sortedModels.map(({ make, model }) => {
  const row = { Make: make, Model: model };
  
  dealers.forEach(dealer => {
    const dealerData = results.find(r => r.dealer === dealer.name);
    
    if (!dealerData) {
      row[dealer.name] = 'ERROR';
    } else {
      const makeData = dealerData.makes.find(m => m.make === make);
      row[dealer.name] = makeData?.models[model] || 0;
    }
  });
  
  return row;
});
```

4. **Convert to CSV:**
```javascript
const csv = stringify(tableData, { header: true });
```

**Example Output:**
```csv
Make,Model,Elmwood CDJR,Newport Jeep Ram,Baldhill Dodge
Chrysler,Pacifica,3,1,4
Chrysler,Voyager,0,0,0
Dodge,Charger 2-Door,1,0,2
Dodge,Durango,3,2,1
Jeep,Compass,15,8,12
Jeep,Gladiator,10,6,8
Jeep,Grand Cherokee,42,20,35
Jeep,Grand Wagoneer,5,2,3
Jeep,Wagoneer,8,4,6
Jeep,Wrangler,35,18,34
Ram,1500,20,25,40
Ram,2500,8,10,28
Ram,3500,6,5,19
Ram,3500 Chassis Cab,0,0,5
Ram,ProMaster,0,0,3
```

**Key Requirements:**
- ✓ Make alphabetical (Chrysler, Dodge, Jeep, Ram)
- ✓ Model alphabetical within make
- ✓ 0 for models not stocked
- ✓ ERROR for failed dealers
- ✓ All models present (union across dealers)

---

## ERROR HANDLING SPECIFICATION

### Error Levels

**Level 1: Non-Fatal Warnings**
- Model expansion button not found → Log warning, try to read anyway
- No models found for a make → Return empty object, continue

**Level 2: Recoverable Errors (Retry)**
- Network timeout → Retry 2x with 2-second delay
- Page load failure → Retry 2x
- Selector timeout → Retry 2x

**Level 3: Fatal Errors (Skip Dealer)**
- Unknown platform → Mark as ERROR, continue to next dealer
- Repeated failures after retries → Mark as ERROR, continue
- Invalid base URL → Mark as ERROR, continue

**Level 4: Critical Errors (Stop Execution)**
- CSV file not found
- CSV malformed (missing required columns)
- Puppeteer launch failure
- No dealers in CSV

### Logging Standards

```javascript
// Success
console.log(`✅ Elmwood CDJR complete`);

// Warning
console.log(`⚠ Could not expand Model filter, trying to read anyway...`);

// Error (dealer-level)
console.error(`❌ Newport Jeep Ram failed: Timeout navigating to page`);

// Progress
console.log(`━━━ Processing: Baldhill Dodge (2/3) ━━━`);
console.log(`   Detecting available makes...`);
console.log(`   Found makes: Chrysler, Dodge, Jeep, Ram`);
console.log(`   Scraping Jeep...`);
console.log(`      Jeep: 6 models, 89 units`);
```

### Error Summary Report

At end of execution:
```
✅ Output written to: dealers_cdjr_inventory_2024-12-17.csv

⚠️  Failed Dealers (1):
   - Newport Jeep Ram: Timeout navigating to page

✨ Scraping complete!
```

---

## VALIDATION & TESTING

### Test Data (Known Good Values)

**Elmwood CDJR** (as of reference collection):
- Chrysler: 3 units
- Dodge: 4 units
- Jeep: 102 units (Compass: 15, Grand Cherokee: 42, Wrangler: 35, etc.)
- Ram: 34 units
- **Total On-Lot: 143**

**Newport Jeep Ram**:
- Chrysler: 1 unit
- Dodge: 2 units
- Jeep: 52 units
- Ram: 40 units
- **Total On-Lot: 95**

**Baldhill Dodge Chrysler**:
- Chrysler: 4 units
- Dodge: 3 units
- Jeep: 89 units
- Ram: 87 units
- **Total On-Lot: 183**

### Validation Checklist

**Per Dealer:**
- [ ] All makes detected correctly
- [ ] Model counts match manual verification (spot-check 3-5 models)
- [ ] Total units approximately correct (±5% tolerance for timing)

**Output CSV:**
- [ ] Sorted by Make A-Z
- [ ] Sorted by Model A-Z within each make
- [ ] All 16 reference models present (even if 0)
- [ ] No missing data (all cells filled)
- [ ] 0s used (not blank or N/A)
- [ ] ERROR used for failed dealers

**File Format:**
- [ ] Valid CSV (opens in Excel/Sheets)
- [ ] Filename format: `{input}_inventory_{YYYY-MM-DD}.csv`
- [ ] Headers: Make, Model, {Dealer Names}

---

## PLATFORM EXTENSION GUIDE

### Adding New Platform Handler

When encountering a non-DDC dealer:

1. **Identify Platform:**
   - Check page source for provider signatures
   - Look for URL patterns
   - Inspect filter mechanisms

2. **Document Structure:**
   - Screenshot the filter sidebar
   - Inspect HTML of filter sections
   - Note JavaScript requirements
   - Record URL query parameters

3. **Implement Handler:**

```javascript
async function scrapeNewPlatformInventory(browser, dealer) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  
  const dealerInventory = {
    dealer: dealer.name,
    makes: []
  };

  try {
    // Platform-specific navigation
    const makes = await detectMakesNewPlatform(page, dealer.baseUrl);
    
    for (const make of makes) {
      const models = await scrapeMakeModelsNewPlatform(page, dealer.baseUrl, make);
      dealerInventory.makes.push({ make, models });
    }
  } finally {
    await page.close();
  }

  return dealerInventory;
}
```

4. **Register Handler:**

```javascript
const platformHandlers = {
  DDC: scrapeDDCInventory,
  NewPlatform: scrapeNewPlatformInventory,
};
```

5. **Test Thoroughly:**
   - Single dealer first
   - Verify all makes detected
   - Validate model counts
   - Test error scenarios

---

## DEPLOYMENT SPECIFICATION

### Current: Command Line Execution

**Requirements:**
- Node.js 16+
- npm or yarn
- Terminal access

**Installation:**
```bash
npm install
```

**Execution:**
```bash
node scraper.js dealers_cdjr.csv
```

### Future: Electron Desktop App

**Features:**
- Drag-and-drop CSV input
- Visual progress indicators
- Automatic output folder opening
- Built-in CSV editor

**Build:**
```bash
npm install electron electron-builder
npm run build-mac  # Creates .app for macOS
```

---

## MAINTENANCE PLAYBOOK

### When Scraping Fails

**1. Identify Scope:**
- One dealer? → Site-specific issue
- All dealers? → Code or network issue
- One make? → Make-specific selector problem

**2. Diagnose:**
```bash
# Run in headful mode to watch
# Edit scraper.js line ~25:
headless: false

# Run and observe browser behavior
node scraper.js dealers_cdjr.csv
```

**3. Common Fixes:**

**Problem: "Could not expand Model filter"**
- Site changed button selector
- Update selectors in `expandModelFilter()`

**Problem: "No models found"**
- Expansion didn't work → Update selectors
- Wrong parent selector → Update `$$eval` query

**Problem: "Timeout navigating"**
- Increase timeout: `timeout: 60000`
- Site may be slow/down → Try again later

**4. Test Fix:**
```bash
# Test against single dealer first
# Then test full list
node scraper.js dealers_cdjr.csv
```

---

## PERFORMANCE TARGETS

**Per Dealer:**
- Make detection: 3-5 seconds
- Per make scraping: 3-5 seconds
- Total per dealer: 15-30 seconds

**Full Run (3 dealers, 4 makes each):**
- Expected: 1-3 minutes
- Acceptable: up to 5 minutes
- Concerning: >10 minutes

**Optimization Opportunities (if needed):**
- Parallel dealer processing
- Reduce `waitForTimeout` durations
- Cache Make lists (if known to be stable)

---

## KNOWN ISSUES & WORKAROUNDS

### Issue #1: Model Filter Already Expanded
**Symptom**: Button click fails because already expanded
**Solution**: Check `aria-expanded` before clicking

### Issue #2: "View More" Button
**Symptom**: Only seeing first 10 models
**Solution**: Detect and click "View More" button before extraction

### Issue #3: Count Format Variations
**Symptom**: Some sites use "(15)" others use "15"
**Solution**: Regex handles both: `[\(\[]?(\d+)[\)\]]?`

### Issue #4: Slow JavaScript Rendering
**Symptom**: Selectors not found despite correct syntax
**Solution**: Increase wait time after navigation: `await page.waitForTimeout(3000);`

---

## SUCCESS METRICS

**Code Quality:**
- ✓ Handles all 3 reference dealers correctly
- ✓ Produces output matching manual verification
- ✓ Gracefully handles 1 dealer failure
- ✓ Clear error messages for debugging
- ✓ Well-commented code

**User Experience:**
- ✓ Simple command-line interface
- ✓ Progress indicators during execution
- ✓ Meaningful error messages
- ✓ Output opens directly in Excel/Sheets
- ✓ Clear documentation

**Maintainability:**
- ✓ Modular platform handlers
- ✓ Easy to add new platforms
- ✓ Selector arrays allow fallbacks
- ✓ Comprehensive logging
- ✓ Version-controlled

---

## CODE ORGANIZATION

```
dealer-inventory-scraper/
├── package.json           # Dependencies
├── scraper.js             # Main script
├── PROJECT.md             # This file (architecture, spec, reference)
├── README.md              # User documentation
├── dealers_cdjr.csv       # Example input (CDJR group)
├── .gitignore             # Ignore node_modules, output files
└── output/                # Generated CSV files (gitignored)
    └── dealers_cdjr_inventory_2024-12-17.csv
```

---

## TECHNICAL DECISIONS

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

---

## FUTURE ENHANCEMENTS

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

---

## SECURITY CONSIDERATIONS

- No credentials stored (public dealer sites)
- No PII collected (only public inventory data)
- User agent set to identify as legitimate browser
- Respectful scraping (sequential, realistic delays)
- Sites can block via robots.txt (respect if detected)

---

## LICENSE & USAGE

- For internal business use
- Not for resale or redistribution
- Respect dealer site terms of service
- Use reasonable rate limits

---

## APPENDIX A: Complete Selector Reference

### DDC Platform Selectors

**Make Section:**
```javascript
// Find section
'div:has(> h3:text("Make"))'
'div:has(> h4:text("Make"))'
'.filter-section[data-filter="make"]'

// Expand button
'button[aria-label*="Make"]'
'button:has-text("+"):near(:text("Make"))'
'.filter-header:has(:text("Make")) button'

// Options
'div:has(> h3:text("Make")) label'
'input[name="make"] + label'
```

**Model Section:**
```javascript
// Find section
'div:has(> h3:text("Model"))'
'div:has(> h4:text("Model"))'
'.filter-section[data-filter="model"]'

// Expand button (CRITICAL)
'button[aria-label*="Model"]'
'button:has-text("+"):near(:text("Model"))'
'.filter-header:has(:text("Model")) button'
'div:has(> h3:text("Model")) button'

// Options (after expansion)
'div:has(> h3:text("Model")) label'
'div:has(> h4:text("Model")) label'
'.filter-model label'
'input[name="model"] + label'
```

**View More Button:**
```javascript
'button:has-text("View More")'
'button:has-text("Show All")'
'button:has-text("See More")'
'.show-more-button'
```

---

## APPENDIX B: CSV Format Specifications

### Input CSV

**Required Format:**
```csv
Dealer_Name,Base_URL,Platform
Elmwood CDJR,https://www.elmwoodcdjr.com/new-inventory/index.htm,DDC
```

**Column Definitions:**
- `Dealer_Name`: Display name (any string, used as column header in output)
- `Base_URL`: Full inventory page URL (must include protocol: https://)
- `Platform`: Handler identifier (DDC, TBD, etc.)

**Rules:**
- Header row required
- UTF-8 encoding
- Comma-delimited
- No blank lines
- Minimum 1 dealer row

### Output CSV

**Format:**
```csv
Make,Model,Dealer1,Dealer2,Dealer3
Chrysler,Pacifica,3,1,4
```

**Column Definitions:**
- `Make`: Vehicle make name
- `Model`: Vehicle model name
- `{Dealer_Name}`: One column per dealer, contains inventory count

**Values:**
- Positive integer: Actual inventory count
- `0`: Model not stocked at this dealer
- `ERROR`: Dealer scraping failed

**Sorting:**
1. Primary: Make (alphabetical A-Z)
2. Secondary: Model (alphabetical A-Z)

---

## REVISION HISTORY

- **v1.1** - Robustness update + consolidated documentation (Mar 2026)
  - 10 selector strategies for Model expansion
  - "View More" button handling
  - Puppeteer 24.3 upgrade
  - Merged design.md into this file (single source of truth)

- **v1.0** - Initial specification (Dec 2024)
  - DDC platform support
  - CDJR dealer group
  - Command-line interface

---

## GLOSSARY

- **DDC**: Dealer.com, major dealer website provider
- **Make**: Vehicle manufacturer (Chrysler, Dodge, Jeep, Ram)
- **Model**: Specific vehicle type (Wrangler, Pacifica, etc.)
- **On-Lot**: Vehicle physically present at dealership (status=1-1)
- **In-Transit**: Vehicle ordered but not arrived (status=7-7) - excluded
- **Platform**: Website hosting provider/system
- **Handler**: Code function specific to a platform

---

**END OF SPECIFICATION**
