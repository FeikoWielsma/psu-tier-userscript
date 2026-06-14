import csv

with open('psu_tier.csv', encoding='utf-8') as f:
    rows = list(csv.reader(f))

last_v1 = ""
last_series = ""
for i, row in enumerate(rows[1:]):
    if not row: continue
    row = (row + [""] * 18)[:18]
    
    brand = row[0].strip()
    series = row[1].strip()
    if series:
        if series != last_series:
            last_series = series
            last_v1 = "" # reset v1 when series changes!
    
    v1 = row[2].strip()
    v2 = row[3].strip()
    
    if v1:
        last_v1 = v1
    elif last_v1:
        if not v2:
             print(f"Row {i+2}: v1 empty, v2 empty, inherit v1='{last_v1}'? Series: {last_series}")
