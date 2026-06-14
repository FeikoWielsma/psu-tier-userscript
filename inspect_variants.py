import csv

with open('psu_tier.csv', encoding='utf-8') as f:
    rows = list(csv.reader(f))

last_v1 = ""
for i, row in enumerate(rows[1:]):
    if not row: continue
    row = (row + [""] * 18)[:18]
    v1 = row[2].strip()
    v2 = row[3].strip()
    
    if v1:
        last_v1 = v1
    elif v2 and last_v1:
        print(f"Row {i+2}: v1 empty, v2='{v2}', could inherit v1='{last_v1}'? Series: {row[1].strip()}")
