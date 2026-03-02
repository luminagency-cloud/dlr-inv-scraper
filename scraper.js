// Use puppeteer-extra with stealth plugin to bypass bot detection
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

// Global verbose flag — set by -v / /v / --verbose
let verbose = false;

// Logging helpers
const vlog = (...args) => { if (verbose) console.log(...args); };

// Platform-specific scrapers
const platformHandlers = {
  DDC: scrapeDDCInventory,
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Note: MSYS/Git Bash converts /v to V:\ before Node sees it — detect both forms
  const isVerboseArg = a => a === '-v' || a === '/v' || a === '--verbose' ||
                            a.toLowerCase() === 'v:\\' || a.toLowerCase() === 'v:/';
  const isFlagArg    = a => a.startsWith('-') || a.startsWith('/') || /^[a-z]:[/\\]?$/i.test(a);

  verbose = args.some(isVerboseArg);
  const csvFile = args.find(a => !isFlagArg(a));

  if (!csvFile) {
    console.error('Usage: node scraper.js <dealer_csv_file> [-v]');
    process.exit(1);
  }

  console.log(`\n  Dealer Inventory Scraper`);
  console.log(`  Input:  ${csvFile}`);
  console.log(`  Mode:   ${verbose ? 'VERBOSE' : 'quiet  (use -v for verbose output)'}\n`);

  const dealers = readDealerCSV(csvFile);
  console.log(`  ${dealers.length} dealers to process\n`);

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized'
    ],
    defaultViewport: null
  });

  const results = [];
  const errors = [];

  for (const dealer of dealers) {
    if (verbose) {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`  ${dealer.name.toUpperCase()}`);
      console.log(`${'─'.repeat(50)}`);
    } else {
      process.stdout.write(`  ${dealer.name} ... `);
    }

    try {
      const dealerData = await processDealerWithRetry(browser, dealer);
      const totalVehicles = countTotal(dealerData);

      if (totalVehicles === 0) {
        if (!verbose) console.log(`FAILED (0 vehicles)`);
        else console.log(`\n  FAILED: 0 vehicles found`);
        errors.push({ dealer: dealer.name, error: 'Found 0 vehicles (likely scraping issue)' });
      } else {
        results.push(dealerData);
        if (!verbose) {
          // Print make totals on same line
          const makeSummary = dealerData.makes
            .map(m => `${m.make}: ${Object.values(m.models).reduce((a,b)=>a+b,0)}`)
            .join('  ');
          console.log(`${totalVehicles} vehicles   (${makeSummary})`);
        } else {
          console.log(`\n  DONE: ${totalVehicles} vehicles`);
        }
      }
    } catch (error) {
      if (!verbose) console.log(`ERROR: ${error.message}`);
      else console.log(`\n  ERROR: ${error.message}`);
      errors.push({ dealer: dealer.name, error: error.message });
    }
  }

  await browser.close();

  // Write CSV output
  console.log(`\n${'─'.repeat(50)}`);
  const masterTable = buildMasterTable(results, dealers);
  const timestamp = new Date().toLocaleDateString('en-CA');
  const outputDir = path.join(__dirname, 'output');
  const inputFileName = path.basename(csvFile, '.csv');
  const outputFile = path.join(outputDir, `${inputFileName}_inventory_${timestamp}.csv`);

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, masterTable);
  console.log(`  Output: ${outputFile}`);

  // Completion summary with color
  const GREEN = '\x1b[32m';
  const RED   = '\x1b[31m';
  const RESET = '\x1b[0m';
  console.log();
  if (errors.length === 0) {
    console.log(`${GREEN}  Run completed with 0 errors${RESET}`);
  } else {
    console.log(`${RED}  Completed with ${errors.length} error${errors.length > 1 ? 's' : ''}:${RESET}`);
    errors.forEach(e => console.log(`${RED}    - ${e.dealer}: ${e.error}${RESET}`));
  }
  console.log();
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function countTotal(dealerData) {
  return dealerData.makes.reduce((sum, m) =>
    sum + Object.values(m.models).reduce((a, b) => a + b, 0), 0);
}

function readDealerCSV(filename) {
  const content = fs.readFileSync(filename, 'utf-8');
  const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
  return records.map(r => ({ name: r.Dealer_Name, baseUrl: r.Base_URL, platform: r.Platform }));
}

async function processDealerWithRetry(browser, dealer, retries = 2) {
  const handler = platformHandlers[dealer.platform];
  if (!handler) throw new Error(`Unknown platform: ${dealer.platform}`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await handler(browser, dealer);
    } catch (error) {
      if (attempt === retries) throw error;
      vlog(`   Retry ${attempt}/${retries - 1}...`);
      await sleep(2000);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POPUP DISMISSAL
// Tries multiple strategies to close modals/popups before they block clicks
// ─────────────────────────────────────────────────────────────────────────────

async function dismissPopups(page) {
  await sleep(800); // give popup time to appear

  const dismissed = await page.evaluate(() => {
    // Common close button selectors
    const closeSelectors = [
      'button[aria-label*="close" i]',
      'button[aria-label*="dismiss" i]',
      '.modal .close',
      '.modal-close',
      '.popup-close',
      '[class*="modal"] [class*="close"]',
      '[class*="popup"] [class*="close"]',
      '[class*="dialog"] [class*="close"]',
      '.fancybox-close-small',
      '#closeXButton',
      'button.close',
    ];

    for (const sel of closeSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        el.click();
        return `selector: ${sel}`;
      }
    }

    // Look for buttons with close-like text
    const allButtons = Array.from(document.querySelectorAll('button, a[role="button"]'));
    for (const btn of allButtons) {
      const text = btn.textContent.trim().toLowerCase();
      if (['close', 'no thanks', 'no, thanks', '×', 'x', 'dismiss', 'got it'].includes(text)
          && btn.offsetParent !== null) {
        btn.click();
        return `text: "${text}"`;
      }
    }

    return null;
  });

  if (dismissed) {
    vlog(`      ✓ Dismissed popup (${dismissed})`);
    await sleep(500);
    return true;
  }

  // Try clicking outside modal on overlay/backdrop
  const hasOverlay = await page.evaluate(() => {
    const overlaySelectors = [
      '.modal-backdrop',
      '[class*="overlay"]',
      '[class*="backdrop"]',
    ];
    for (const sel of overlaySelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return true;
    }
    return false;
  });

  if (hasOverlay) {
    vlog(`      Clicking outside modal to dismiss...`);
    await page.mouse.click(10, 10);
    await sleep(500);
    return true;
  }

  // Last resort: Escape key
  await page.keyboard.press('Escape');
  await sleep(300);
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// DDC PLATFORM SCRAPER
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeDDCInventory(browser, dealer) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const dealerInventory = { dealer: dealer.name, makes: [] };

  try {
    vlog(`   Navigating to inventory page...`);
    await navigateToInventoryPage(page, dealer.baseUrl);
    vlog(`   Loaded: ${page.url()}\n`);

    vlog(`   Detecting makes...`);
    const makes = await detectMakes(page, dealer.baseUrl);
    vlog(`   Makes: ${makes.join(', ')}\n`);

    for (let i = 0; i < makes.length; i++) {
      const make = makes[i];
      if (verbose) console.log(`   ${make}`);

      try {
        const models = await scrapeMakeModels(page, dealer.baseUrl, make);
        dealerInventory.makes.push({ make, models });

        if (verbose) {
          const width = 40;
          for (const [model, count] of Object.entries(models)) {
            const dots = '.'.repeat(Math.max(2, width - model.length - String(count).length));
            console.log(`     ${model} ${dots} ${count}`);
          }
          const makeTotal = Object.values(models).reduce((a,b)=>a+b,0);
          console.log(`     ${'─'.repeat(width)}`);
          console.log(`     Total: ${makeTotal} vehicles\n`);
        }

      } catch (error) {
        vlog(`   ${make}: FAILED — ${error.message}`);
        dealerInventory.makes.push({ make, models: {} });
      }

      if (i < makes.length - 1) await sleep(800);
    }

  } finally {
    await page.close();
  }

  return dealerInventory;
}

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION
// Walks the site menu to reach the New Inventory page
// CRITICAL: Must click through menus so the DDC platform initializes filters
// ─────────────────────────────────────────────────────────────────────────────

async function navigateToInventoryPage(page, baseUrl) {
  const url = new URL(baseUrl);
  const rootDomain = `${url.protocol}//${url.host}`;

  vlog(`      Going to: ${rootDomain}`);
  await page.goto(rootDomain, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1500);

  await dismissPopups(page);

  // STEP 1: Find top-level "New" menu item — get text AND viewport coordinates.
  // We need coordinates so we can physically move the mouse to it, which is the
  // only reliable way to open BOTH click-based and hover-based (CSS :hover) dropdowns.
  vlog(`      Looking for top menu item...`);
  const topMenu = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a, button'));
    for (const el of all) {
      const text = el.textContent.trim();
      const lower = text.toLowerCase();
      const rect = el.getBoundingClientRect();
      if (text.length === 0 || text.length > 60) continue;
      if (rect.top >= window.innerHeight * 0.3) continue;
      if (el.offsetParent === null) continue;
      if (lower === 'new' ||
          lower.includes('new inventory') ||
          lower.includes('new vehicles') ||
          lower === 'new cars' ||
          lower === 'shop new') {
        return { text, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    return null;
  });

  if (!topMenu) throw new Error('Could not find top-level New menu item');
  vlog(`      Found top menu: "${topMenu.text}"`);

  // Physically hover the mouse over the top menu item.
  // This is the ONLY way to open CSS :hover dropdowns (Baldhill-style).
  await page.mouse.move(topMenu.x, topMenu.y);
  await sleep(600);

  // Only fire a synthetic click if the top menu item won't navigate away.
  // If it's a real <a href="..."> link, clicking it leaves root and loses the dropdown.
  // If it's a <button> or <a href="#">, clicking just toggles the dropdown — safe.
  const willNavigate = await page.evaluate((target) => {
    const el = Array.from(document.querySelectorAll('a, button'))
      .find(e => e.textContent.trim() === target && e.offsetParent !== null);
    if (!el || el.tagName === 'BUTTON') return false;
    const href = (el.getAttribute('href') || '').trim();
    return href !== '' && href !== '#' && !href.startsWith('javascript:');
  }, topMenu.text);

  if (!willNavigate) {
    // Click-based dropdown: synthetic click opens it without navigating
    await page.evaluate((target) => {
      const el = Array.from(document.querySelectorAll('a, button'))
        .find(e => e.textContent.trim() === target && e.offsetParent !== null);
      if (el) el.click();
    }, topMenu.text);
    await sleep(800);
  } else {
    vlog(`      Top menu is a nav link — hover only (no click)`);
    await sleep(400);
  }

  await dismissPopups(page);
  // Re-hover after popup dismissal to keep any CSS :hover dropdown open
  await page.mouse.move(topMenu.x, topMenu.y);
  await sleep(400);

  // STEP 2: Find the submenu item while the dropdown is still open
  // (mouse is still physically hovering the top item).
  // Rules:
  //   - Never re-click the parent (same text = skip)
  //   - Skip "specials", "deals", "offers" — we only want the main inventory page
  //   - Prefer clean hrefs (no query params) — promo banners have ?promotionId= etc.
  vlog(`      Looking for submenu item...`);
  const subMenu = await page.evaluate((parentText) => {
    const skipTerms = ['special', 'deal', 'offer', 'promo', 'incentive'];

    const isInventoryHref = href =>
      href.includes('new-inventory') ||
      href.includes('new-vehicles') ||
      href.includes('new-vehicle-inventory');

    const isSkippable = (text, href) =>
      skipTerms.some(t => text.includes(t) || href.includes(t));

    const all = Array.from(document.querySelectorAll('a, button'));

    // Priority: links whose href clearly points to new vehicle inventory, no skip terms
    const candidates = all.filter(el => {
      if (el.tagName !== 'A') return false;
      if (el.offsetParent === null) return false;
      if (el.textContent.trim() === parentText) return false;
      const href = (el.getAttribute('href') || '').toLowerCase();
      const text = el.textContent.trim().toLowerCase();
      return isInventoryHref(href) && !isSkippable(text, href);
    });

    if (candidates.length > 0) {
      const clean = candidates.filter(el => !el.getAttribute('href').includes('?'));
      const winner = clean.length > 0 ? clean[0] : candidates[0];
      return { text: winner.textContent.trim(), href: winner.getAttribute('href') };
    }

    // Fallback: text matching for sites without standard href patterns
    for (const el of all) {
      const text = el.textContent.trim();
      const lower = text.toLowerCase();
      if (text === parentText || el.offsetParent === null) continue;
      if (skipTerms.some(t => lower.includes(t))) continue;
      if (lower.includes('new') && lower.includes('inventory')) {
        return { text, href: el.getAttribute('href') || null };
      }
    }
    return null;
  }, topMenu.text);

  if (!subMenu) throw new Error('Could not find submenu item for New Inventory');
  vlog(`      Found submenu: "${subMenu.text}"`);

  // Navigate to the submenu's URL directly.
  // Trying to click a hover-dropdown link is unreliable — the dropdown may close
  // before the click fires, or CSS pointer-events may block synthetic clicks on
  // hidden elements. Since we already have the href, just go there.
  // For links without an href (rare SPA cases), fall back to synthetic click.
  const navHref = subMenu.href;
  if (navHref) {
    const navUrl = navHref.startsWith('http') ? navHref : `${rootDomain}${navHref}`;
    vlog(`      Navigating to: ${navUrl}`);
    try {
      await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (error) {
      vlog(`      Navigation error: ${error.message}`);
    }
  } else {
    // No href — SPA-style: move mouse to keep dropdown open, then synthetic click
    const subMenuCoords = await page.evaluate((info) => {
      const el = Array.from(document.querySelectorAll('a, button'))
        .find(e => e.textContent.trim() === info.text && e.offsetParent !== null);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, subMenu);
    if (subMenuCoords) {
      await page.mouse.move(subMenuCoords.x, subMenuCoords.y);
      await sleep(300);
    }
    await dismissPopups(page);
    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
        page.evaluate((info) => {
          const el = Array.from(document.querySelectorAll('a, button'))
            .find(e => e.textContent.trim() === info.text && e.offsetParent !== null);
          if (el) el.click();
        }, subMenu)
      ]);
    } catch (error) {
      vlog(`      Navigation timeout: ${error.message}`);
    }
  }

  vlog(`      URL: ${page.url()}`);
  await sleep(1500);
  await dismissPopups(page);
  await sleep(2000);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAKE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

async function detectMakes(page, baseUrl) {
  await sleep(1500);

  // Try to expand Make filter
  const makeExpandSelectors = [
    'button[aria-label*="Make"]',
    'div:has(> h3:text-is("Make")) button',
    'div:has(> h4:text-is("Make")) button',
    '.filter-section:has-text("Make") button.expand-button',
    '.filter-section[data-filter="make"] button'
  ];

  for (const selector of makeExpandSelectors) {
    try {
      const button = await page.$(selector);
      if (button) {
        const expanded = await button.evaluate(el => el.getAttribute('aria-expanded'));
        if (expanded !== 'true') await button.click();
        await sleep(400);
        break;
      }
    } catch (e) { continue; }
  }

  // Extract makes from filter section
  const makes = await page.evaluate(() => {
    const makeLabels = [];

    const filterSections = document.querySelectorAll(
      '.filter-section, .facet, [class*="filter"], div[class*="facet"]'
    );

    for (const section of filterSections) {
      const heading = section.querySelector('h3, h4, .heading, [class*="title"], [class*="header"]');
      if (heading && heading.textContent.toLowerCase().includes('make')) {
        const labels = section.querySelectorAll('label, .option, [class*="facet"], [class*="filter-option"]');
        for (const label of labels) {
          const text = label.textContent.trim();
          const match = text.match(/^([A-Za-z\s\-]+)(?:\s+[\(\[]?\d+[\)\]]?)?$/);
          if (match) {
            const name = match[1].trim();
            const skip = ['make', 'model', 'year', 'price', 'body', 'trim', 'color', 'mileage'];
            if (name && !skip.includes(name.toLowerCase())) makeLabels.push(name);
          }
        }
        break;
      }
    }

    if (makeLabels.length === 0) {
      const links = document.querySelectorAll('a[href*="make="]');
      for (const link of links) {
        const match = link.href.match(/make=([^&]+)/);
        if (match) makeLabels.push(decodeURIComponent(match[1]));
      }
    }

    return [...new Set(makeLabels)];
  });

  if (makes.length === 0) {
    vlog('   Warning: could not auto-detect makes, using CDJR defaults');
    return ['Chrysler', 'Dodge', 'Jeep', 'Ram'];
  }

  return makes;
}

// ─────────────────────────────────────────────────────────────────────────────
// VEHICLE STATUS FILTER  —  select "On The Lot" to exclude in-transit/build orders
// Works the same as Make/Model: find the filter section, expand if needed, click
// the right checkbox. Skips silently if the section isn't present on this site.
// ─────────────────────────────────────────────────────────────────────────────

async function selectOnTheLot(page) {
  // Labels that mean "physically on the lot right now" (case-insensitive)
  const onLotTerms = ['on the lot', 'in stock', 'on lot', 'available', 'on hand'];

  const result = await page.evaluate((terms) => {
    const filterSections = document.querySelectorAll(
      '.filter-section, .facet, [class*="filter"], div[class*="facet"]'
    );

    for (const section of filterSections) {
      const heading = section.querySelector('h3, h4, .heading, [class*="title"], [class*="header"]');
      if (!heading) continue;

      const headingText = heading.textContent.trim().toLowerCase();
      if (!headingText.includes('status') && !headingText.includes('availability')) continue;

      // Found the Vehicle Status section — expand it if collapsed
      const expandBtn = section.querySelector('button[aria-controls]') ||
                        section.querySelector('button');
      if (expandBtn && expandBtn.getAttribute('aria-expanded') === 'false') {
        expandBtn.click();
      }

      // Find and click the "On The Lot" option
      const options = section.querySelectorAll('label, .option, [class*="facet-option"], li');
      for (const opt of options) {
        const text = opt.textContent.trim().toLowerCase();
        if (terms.some(t => text.startsWith(t))) {
          // Check if already selected
          const checkbox = opt.querySelector('input[type="checkbox"]') ||
                           document.getElementById(opt.getAttribute('for'));
          if (checkbox) {
            if (!checkbox.checked) {
              checkbox.click();
              return { clicked: true, label: opt.textContent.trim() };
            }
            return { clicked: false, label: opt.textContent.trim(), alreadyChecked: true };
          }
          // No checkbox — try clicking the element itself (link-style filter)
          opt.click();
          return { clicked: true, label: opt.textContent.trim() };
        }
      }

      return { clicked: false, notFound: true };
    }

    return { clicked: false, noSection: true };
  }, onLotTerms);

  if (result.clicked) {
    vlog(`      Selected status filter: "${result.label}"`);
    await sleep(1500); // wait for inventory to re-filter
  } else if (result.alreadyChecked) {
    vlog(`      Status filter already set: "${result.label}"`);
  } else if (result.noSection) {
    vlog(`      No Vehicle Status filter found (URL param handles it)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAKE FILTER  —  click the Make checkbox if the URL param didn't apply it
// On DDC sites the URL param sets it; on other platforms this actively clicks it.
// ─────────────────────────────────────────────────────────────────────────────

async function selectMakeFilter(page, make) {
  const result = await page.evaluate((makeName) => {
    const lowerMake = makeName.toLowerCase();

    // First try: checkbox whose label matches "MakeName N" or "MakeName (N)"
    const allInputs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    for (const input of allInputs) {
      const label = document.querySelector(`label[for="${input.id}"]`) ||
                    input.closest('label') || input.parentElement;
      if (!label) continue;
      const text = label.textContent.trim();
      // Match "Jeep 93" or "Jeep (93)" — 1-3 digit count only, not model numbers
      if (new RegExp(`^${lowerMake}\\s+[\\(]?\\d{1,3}[\\)]?$`, 'i').test(text)) {
        if (!input.checked) input.click();
        return { found: true, alreadyChecked: input.checked, label: text };
      }
    }

    // Second try: any visible link/button whose text matches the same pattern
    for (const el of document.querySelectorAll('a, button, [role="button"], label')) {
      const text = el.textContent.trim();
      if (new RegExp(`^${lowerMake}\\s+[\\(]?\\d{1,3}[\\)]?$`, 'i').test(text) &&
          el.offsetParent !== null) {
        el.click();
        return { found: true, label: text };
      }
    }

    return { found: false };
  }, make);

  if (result.found) {
    vlog(`      Make filter: "${result.label}"${result.alreadyChecked ? ' (already set via URL)' : ' clicked'}`);
    if (!result.alreadyChecked) await sleep(1500); // wait for re-filter
  } else {
    vlog(`      Make filter: not found as checkbox (URL param may have handled it)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL SCRAPING
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeMakeModels(page, baseUrl, make) {
  // Navigate to the make-filtered URL. DDC sites apply status=1-1 and make= via URL params.
  // For sites that ignore URL params, we click the filters manually in sequence below.
  const currentUrl = new URL(page.url());
  const makeUrl = `${currentUrl.origin}${currentUrl.pathname}?status=1-1&make=${encodeURIComponent(make)}`;
  vlog(`      URL: ${makeUrl}`);

  await page.goto(makeUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(4000);

  // Filter sequence matches the left-panel order on the sites:
  //   1. Vehicle Status  →  select "On The Lot" (skip in-transit / build orders)
  //   2. Make            →  click the make checkbox if URL param didn't apply it
  //   3. Model           →  expand and read counts
  await selectOnTheLot(page);
  await selectMakeFilter(page, make);

  if (verbose) {
    const filters = await checkActiveFilters(page);
    vlog(`      Filter check: ${filters.checkedBoxes.slice(0,3).join(', ') || '(none checked)'}`);
  }

  await expandModelFilter(page);
  await sleep(2500);

  const models = await extractModelCounts(page);

  if (Object.keys(models).length === 0) {
    vlog(`      No models found for ${make}`);
  }

  await uncheckMakeCheckbox(page, make);
  await sleep(800);

  return models;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL FILTER EXPANSION
// ─────────────────────────────────────────────────────────────────────────────

async function expandModelFilter(page) {
  vlog(`      Expanding Model filter...`);

  // Find the Model filter's expand button and capture its aria-controls ID.
  // We use aria-controls as the stable identifier — never button index.
  const buttonInfo = await page.evaluate(() => {
    const sections = document.querySelectorAll('.filter-section, .panel, [class*="filter"], [class*="facet"]');

    for (const section of sections) {
      const headings = section.querySelectorAll('h3, h4, .panel-title, .heading, [class*="title"]');
      for (const heading of headings) {
        if (heading.textContent.toLowerCase().trim() !== 'model') continue;

        let button = heading.querySelector('button');
        if (!button && heading.parentElement)
          button = heading.parentElement.querySelector('button');
        if (!button && heading.closest('.panel-heading, .filter-heading'))
          button = heading.closest('.panel-heading, .filter-heading').querySelector('button');

        if (button) {
          return {
            found: true,
            isExpanded: button.getAttribute('aria-expanded') === 'true',
            ariaControls: button.getAttribute('aria-controls'),
          };
        }
      }
    }
    return { found: false };
  });

  if (!buttonInfo.found) {
    vlog(`      Model expand button not found`);
    return false;
  }

  if (buttonInfo.isExpanded) {
    vlog(`      Model filter already expanded`);
    return true;
  }

  // Click via aria-controls lookup — stable regardless of button order on page
  await page.evaluate((ariaControls) => {
    const btn = ariaControls
      ? document.querySelector(`button[aria-controls="${ariaControls}"]`)
      : null;
    if (btn) btn.click();
  }, buttonInfo.ariaControls);

  await sleep(800);

  const nowExpanded = await page.evaluate((ariaControls) => {
    const btn = ariaControls
      ? document.querySelector(`button[aria-controls="${ariaControls}"]`)
      : null;
    return btn ? btn.getAttribute('aria-expanded') === 'true' : false;
  }, buttonInfo.ariaControls);

  if (!nowExpanded) {
    vlog(`      Forcing Model panel open via DOM...`);
    await page.evaluate((ariaControls) => {
      if (!ariaControls) return;
      const panel = document.getElementById(ariaControls);
      if (panel) {
        panel.classList.remove('collapse');
        panel.classList.add('in', 'show');
        panel.style.display = 'block';
        panel.style.height = 'auto';
      }
      const btn = document.querySelector(`button[aria-controls="${ariaControls}"]`);
      if (btn) btn.setAttribute('aria-expanded', 'true');
    }, buttonInfo.ariaControls);
  }

  vlog(`      Model filter expanded`);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL COUNT EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

async function extractModelCounts(page) {
  const { models } = await page.evaluate(() => {
    const modelCounts = {};

    const filterSections = document.querySelectorAll(
      '.filter-section, .facet, [class*="filter"], div[class*="facet"]'
    );

    for (const section of filterSections) {
      const heading = section.querySelector('h3, h4, .heading, [class*="title"], [class*="header"]');
      if (!heading || !heading.textContent.toLowerCase().includes('model')) continue;

      const expandButton = section.querySelector('button[aria-controls]');
      let panelBody = null;
      if (expandButton) {
        const panelId = expandButton.getAttribute('aria-controls');
        if (panelId) panelBody = document.getElementById(panelId);
      }

      const scope = panelBody || section;

      let options = scope.querySelectorAll('.facet-list-facet-label-text, span.facet-list-facet-label-text');
      if (options.length === 0) options = scope.querySelectorAll('li, label');
      if (options.length === 0) {
        const all = scope.querySelectorAll('*');
        options = Array.from(all).filter(el => {
          if (el === heading || heading.contains(el)) return false;
          const text = el.textContent.trim();
          return text.length > 0 && text.length < 100 && /\d+/.test(text) && el.children.length <= 2;
        });
      }

      for (const option of options) {
        const small = option.querySelector('small');
        if (small) {
          let modelName = '';
          for (const node of option.childNodes) {
            if (node.nodeType === 3) modelName += node.textContent.trim();
          }
          const countMatch = small.textContent.trim().match(/(\d+)/);
          if (modelName && countMatch) {
            const count = parseInt(countMatch[1], 10);
            if (!isNaN(count) && count >= 0) modelCounts[modelName] = count;
          }
        } else {
          const text = option.textContent.trim();
          const match = text.match(/^(.+?)\s+[\(\[]?(\d+)[\)\]]?$/);
          if (match) {
            const modelName = match[1].trim();
            const count = parseInt(match[2], 10);
            if (modelName && !isNaN(count) && count >= 0) modelCounts[modelName] = count;
          }
        }
      }
      break;
    }

    return { models: modelCounts };
  });

  return models;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVE FILTER CHECK (verbose debug only)
// ─────────────────────────────────────────────────────────────────────────────

async function checkActiveFilters(page) {
  return await page.evaluate(() => {
    const checked = [];
    document.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
      const label = document.querySelector(`label[for="${cb.id}"]`) || cb.closest('label') || cb.parentElement;
      checked.push(label ? label.textContent.trim().substring(0, 50) : cb.id);
    });
    return { checkedBoxes: checked, urlParams: window.location.search };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAKE CHECKBOX (uncheck between makes)
// ─────────────────────────────────────────────────────────────────────────────

async function uncheckMakeCheckbox(page, make) {
  return await page.evaluate((makeName) => {
    const labels = Array.from(document.querySelectorAll('label, .option, [class*="facet-option"]'));
    for (const label of labels) {
      const text = label.textContent.trim();
      if (text.startsWith(makeName + ' ') || text === makeName || text.startsWith(makeName + '\n')) {
        const checkbox = label.querySelector('input[type="checkbox"]') ||
                        document.getElementById(label.getAttribute('for'));
        if (checkbox && checkbox.checked) { checkbox.click(); return true; }
      }
    }
    return true;
  }, make);
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT TABLE
// ─────────────────────────────────────────────────────────────────────────────

function buildMasterTable(results, dealers) {
  const allModels = new Map();
  results.forEach(d => {
    d.makes.forEach(m => {
      Object.keys(m.models).forEach(model => {
        const key = `${m.make}|${model}`;
        if (!allModels.has(key)) allModels.set(key, { make: m.make, model });
      });
    });
  });

  const sorted = Array.from(allModels.values()).sort((a, b) => {
    if (a.make !== b.make) return a.make.localeCompare(b.make);
    return a.model.localeCompare(b.model);
  });

  const rows = sorted.map(({ make, model }) => {
    const row = { Make: make, Model: model };
    dealers.forEach(dealer => {
      const d = results.find(r => r.dealer === dealer.name);
      if (d) {
        const m = d.makes.find(m => m.make === make);
        row[dealer.name] = m?.models[model] ?? 0;
      } else {
        row[dealer.name] = 'ERROR';
      }
    });
    return row;
  });

  return stringify(rows, { header: true });
}

// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

if (require.main === module) {
  main().catch(error => {
    console.error('\nFatal error:', error);
    process.exit(1);
  });
}

module.exports = { main, scrapeDDCInventory };
