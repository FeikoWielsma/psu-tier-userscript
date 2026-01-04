import json

def generate_data_var():
    with open('psu_data.json', 'r', encoding='utf-8') as f:
        psu_data = json.load(f)

    brand_map = {}
    for item in psu_data:
        brand = item['brand'].lower().replace(" ", "")
        if brand not in brand_map:
            brand_map[brand] = []
        brand_map[brand].append(item)
    
    json_str = json.dumps(brand_map)
    
    content = f"window.psuData = {json_str};"
    
    with open('psu_data_var.js', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == "__main__":
    generate_data_var()
