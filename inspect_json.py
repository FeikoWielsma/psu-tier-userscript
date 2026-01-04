import json

with open('psu_lookup_map.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

print("Keys:", list(data.keys())[:10])
if "thermaltake" in data:
    print("Found Thermaltake. Series list:")
    for item in data["thermaltake"]:
        print(f" - Series: '{item['series']}'")
else:
    print("thermaltake key NOT found.")
