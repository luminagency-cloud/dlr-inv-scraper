// Use puppeteer-extra with stealth plugin to bypass bot detection
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

// Platform-specific scrapers
const platformHandlers = {
  DDC: scrapeDDCInventory,
  // Add more platforms here as needed
};

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node scraper.js <dealer_csv_file>');
    process.exit(1);
  }

  const csvFile = args[0];
  console.log(`\n🚗 Dealer Inventory Scraper`);
  console.log(`📁 Input: ${csvFile}\n`);

  // Read and parse CSV
  const dealers = readDealerCSV(csvFile);
  console.log(`Found ${dealers.length} dealers to process\n`);

  // Launch browser with stealth mode to bypass bot detection
  const browser = await puppeteer.launch({
    headless: false,  // Run with visible browser for debugging
    slowMo: 100,  // Slow down by 100ms per action for visibility
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled'  // Hide automation
    ]
  });

  const results = [];
  const errors = [];

  // Process each dealer
  for (const dealer of dealers) {
    console.log(`\n━━━ Processing: ${dealer.name} ━━━`);
    
    try {
      const dealerData = await processDealerWithRetry(browser, dealer);
      results.push(dealerData);
      console.log(`✅ ${dealer.name} complete`);
    } catch (error) {
      console.error(`❌ ${dealer.name} failed: ${error.message}`);
      errors.push({
        dealer: dealer.name,
        error: error.message
      });
    }
  }

  await browser.close();

  // Build master inventory table
  console.log(`\n\n━━━ Building Master Inventory Table ━━━`);
  const masterTable = buildMasterTable(results, dealers);

  // Generate output filename with timestamp (local time)
  const timestamp = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format
  const outputFile = csvFile.replace('.csv', `_inventory_${timestamp}.csv`);

  // Write CSV
  fs.writeFileSync(outputFile, masterTable);
  console.log(`\n✅ Output written to: ${outputFile}`);

  // Report errors
  if (errors.length > 0) {
    console.log(`\n⚠️  Failed Dealers (${errors.length}):`);
    errors.forEach(e => console.log(`   - ${e.dealer}: ${e.error}`));
  }

  console.log(`\n✨ Scraping complete!\n`);
}

/**
 * Read and parse dealer CSV file
 */
function readDealerCSV(filename) {
  const content = fs.readFileSync(filename, 'utf-8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
  
  return records.map(r => ({
    name: r.Dealer_Name,
    baseUrl: r.Base_URL,
    platform: r.Platform
  }));
}

/**
 * Process a single dealer with retry logic
 */
async function processDealerWithRetry(browser, dealer, retries = 2) {
  const handler = platformHandlers[dealer.platform];
  
  if (!handler) {
    throw new Error(`Unknown platform: ${dealer.platform}`);
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await handler(browser, dealer);
    } catch (error) {
      if (attempt === retries) throw error;
      console.log(`   Retry ${attempt}/${retries - 1}...`);
      await sleep(2000);
    }
  }
}

/**
 * Scrape inventory from dealer.com (DDC) platform
 * Follows the critical steps outlined in PROJECT.md
 */
async function scrapeDDCInventory(browser, dealer) {
  const page = await browser.newPage();

  // Set LARGE desktop viewport to ensure desktop mode (DDC sites are responsive)
  await page.setViewport({
    width: 2560,  // Extra wide to force desktop layout
    height: 1440,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
  });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // DEBUG: Log network errors (commented out to reduce noise)
  /*
  page.on('response', response => {
    const status = response.status();
    if (status >= 400) {
      console.log(`   ⚠️ HTTP ${status}: ${response.url()}`);
    }
  });

  page.on('requestfailed', request => {
    console.log(`   ❌ Request failed: ${request.url()}`);
  });

  // DEBUG: Log console errors from the page
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`   🔴 Page Error: ${msg.text()}`);
    }
  });
  */

  const dealerInventory = {
    dealer: dealer.name,
    makes: []
  };

  try {
    // STEP 0: Navigate directly to inventory page with on-lot filter
    console.log(`   Step 0: Navigating to inventory page...`);
    const inventoryUrl = `${dealer.baseUrl}?status=1-1`;
    console.log(`      URL: ${inventoryUrl}`);
    await page.goto(inventoryUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await sleep(3000); // Wait for JavaScript to render filters
    console.log(`      ✓ Loaded: ${page.url()}\n`);

    // STEP 1: Detect available makes from the dealer's site
    console.log(`   Step 1: Detecting available makes...`);
    const makes = await detectMakes(page, dealer.baseUrl);

    // STEP 2: For each make, scrape model counts
    console.log(`   Step 2: Scraping inventory for each make...`);
    
    for (let i = 0; i < makes.length; i++) {
      const make = makes[i];
      console.log(`\n   ─── Make ${i+1}/${makes.length}: ${make} ───`);
      
      try {
        const models = await scrapeMakeModels(page, dealer.baseUrl, make);
        
        dealerInventory.makes.push({
          make: make,
          models: models
        });
        
        const modelCount = Object.keys(models).length;
        const totalUnits = Object.values(models).reduce((a, b) => a + b, 0);
        console.log(`   ✓ ${make}: ${modelCount} models, ${totalUnits} units\n`);
        
      } catch (error) {
        console.log(`   ✗ ${make}: Failed - ${error.message}\n`);
        // Continue with next make even if one fails
        dealerInventory.makes.push({
          make: make,
          models: {}
        });
      }
      
      // Small delay between makes to be respectful
      if (i < makes.length - 1) {
        await sleep(1000);
      }
    }

  } finally {
    await page.close();
  }

  return dealerInventory;
}

/**
 * Navigate to inventory page through menu system
 * CRITICAL: Must click through menus for filters to initialize properly
 * Uses smart keyword matching to handle variations like "New" vs "New Inventory"
 */
async function navigateToInventoryPage(page, baseUrl) {
  // Extract root domain from baseUrl
  const url = new URL(baseUrl);
  const rootDomain = `${url.protocol}//${url.host}`;

  console.log(`      Navigating to root: ${rootDomain}`);
  await page.goto(rootDomain, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2000);

  // STEP 1: Smart search for top menu item containing "new"
  console.log(`      Looking for menu item containing "new"...`);
  const menuElement = await page.evaluate(() => {
    // Find ALL links/buttons on the page
    const allElements = Array.from(document.querySelectorAll('a, button'));

    // Filter to likely menu items (short text, in upper part of page)
    const menuCandidates = allElements.filter(el => {
      const text = el.textContent.trim();
      const rect = el.getBoundingClientRect();

      // Menu items are usually: short text, visible, in upper 30% of page
      return text.length > 0 &&
             text.length < 50 &&
             rect.top < window.innerHeight * 0.3 &&
             el.offsetParent !== null;
    });

    for (const el of menuCandidates) {
      const text = el.textContent.trim().toLowerCase();
      // Look for items that are JUST "new" or contain "new" with "inventory"
      if (text === 'new' || text.includes('new inventory') || text.includes('new vehicles')) {
        return {
          text: el.textContent.trim(),
          selector: el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className.split(' ')[0] : ''),
          index: allElements.indexOf(el)
        };
      }
    }
    return null;
  });

  if (!menuElement) {
    throw new Error('Could not find menu item containing "new"');
  }

  console.log(`      ✓ Found menu item: "${menuElement.text}"`);

  // Click the menu item by index
  await page.evaluate((index) => {
    const allElements = document.querySelectorAll('a, button');
    allElements[index].click();
  }, menuElement.index);

  await sleep(1500);

  // STEP 2: Smart search for submenu item with "new" + "inventory"
  console.log(`      Looking for submenu with "inventory"...`);
  const submenuElement = await page.evaluate(() => {
    // Find all visible links (including dropdown items)
    const allLinks = document.querySelectorAll('a, button');

    for (const el of allLinks) {
      const text = el.textContent.trim().toLowerCase();
      const isVisible = el.offsetParent !== null; // Check if visible

      if (isVisible && text.includes('new') && text.includes('inventory')) {
        // Prefer "all new inventory" or "new vehicle inventory"
        return {
          text: el.textContent.trim(),
          html: el.outerHTML.substring(0, 100)
        };
      }
    }
    return null;
  });

  if (!submenuElement) {
    throw new Error('Could not find submenu item with "new" + "inventory"');
  }

  console.log(`      ✓ Found submenu item: "${submenuElement.text}"`);

  // Click the submenu item and wait for navigation
  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
      page.evaluate((text) => {
        const allLinks = document.querySelectorAll('a, button');
        for (const el of allLinks) {
          if (el.textContent.trim() === text && el.offsetParent !== null) {
            el.click();
            break;
          }
        }
      }, submenuElement.text)
    ]);
  } catch (error) {
    console.log(`      ⚠ Navigation wait timed out or failed: ${error.message}`);
    console.log(`      Current URL: ${page.url()}`);
  }

  console.log(`      Navigated to: ${page.url()}`);
  await sleep(3000); // Wait for inventory page to fully load and render filters
}

/**
 * Detect available makes from DDC site
 * Auto-discovers which makes this dealer stocks
 * NOTE: Works with current page, doesn't navigate
 */
async function detectMakes(page, baseUrl) {
  console.log(`   Reading makes from current page...`);

  // CRITICAL: Wait for JavaScript to render filters
  await sleep(2000);

  // Try to expand Make filter section
  console.log(`   Looking for Make filter...`);
  
  try {
    // Find and click Make expansion button
    const makeExpandSelectors = [
      'button[aria-label*="Make"]',
      'div:has(> h3:text-is("Make")) button',
      'div:has(> h4:text-is("Make")) button',
      'button:has-text("+"):near(:text-is("Make"))',
      '.filter-section:has-text("Make") button.expand-button',
      '.filter-section[data-filter="make"] button'
    ];
    
    let expanded = false;
    for (const selector of makeExpandSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          const ariaExpanded = await button.evaluate(el => 
            el.getAttribute('aria-expanded')
          );
          
          if (ariaExpanded !== 'true') {
            await button.click();
            await sleep(500);
            console.log(`   ✓ Expanded Make filter`);
          }
          expanded = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    if (!expanded) {
      console.log(`   Note: Could not expand Make filter, trying to read anyway...`);
    }
  } catch (e) {
    console.log(`   Note: Error expanding Make filter: ${e.message}`);
  }

  // Extract make names from checkboxes/labels
  const makes = await page.evaluate(() => {
    const makeLabels = [];
    
    // Strategy 1: Find filter section with "Make" heading
    const filterSections = document.querySelectorAll(
      '.filter-section, .facet, [class*="filter"], div[class*="facet"]'
    );
    
    for (const section of filterSections) {
      const heading = section.querySelector('h3, h4, .heading, [class*="title"], [class*="header"]');
      
      if (heading && heading.textContent.toLowerCase().includes('make')) {
        // Found Make section, extract options
        const labels = section.querySelectorAll(
          'label, .option, [class*="facet"], [class*="filter-option"]'
        );
        
        for (const label of labels) {
          const text = label.textContent.trim();
          // Match "Jeep (102)" or "Jeep 102" → extract "Jeep"
          const match = text.match(/^([A-Za-z\s\-]+)(?:\s+[\(\[]?\d+[\)\]]?)?$/);
          if (match) {
            const makeName = match[1].trim();
            // Exclude common filter labels
            const excludeWords = ['make', 'model', 'year', 'price', 'body', 'trim', 'color', 'mileage'];
            if (makeName && makeName.length > 0 && !excludeWords.includes(makeName.toLowerCase())) {
              makeLabels.push(makeName);
            }
          }
        }
        break;
      }
    }

    // Strategy 2: Look for make parameter in URL links (fallback)
    if (makeLabels.length === 0) {
      const links = document.querySelectorAll('a[href*="make="]');
      for (const link of links) {
        const match = link.href.match(/make=([^&]+)/);
        if (match) {
          makeLabels.push(decodeURIComponent(match[1]));
        }
      }
    }

    // Remove duplicates
    return [...new Set(makeLabels)];
  });

  // Fallback to common CDJR makes if nothing found
  if (makes.length === 0) {
    console.log('   ⚠ Warning: Could not auto-detect makes, using CDJR defaults');
    return ['Chrysler', 'Dodge', 'Jeep', 'Ram'];
  }

  console.log(`   ✓ Detected makes: ${makes.join(', ')}`);
  return makes;
}

/**
 * Scrape model counts for a specific make
 * Uses checkbox clicking (DDC sites don't apply filters via URL params)
 */
async function scrapeMakeModels(page, baseUrl, make) {
  console.log(`      Navigating to ${make} inventory page...`);

  // STEP 1: Navigate directly to the make-filtered URL
  const makeUrl = `${baseUrl}?status=1-1&make=${encodeURIComponent(make)}`;
  console.log(`      URL: ${makeUrl}`);

  await page.goto(makeUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  // Wait for page to fully load and render filters
  console.log(`      Waiting for page to load...`);
  await sleep(5000);

  console.log(`      Current URL: ${page.url()}`);

  // DEBUG: Check active filters
  await checkActiveFilters(page);

  // STEP 2: Expand Model filter automatically
  await expandModelFilter(page);

  // Wait for AJAX content to load after expansion
  console.log(`      Waiting for AJAX content to load...`);
  await sleep(3000);

  // STEP 3: Extract model names and counts
  const models = await extractModelCounts(page);

  if (Object.keys(models).length === 0) {
    console.log(`      ⚠ No models found for ${make} (may be out of stock)`);
  }

  // STEP 5: Uncheck the Make to reset for next iteration
  await uncheckMakeCheckbox(page, make);
  await sleep(1000);

  return models;
}

/**
 * Expand Make filter section
 */
async function expandMakeFilter(page) {
  const selectors = [
    'button[aria-label*="Make"][aria-label*="expand"]',
    'button[aria-label*="Make"]',
    'div:has(> h3:text-is("Make")) button',
    'div:has(> h4:text-is("Make")) button',
    '.filter-section:has-text("Make") button'
  ];

  for (const selector of selectors) {
    try {
      const button = await page.$(selector);
      if (button) {
        const ariaExpanded = await button.evaluate(el => el.getAttribute('aria-expanded'));
        if (ariaExpanded !== 'true') {
          await page.click(selector);
          await sleep(500);
        }
        return true;
      }
    } catch (e) {
      continue;
    }
  }
  return false;
}

/**
 * Select a specific Make filter checkbox
 * CRITICAL: Must find checkbox WITHIN the Make filter section only
 */
async function selectMakeFilter(page, make) {
  console.log(`      Looking for Make checkbox: ${make}`);

  // DEBUG: Check current URL
  const currentUrl = page.url();
  console.log(`      Current URL: ${currentUrl}`);

  const result = await page.evaluate((makeName) => {
    const debug = { foundItems: [], currentUrl: window.location.href };
    const lowerMake = makeName.toLowerCase();

    // Search for ALL checkboxes on the page whose label matches the make name
    // This is simpler and more robust than trying to find "the Make section" first
    const allInputs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    debug.totalCheckboxes = allInputs.length;

    for (const input of allInputs) {
      let label = null;
      if (input.id) {
        label = document.querySelector(`label[for="${input.id}"]`);
      }
      if (!label) {
        label = input.closest('label') || input.parentElement;
      }

      if (label) {
        const text = label.textContent.trim();
        const lowerText = text.toLowerCase();

        // Match ONLY: "MakeName NN" or "MakeName (NN)" where NN is 1-3 digits (inventory count)
        // Do NOT match: "MakeName 1500" (4 digits = model number) or "MakeName 1500 Truck"
        const exactMakePattern = new RegExp(`^${lowerMake}\\s+[\\(]?\\d{1,3}[\\)]?$`, 'i');

        if (exactMakePattern.test(text)) {
          debug.foundItems.push('checkbox: ' + text.substring(0, 40));
          if (!input.checked) {
            input.click();
          }
          return { success: true, type: 'checkbox', text: text.substring(0, 50) };
        }
      }
    }

    // Strategy 2: Try clickable links/buttons with make name anywhere on page
    const allLinks = Array.from(document.querySelectorAll('a, button, [role="button"], label'));

    for (const elem of allLinks) {
      const text = elem.textContent.trim();

      // Match ONLY: "MakeName NN" or "MakeName (NN)" where NN is 1-3 digits (inventory count)
      // Do NOT match: "MakeName 1500" (4 digits = model number) or "MakeName 1500 Truck"
      const exactMakePattern = new RegExp(`^${lowerMake}\\s+[\\(]?\\d{1,3}[\\)]?$`, 'i');

      if (exactMakePattern.test(text)) {
        debug.foundItems.push('link: ' + text.substring(0, 40));
        elem.click();
        return { success: true, type: 'link', text: text.substring(0, 50) };
      }
    }

    return { success: false, debug };
  }, make);

  if (result.success) {
    console.log(`      ✓ Make filter selected (${result.type}): "${result.text}"`);
  } else {
    console.log(`      ✗ Could not find Make checkbox for "${make}"`);
    if (result.debug) {
      console.log(`         DEBUG: Total checkboxes on page: ${result.debug.totalCheckboxes || 0}`);
      if (result.debug.foundItems && result.debug.foundItems.length > 0) {
        console.log(`         DEBUG: Found items: ${result.debug.foundItems.join(', ')}`);
      }
    }
  }

  return result.success;
}

/**
 * Unselect a specific Make filter checkbox
 */
async function unselectMakeFilter(page, make) {
  return await page.evaluate((makeName) => {
    const labels = Array.from(document.querySelectorAll('label, .option, [class*="facet-option"]'));

    for (const label of labels) {
      const text = label.textContent.trim();
      if (text.startsWith(makeName + ' ') || text === makeName || text.startsWith(makeName + '\n')) {
        const checkbox = label.querySelector('input[type="checkbox"]') ||
                        label.previousElementSibling?.querySelector('input[type="checkbox"]') ||
                        document.getElementById(label.getAttribute('for'));

        if (checkbox && checkbox.checked) {
          checkbox.click();
          return true;
        }
      }
    }
    return true;
  }, make);
}

/**
 * Click Make checkbox (wrapper for selectMakeFilter)
 */
async function clickMakeCheckbox(page, make) {
  return await selectMakeFilter(page, make);
}

/**
 * Uncheck Make checkbox (wrapper for unselectMakeFilter)
 */
async function uncheckMakeCheckbox(page, make) {
  return await unselectMakeFilter(page, make);
}

/**
 * Expand Model filter section by clicking + button
 * This is THE CRITICAL STEP - without it, no models are visible
 */
async function expandModelFilter(page) {
  console.log(`      Attempting to expand Model filter...`);

  // Use page.evaluate to find the Model filter button more precisely
  const buttonInfo = await page.evaluate(() => {
    // Find all filter sections
    const filterSections = document.querySelectorAll('.filter-section, .panel, [class*="filter"], [class*="facet"]');

    for (const section of filterSections) {
      // Look for heading that is EXACTLY "Model"
      const headings = section.querySelectorAll('h3, h4, .panel-title, .heading, [class*="title"]');

      for (const heading of headings) {
        const headingText = heading.textContent.toLowerCase().trim();

        // Must be exactly "model", not just containing it
        if (headingText === 'model') {
          // Found the Model section - now find its expand button
          // The button should be a sibling or parent of the heading
          let button = heading.querySelector('button');

          // If not in heading, look in parent element
          if (!button && heading.parentElement) {
            button = heading.parentElement.querySelector('button');
          }

          // If still not found, check if heading itself is inside a button's parent
          if (!button && heading.closest('.panel-heading, .filter-heading')) {
            const headerDiv = heading.closest('.panel-heading, .filter-heading');
            button = headerDiv.querySelector('button');
          }

          if (button) {
            const ariaExpanded = button.getAttribute('aria-expanded');
            const ariaControls = button.getAttribute('aria-controls');

            return {
              found: true,
              isExpanded: ariaExpanded === 'true',
              ariaControls: ariaControls,
              buttonText: button.textContent.trim(),
              headingText: headingText,
              index: Array.from(document.querySelectorAll('button')).indexOf(button)
            };
          }
        }
      }
    }

    return { found: false };
  });

  if (!buttonInfo.found) {
    console.log(`      ✗ Could not find Model expand button`);
    console.log(`      DEBUG: Searched filter sections but found no Model heading with expand button`);
    return false;
  }

  console.log(`      ✓ Found Model expand button (heading: "${buttonInfo.headingText}", button text: "${buttonInfo.buttonText}", expanded: ${buttonInfo.isExpanded})`);

  if (buttonInfo.isExpanded) {
    console.log(`      ✓ Model filter already expanded`);
    return true;
  }

  // Click the button by index to ensure we click the exact right element
  console.log(`      Clicking Model expand button...`);

  await page.evaluate((index) => {
    const allButtons = document.querySelectorAll('button');
    const targetButton = allButtons[index];
    if (targetButton) {
      // Use click() method instead of triggering events to be more precise
      targetButton.click();
    }
  }, buttonInfo.index);

  // Wait for expansion animation
  await sleep(1000);

  // Verify it expanded by checking aria-expanded again
  const expandedAfterClick = await page.evaluate((index) => {
    const allButtons = document.querySelectorAll('button');
    const targetButton = allButtons[index];
    return targetButton ? targetButton.getAttribute('aria-expanded') === 'true' : false;
  }, buttonInfo.index);

  if (!expandedAfterClick) {
    console.log(`      ⚠ Warning: aria-expanded still false, forcing panel open via DOM...`);

    // Force open using DOM manipulation
    await page.evaluate((info) => {
      if (info.ariaControls) {
        const panel = document.getElementById(info.ariaControls);
        if (panel) {
          panel.classList.remove('collapse');
          panel.classList.add('collapse', 'in', 'show');
          panel.style.display = 'block';
          panel.style.height = 'auto';

          // Also set button state
          const allButtons = document.querySelectorAll('button');
          const targetButton = allButtons[info.index];
          if (targetButton) {
            targetButton.setAttribute('aria-expanded', 'true');
          }
        }
      }
    }, buttonInfo);

    console.log(`      ✓ Model filter forced open`);
  } else {
    console.log(`      ✓ Model filter expanded successfully`);
  }

  return true;
}

/**
 * Click "View More" or "Show All" button if present
 * Some sites truncate the model list
 */
async function clickViewMoreIfPresent(page) {
  const viewMoreSelectors = [
    'button:has-text("View More")',
    'button:has-text("Show All")',
    'button:has-text("See More")',
    '.show-more-button',
    'button.view-more'
  ];

  for (const selector of viewMoreSelectors) {
    try {
      const button = await page.$(selector);
      if (button) {
        console.log(`      ✓ Clicking "View More" button...`);
        await button.click();
        await sleep(500);
        return;
      }
    } catch (e) {
      continue;
    }
  }
}

/**
 * Extract model counts from expanded filter section
 * Expected format: "☐ Model Name 15" or "☐ Model Name (15)"
 */
async function extractModelCounts(page) {
  console.log(`      Extracting model counts...`);

  const { models, debugInfo } = await page.evaluate(() => {
    const modelCounts = {};
    const debug = { foundSections: [], modelSection: null, options: [] };

    // COMPREHENSIVE DEBUGGING: Find ALL panels on the page
    const allPanelsDebug = [];
    const allElements = document.querySelectorAll('[id*="panel"], [id*="collapse"], [class*="panel"]');

    for (const el of allElements) {
      const spanCount = el.querySelectorAll('span.facet-list-facet-label-text').length;
      const liCount = el.querySelectorAll('li').length;
      const labelCount = el.querySelectorAll('label').length;

      if (spanCount > 0 || liCount > 0 || labelCount > 0) {
        allPanelsDebug.push({
          id: el.id || '(no id)',
          className: el.className,
          tagName: el.tagName,
          spanCount,
          liCount,
          labelCount,
          innerHTML: el.innerHTML.substring(0, 300)
        });
      }
    }
    debug.allPanels = allPanelsDebug;

    // Find Model filter section by looking for heading
    const filterSections = document.querySelectorAll(
      '.filter-section, .facet, [class*="filter"], div[class*="facet"]'
    );

    debug.foundSections = Array.from(filterSections).map(s => {
      const heading = s.querySelector('h3, h4, .heading, [class*="title"], [class*="header"]');
      return heading ? heading.textContent.trim() : '(no heading)';
    });

    for (const section of filterSections) {
      // Check if this section is for Model
      const heading = section.querySelector('h3, h4, .heading, [class*="title"], [class*="header"]');

      if (!heading || !heading.textContent.toLowerCase().includes('model')) {
        continue;
      }

      debug.modelSection = heading.textContent.trim();

      // Find the expand button to get the panel body ID
      const expandButton = section.querySelector('button[aria-controls]');
      let panelBody = null;

      if (expandButton) {
        const panelId = expandButton.getAttribute('aria-controls');
        if (panelId) {
          panelBody = document.getElementById(panelId);
          debug.panelId = panelId;
          debug.panelFound = !!panelBody;
        }
      }

      // Search in panel body if found, otherwise search in section
      const searchScope = panelBody || section;

      // DEBUG: Check what's in searchScope
      debug.searchScopeTag = searchScope.tagName;
      debug.searchScopeHTML = searchScope.innerHTML.substring(0, 1000);
      debug.hasUL = searchScope.querySelector('ul') !== null;
      debug.liCount = searchScope.querySelectorAll('li').length;
      debug.labelCount = searchScope.querySelectorAll('label').length;

      // DDC structure: <span class="facet-list-facet-label-text">MODEL<small>COUNT</small></span>
      let options = searchScope.querySelectorAll('.facet-list-facet-label-text, span.facet-list-facet-label-text');

      // Fallback: try list items
      if (options.length === 0) {
        options = searchScope.querySelectorAll('li, label');
      }

      // If still nothing, look for ANY element with text that looks like "ModelName 15" or "ModelName (15)"
      if (options.length === 0) {
        const allElements = searchScope.querySelectorAll('*');
        options = Array.from(allElements).filter(el => {
          // Skip the heading itself
          if (el === heading || heading.contains(el)) return false;

          const text = el.textContent.trim();
          // Must have reasonable length and match pattern with a number
          return text.length > 0 &&
                 text.length < 100 &&
                 /\d+/.test(text) && // Contains a number
                 el.children.length <= 2; // Not a big container
        });
      }

      debug.options = Array.from(options).slice(0, 10).map(o => o.textContent.trim());

      // If still no options, show panel body HTML for debugging
      if (options.length === 0 && panelBody) {
        debug.panelBodyHTML = panelBody.innerHTML.substring(0, 800);
      } else if (options.length === 0) {
        debug.sectionHTML = section.innerHTML.substring(0, 500);
      }

      for (const option of options) {
        // DDC structure: model name in span text, count in <small> tag
        const smallTag = option.querySelector('small');

        if (smallTag) {
          // Get model name from span's direct text (excluding small tag content)
          let modelName = '';
          for (const node of option.childNodes) {
            if (node.nodeType === 3) { // Text node
              modelName += node.textContent.trim();
            }
          }

          // Get count from small tag
          const countText = smallTag.textContent.trim();
          const countMatch = countText.match(/(\d+)/);

          if (modelName && countMatch) {
            const count = parseInt(countMatch[1], 10);
            if (!isNaN(count) && count >= 0) {
              modelCounts[modelName] = count;
            }
          }
        } else {
          // Fallback: try old pattern matching for other sites
          const text = option.textContent.trim();
          const match = text.match(/^(.+?)\s+[\(\[]?(\d+)[\)\]]?$/);

          if (match) {
            const modelName = match[1].trim();
            const count = parseInt(match[2], 10);

            if (modelName && modelName.length > 0 && !isNaN(count) && count >= 0) {
              modelCounts[modelName] = count;
            }
          }
        }
      }

      // Found the Model section, stop looking
      break;
    }

    return { models: modelCounts, debugInfo: debug };
  });

  // Debug output
  console.log(`\n      ==== ALL PANELS ON PAGE ====`);
  if (debugInfo.allPanels && debugInfo.allPanels.length > 0) {
    for (let i = 0; i < Math.min(10, debugInfo.allPanels.length); i++) {
      const panel = debugInfo.allPanels[i];
      console.log(`      Panel ${i+1}: ${panel.tagName} id="${panel.id}"`);
      console.log(`        spans: ${panel.spanCount}, li: ${panel.liCount}, labels: ${panel.labelCount}`);
      console.log(`        HTML preview: ${panel.innerHTML.substring(0, 200)}...`);
    }
  } else {
    console.log(`      No panels found with content!`);
  }
  console.log(`      ============================\n`);

  console.log(`      DEBUG: Found ${debugInfo.foundSections.length} filter sections: ${debugInfo.foundSections.slice(0, 5).join(', ')}`);
  if (debugInfo.modelSection) {
    console.log(`      DEBUG: Model section heading: "${debugInfo.modelSection}"`);
    if (debugInfo.panelId) {
      console.log(`      DEBUG: Panel ID: ${debugInfo.panelId}, Found: ${debugInfo.panelFound}`);
    }
    if (debugInfo.searchScopeTag) {
      console.log(`      DEBUG: SearchScope: ${debugInfo.searchScopeTag}, hasUL: ${debugInfo.hasUL}, li: ${debugInfo.liCount}, labels: ${debugInfo.labelCount}`);
    }
    console.log(`      DEBUG: First few options: ${debugInfo.options.slice(0, 3).join(' | ')}`);
    if (debugInfo.searchScopeHTML) {
      console.log(`      DEBUG: SearchScope HTML: ${debugInfo.searchScopeHTML.substring(0, 500)}...`);
    }
  } else {
    console.log(`      DEBUG: No Model section found`);
  }
  
  const modelCount = Object.keys(models).length;
  const totalUnits = Object.values(models).reduce((a, b) => a + b, 0);
  console.log(`      ✓ Found ${modelCount} models, ${totalUnits} units`);

  return models;
}

/**
 * Build master comparison table from all dealer results
 */
function buildMasterTable(results, dealers) {
  // Build union of all Make+Model combinations
  const allModels = new Map(); // Key: "Make|Model", Value: { make, model }
  
  results.forEach(dealerData => {
    dealerData.makes.forEach(makeData => {
      Object.keys(makeData.models).forEach(model => {
        const key = `${makeData.make}|${model}`;
        if (!allModels.has(key)) {
          allModels.set(key, {
            make: makeData.make,
            model: model
          });
        }
      });
    });
  });

  // Sort by Make, then Model
  const sortedModels = Array.from(allModels.values()).sort((a, b) => {
    if (a.make !== b.make) return a.make.localeCompare(b.make);
    return a.model.localeCompare(b.model);
  });

  // Build table rows
  const tableData = sortedModels.map(({ make, model }) => {
    const row = { Make: make, Model: model };
    
    // Add count for each dealer
    dealers.forEach(dealer => {
      const dealerData = results.find(r => r.dealer === dealer.name);
      
      if (dealerData) {
        const makeData = dealerData.makes.find(m => m.make === make);
        row[dealer.name] = makeData?.models[model] || 0;
      } else {
        row[dealer.name] = 'ERROR';
      }
    });

    return row;
  });

  // Convert to CSV
  return stringify(tableData, { header: true });
}

/**
 * DEBUG: Check what filters are currently selected on the page
 */
async function checkActiveFilters(page) {
  const activeFilters = await page.evaluate(() => {
    const filters = {
      checkedBoxes: [],
      activeElements: [],
      urlParams: window.location.search
    };

    // Find all checked checkboxes
    const checked = document.querySelectorAll('input[type="checkbox"]:checked');
    checked.forEach(cb => {
      const label = document.querySelector(`label[for="${cb.id}"]`) || cb.closest('label') || cb.parentElement;
      filters.checkedBoxes.push(label ? label.textContent.trim().substring(0, 50) : cb.id);
    });

    // Find elements with "active" or "selected" classes
    const active = document.querySelectorAll('.active, .selected, [aria-selected="true"]');
    active.forEach(el => {
      filters.activeElements.push(el.textContent.trim().substring(0, 50));
    });

    return filters;
  });

  console.log(`      🔍 Active Filters:`);
  console.log(`         URL params: ${activeFilters.urlParams || '(none)'}`);
  console.log(`         Checked: ${activeFilters.checkedBoxes.slice(0, 5).join(', ') || '(none)'}`);
  console.log(`         Active elements: ${activeFilters.activeElements.slice(0, 5).join(', ') || '(none)'}`);

  return activeFilters;
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main, scrapeDDCInventory };
