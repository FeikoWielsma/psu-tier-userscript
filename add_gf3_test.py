import json

with open('tests/corpus.json', 'r') as f:
    data = json.load(f)

data.append({
    "name": "Thermaltake Toughpower GF3 TT Premium",
    "wattage": 850,
    "site": "pcpp",
    "expectTier": ["A+", "B", "B*"],
    "minBand": "strong"
})

with open('tests/corpus.json', 'w') as f:
    json.dump(data, f, indent=2)
