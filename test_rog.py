import csv

with open('psu_tier.csv', encoding='utf-8') as f:
    rows = list(csv.reader(f))

for i, row in enumerate(rows[1:]):
    if not row: continue
    row = (row + [""] * 18)[:18]
    if "Strix" in row[1] or "Strix" in row[2]:
        print(f"Row {i+2}: S='{row[1]}' V1='{row[2]}' V2='{row[3]}' W='{row[4]}'")
    elif not row[1].strip() and not row[2].strip() and "ROG" in str(rows[i]):
        print(f"Row {i+2}: S='{row[1]}' V1='{row[2]}' V2='{row[3]}' W='{row[4]}'")
