import urllib.request
import logging
import sys

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

url = "https://docs.google.com/spreadsheets/u/0/d/1akCHL7Vhzk_EhrpIGkz8zTEvYfLDcaSpZRB6Xt6JWkc/htmlview/sheet?headers=true&gid=1973454078"
output_file = "psu_tier.html"

def main():
    try:
        logging.info(f"Downloading from {url}...")
        # Added timeout=30 to prevent indefinite hanging (DoS prevention)
        with urllib.request.urlopen(url, timeout=30) as response:
            content = response.read()
            with open(output_file, 'wb') as f:
                f.write(content)
        logging.info(f"Successfully downloaded to {output_file}")
    except Exception as e:
        logging.error(f"Failed to download file: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
