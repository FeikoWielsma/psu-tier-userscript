import json
import re
import sys

# Helper to normalize brand keys
def normalize_key(s):
    return re.sub(r'[^a-zA-Z0-9]', '', s.lower())

def generate_js_data(json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Re-organize data by normalized brand for faster lookup
    # Handle "Brand/Alias" by creating references for both
    # e.g. "Antec/Atom" -> psuData['antec'] and psuData['atom']
    psu_map = {}
    
    for item in data:
        # Clean up the definition of brand aliases split by "/"
        # Special case: "FSP (Fortron/Sparkle)" -> "fsp", "fortron", "sparkle"
        raw_brands = item['brand']
        # Remove parenthetical matches for cleaner splitting (e.g. "Abko (Abkoncore)" -> "Abko", "Abkoncore")
        # But slashes inside parens might be tricky.
        # Let's replace parens with space, replace slash with space, then split?
        # "FSP (Fortron/Sparkle)" -> "FSP  Fortron Sparkle " -> ["FSP", "Fortron", "Sparkle"]
        # "Antec/Atom" -> "Antec Atom" -> ["Antec", "Atom"]
        
        # Simple normalization approach:
        cleaned_brand_str = raw_brands.replace('/', ' ').replace('(', ' ').replace(')', ' ')
        brand_tokens = [t for t in cleaned_brand_str.split() if len(t) > 1]
        
        # Always include the original full normalized string just in case
        brand_keys = set()
        brand_keys.add(normalize_key(raw_brands)) # "antecatom"
        for t in brand_tokens:
            brand_keys.add(normalize_key(t)) # "antec", "atom"

        # Special overrides
        if "1st Player" in raw_brands:
            brand_keys.add("1stplayer")
        if "FSP" in raw_brands:
            brand_keys.add("fsp")
            brand_keys.add("fspgroup") 

        for k in brand_keys:
            if not k: continue
            if k not in psu_map:
                psu_map[k] = []
            
            # Create a copy to modify series for matching if needed
            # We will handle multiple series aliases here too
            # "RM-x 2018 / v2 Black" -> split by "/"
            series_str = item['series']
            series_list = [s.strip() for s in series_str.split('/')]
            
            for s in series_list:
                # Remove common efficiency words from matching key because PCPP names often omit them or put them elsewhere
                # e.g. "NGDP Gold" -> Match against "NGDP"
                # But we must be careful not to over-match. "Focus" matches "Focus GX" and "Focus PX"?
                # Let's keep the original series name for display/tie-breaking, 
                # but maybe add a "matchSeries" field.
                
                entry = item.copy()
                entry['matchSeries'] = s # The specific alias
                psu_map[k].append(entry)

    # Sort entries by series length (descending) to match longest specific name first
    for k in psu_map:
        psu_map[k].sort(key=lambda x: len(x['matchSeries']), reverse=True)

    return json.dumps(psu_map)

def generate_userscript():
    json_str = generate_js_data('psu_data.json')
    
    
    # Write processed data to map file for testing (ONLY IF --test ARG IS PRESENT)
    if "--test" in sys.argv:
        with open('psu_lookup_map.json', 'w', encoding='utf-8') as f:
            f.write(json_str)

        # Write data var for testing usage in HTML
        with open('psu_data_var.js', 'w', encoding='utf-8') as f:
            f.write(f"window.psuData = {json_str};")
        print("Generated test artifacts: psu_lookup_map.json and psu_data_var.js")

    with open('userscript_template.js', 'r', encoding='utf-8') as f:
        template = f.read()

    js_content = template.replace("{ 'PSU_DATA_JSON': {} }", json_str)

    with open('psutier.user.js', 'w', encoding='utf-8') as f:
        f.write(js_content)
    print("Generated psutier.user.js")

if __name__ == "__main__":
    generate_userscript()
