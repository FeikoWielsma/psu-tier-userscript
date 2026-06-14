import csv

with open('psu_tier.csv', encoding='utf-8') as f:
    rows = list(csv.reader(f))

brand = series = variant1 = variant2 = ""
for i, row in enumerate(rows[1:]):
    if not row: continue
    row = (row + [""] * 18)[:18]
    
    if row[0].strip():
        brand = row[0].strip()
        
    series_cell = row[1].strip()
    if series_cell:
        series = series_cell
        variant1 = ""
        variant2 = ""
        
    v1_cell = row[2].strip()
    if v1_cell:
        variant1 = v1_cell
        variant2 = ""
        
    v2_cell = row[3].strip()
    if v2_cell:
        variant2 = v2_cell
        
    if "ROG" in series or series in ("MAG", "Core Reactor", "C Series"):
        print(f"Row {i+2}: {brand} | {series} | {variant1} | {variant2} | {row[4]}")
