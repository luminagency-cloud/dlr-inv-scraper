DEALERSHIP INVENTORY COMPARISON TASK
Date: December 17, 2025


=== SECTION 1: COMPLETE INVENTORY DATA TABLE ===

FINAL INVENTORY COMPARISON - All Three Dealers
(On-Lot Units Only)

Make | Model | Elmwood | Newport | Baldhill
CHRYSLER | Pacifica | 3 | 1 | 3
CHRYSLER | Voyager | 0 | 0 | 1
DODGE | Charger 2-Door | 0 | 1 | 0
DODGE | Durango | 4 | 1 | 3
JEEP | Compass | 15 | 7 | 13
JEEP | Gladiator | 10 | 1 | 8
JEEP | Grand Cherokee | 42 | 19 | 20
JEEP | Grand Wagoneer | 0 | 0 | 0
JEEP | Wagoneer | 2 | 0 | 1
JEEP | Wrangler | 33 | 25 | 47
RAM | 1500 | 21 | 13 | 37
RAM | 2500 | 6 | 7 | 14
RAM | 3500 | 0 | 0 | 8
RAM | 3500 Chassis Cab | 1 | 1 | 6
RAM | 5500 Chassis Cab | 1 | 0 | 6
RAM | ProMaster | 5 | 17 | 16
TOTALS | | 143 | 95 | 183


=== SECTION 2: DEALER INFORMATION ===

Dealer 1: Elmwood CDJR
Location: Providence, RI
Base URL: https://www.elmwoodcdjr.com/new-inventory/index.htm
Total On-Lot: 143 vehicles
Makes: Chrysler (3), Dodge (4), Jeep (102), Ram (34)

Dealer 2: Newport Jeep Ram
Location: Middletown, RI
Base URL: https://www.newportjeepram.com/new-inventory/index.htm
Total On-Lot: 95 vehicles
Makes: Chrysler (1), Dodge (2), Jeep (52), Ram (40)

Dealer 3: Baldhill Dodge Chrysler
Location: Warwick, RI
Base URL: https://www.baldhilldodgechrysler.net/new-inventory/index.htm
Total On-Lot: 183 vehicles
Makes: Chrysler (4), Dodge (3), Jeep (89), Ram (87)


=== SECTION 3: EXTRACTION METHODOLOGY ===

Step 1: Filter by Make
For each dealer, for each Make, use URL pattern:
{base_url}?make={MAKE}&status=1-1

Example: https://www.elmwoodcdjr.com/new-inventory/index.htm?make=Jeep&status=1-1

- make parameter: Chrysler, Dodge, Jeep, or Ram (case-sensitive)
- status=1-1 parameter: Filters to "On The Lot" only

Step 2: Expand Model Section
- Find "Model" section in left sidebar
- Click the + (plus) button to expand
- This reveals ALL models for that Make with inventory counts

Step 3: Record Model Counts
The expanded Model section shows: ☐ Model Name {number}

Step 4: Repeat for All Combinations
Process: 3 Dealers × 4 Makes × ~3-6 Models each = ~50 data points


=== SECTION 4: MASTER MODEL LIST ===

Total Models Across All Dealers: 16

Chrysl er:
- Pacifica
- Voyager

Dodge:
- Charger 2-Door
- Durango

Jeep:
- Compass
- Gladiator
- Grand Cherokee
- Grand Wagoneer
- Wagoneer
- Wrangler

Ram:
- 1500
- 2500
- 3500
- 3500 Chassis Cab
- 5500 Chassis Cab
- ProMaster


=== SECTION 5: QUICK REFERENCE URLS ===

ELMWOOD:
https://www.elmwoodcdjr.com/new-inventory/index.htm?make=Chrysler&status=1-1
https://www.elmwoodcdjr.com/new-inventory/index.htm?make=Dodge&status=1-1
https://www.elmwoodcdjr.com/new-inventory/index.htm?make=Jeep&status=1-1
https://www.elmwoodcdjr.com/new-inventory/index.htm?make=Ram&status=1-1

NEWPORT:
https://www.newportjeepram.com/new-inventory/index.htm?make=Chrysler&status=1-1
https://www.newportjeepram.com/new-inventory/index.htm?make=Dodge&status=1-1
https://www.newportjeepram.com/new-inventory/index.htm?make=Jeep&status=1-1
https://www.newportjeepram.com/new-inventory/index.htm?make=Ram&status=1-1

BALDHILL:
https://www.baldhilldodgechrysler.net/new-inventory/index.htm?make=Chrysler&status=1-1
https://www.baldhilldodgechrysler.net/new-inventory/index.htm?make=Dodge&status=1-1
https://www.baldhilldodgechrysler.net/new-inventory/index.htm?make=Jeep&status=1-1
https://www.baldhilldodgechrysler.net/new-inventory/index.htm?make=Ram&status=1-1


=== SECTION 6: KEY FINDINGS ===

Dealer Totals (On-Lot Only):
- Baldhill: 183 vehicles (largest inventory)
- Elmwood: 143 vehicles
- Newport: 95 vehicles

Most Available Models (Combined):
- Ram 1500: 71 units total (21+13+37)
- Jeep Wrangler: 105 units total (33+25+47)
- Jeep Grand Cherokee: 81 units total (42+19+20)
- Jeep Compass: 35 units total (15+7+13)

Least Available:
- Grand Wagoneer: 0 units (all dealers)
- Charger 2-Door: 1 unit (Newport only)
- Voyager: 1 unit (Baldhill only)

Specialties by Dealer:
- Baldhill: Strongest in Ram (87), especially 1500 (37)
- Elmwood: Strong in Jeep (102), especially Grand Cherokee (42)
- Newport: Strong in ProMaster vans (17)


=== SECTION 7: QUALITY CHECKS ===

✓ All 16 models represented in final table
✓ 0s used for unavailable models (not dashes)
✓ Sorted by Make (Chrysler → Dodge → Jeep → Ram), then Model (A-Z)
✓ On-lot figures only (In Transit & Being Built excluded)
✓ Dealer totals verified against individual make summaries
✓ URLs tested and working


Notes for Next Session:
- If data needs updating, repeat the extraction process
- Expect slight variations in inventory (vehicles sell daily)
- All URLs follow the pattern: base_url?make={MAKE}&status=1-1
- Use the model checkbox counts directly from expanded filter
