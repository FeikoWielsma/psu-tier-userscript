import json

with open('tests/corpus.json', 'r') as f:
    data = json.load(f)

data.extend([
    {
        "name": "Gigabyte P850GM",
        "wattage": 850,
        "site": "pcpp",
        "expectTier": ["B-", "F"],
        "minBand": "strong"
    },
    {
        "name": "Gigabyte P750GM",
        "wattage": 750,
        "site": "pcpp",
        "expectTier": ["B-", "F"],
        "minBand": "strong"
    }
])

with open('tests/corpus.json', 'w') as f:
    json.dump(data, f, indent=2)
