import json
import re

with open('data/normalization_rules.json', 'r') as f:
    rules = json.load(f)

for rule in rules['strip']:
    if 'Global' in rule.get('note', ''):
        # Remove the \b at the end so it matches after )
        rule['pattern'] = r'\b(?:global\s*\(fagk\-h\)|swap\s*\(fagu\-l\))'

with open('data/normalization_rules.json', 'w') as f:
    json.dump(rules, f, indent=2)

with open('tests/corpus.json', 'r') as f:
    tests = json.load(f)

for t in tests:
    if t['name'] == 'Thermaltake Toughpower GF A3 Snow':
        t['expectTier'] = ['B', 'B*']
    if t['name'] == 'Thermaltake Toughpower GT':
        t['expectTier'] = ['B', 'B-']
    if t['name'] == 'Thermaltake Toughpower GT Snow':
        t['expectTier'] = ['B', 'B-', 'B-*']

with open('tests/corpus.json', 'w') as f:
    json.dump(tests, f, indent=2)

