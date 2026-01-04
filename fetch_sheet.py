import urllib.request

url = "https://docs.google.com/spreadsheets/u/0/d/1akCHL7Vhzk_EhrpIGkz8zTEvYfLDcaSpZRB6Xt6JWkc/htmlview/sheet?headers=true&gid=1973454078"
output_file = "psu_tier.html"

try:
    with urllib.request.urlopen(url) as response:
        content = response.read()
        with open(output_file, 'wb') as f:
            f.write(content)
    print(f"Successfully downloaded to {output_file}")
except Exception as e:
    print(f"Error: {e}")
