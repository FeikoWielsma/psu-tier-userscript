import json
with open('tests/corpus.json', 'r') as f:
    data = json.load(f)

data.extend([
    {
        "name": "Thermaltake Toughpower GF A3 Snow",
        "wattage": 850,
        "site": "pcpp",
        "expectTier": "B*",
        "minBand": "strong"
    },
    {
        "name": "Thermaltake Toughpower GF A3 ATX 3.0",
        "wattage": 850,
        "site": "pcpp",
        "expectTier": ["B", "B-", "B-", "B*"],
        "minBand": "strong"
    },
    {
        "name": "Thermaltake Toughpower GT",
        "wattage": 850,
        "site": "pcpp",
        "expectTier": "B-*",
        "minBand": "strong"
    },
    {
        "name": "Thermaltake Toughpower GT Snow",
        "wattage": 850,
        "site": "pcpp",
        "expectTier": "B-*",
        "minBand": "strong"
    }
])

with open('tests/corpus.json', 'w') as f:
    json.dump(data, f, indent=2)

