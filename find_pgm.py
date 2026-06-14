import json

with open("psu_data.json") as f:
    d = json.load(f)

for x in d:
    if "GM" in x.get("model", "") and "P-" in x.get("model", ""):
        print(f"{x['model']} | {x['wattage']} | {x['tier']}")
