import json

with open('tests/corpus.json', 'r') as f:
    data = json.load(f)

data.extend([
    {
        "name": "Gigabyte UD1000GM",
        "wattage": 1000,
        "site": "pcpp",
        "expectTier": "C+",
        "expectLimited": True,
        "minBand": "strong"
    },
    {
        "name": "Gigabyte UD750GM",
        "wattage": 750,
        "site": "pcpp",
        "expectTier": "B+",
        "expectLimited": False,
        "minBand": "strong"
    }
])

with open('tests/corpus.json', 'w') as f:
    json.dump(data, f, indent=2)
