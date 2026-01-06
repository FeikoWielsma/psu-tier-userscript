from bs4 import BeautifulSoup
import json
import re

def parse_html_table(html_file):
    with open(html_file, 'r', encoding='utf-8') as f:
        soup = BeautifulSoup(f, 'html.parser')

    table = soup.find('table', class_='waffle')
    if not table:
        print("Could not find table with class 'waffle'")
        return []

    rows = table.find_all('tr')
    
    # Clean rows: remove rows that don't have data cells or are just empty
    # But wait, we need to respect the index for rowspan tracking.
    # So we shouldn't filter rows yet.

    # Determine grid dimensions
    max_cols = 0
    for row in rows[:10]:
        cells = row.find_all(['td', 'th'])
        current_cols = 0
        for cell in cells:
            colspan = int(cell.get('colspan', 1))
            current_cols += colspan
        max_cols = max(max_cols, current_cols)
    
    # Create grid
    grid = [[None for _ in range(max_cols)] for _ in range(len(rows))]
    
    for r_idx, row in enumerate(rows):
        cells = row.find_all(['td', 'th'])
        c_idx = 0
        
        for cell in cells:
            while c_idx < max_cols and grid[r_idx][c_idx] is not None:
                c_idx += 1
            
            if c_idx >= max_cols:
                break
                
            text = cell.get_text(" ", strip=True)
            rowspan = int(cell.get('rowspan', 1))
            colspan = int(cell.get('colspan', 1))
            
            for r in range(rowspan):
                for c in range(colspan):
                    if r_idx + r < len(rows) and c_idx + c < max_cols:
                        grid[r_idx + r][c_idx + c] = text
            
            c_idx += colspan

    # Extract data
    # We found that Index 0 is the row number.
    # Brand is Index 1.
    # Series is Index 2, 3, 4.
    # Wattage is Index 5.
    # Tier is Index 6.
    
    extracted_data = []
    
    # Find the start row by looking for "1st Player" or data pattern.
    start_row = 0
    for i, row_data in enumerate(grid):
        # Check if column 1 looks like a brand (e.g., "1st Player") and not a header ("Brand")
        if len(row_data) > 6 and row_data[1] == "1st Player":
            start_row = i
            break
            
    if start_row == 0:
        # Fallback manual start
        start_row = 4

    for r_idx in range(start_row, len(rows)):
        row_data = grid[r_idx]
        if not row_data or len(row_data) < 7:
            continue
            
        brand = row_data[1]
        
        # Series: join unique non-empty values from col 2, 3, 4
        series_parts = []
        # Use a list to keep order and uniqueness
        raw_series = [row_data[2], row_data[3], row_data[4]]
        
        # Filter raw_series: remove None or empty strings
        raw_series = [s for s in raw_series if s and s.strip()]
        
        # Deduplicate consecutive
        prev = None
        for s in raw_series:
            if s != prev:
                series_parts.append(s)
                prev = s
                
        series = " ".join(series_parts)
        
        # Clean Series Name:
        # Remove " - " trailing or leading
        series = series.strip("- ")
        # Remove content in parenthesis which often denotes platform or extra info not present in PCPP title
        # e.g. ("Gen 5"), (ATX 3.0), (OEM/SI)
        # But handle cases like (2018) which might be useful? 
        # PCPP often has (2023) etc.
        # Let's keep year, remove others? No, hard to distinguish.
        # Let's remove parenthesis content if it looks like noise.
        # "RM-e 2023 (\"Gen 5\")" -> "RM-e 2023"
        # "SF Platinum 2024 (ATX 3.1)" -> "SF Platinum 2024"
        # "Focus GX (OneSeasonic)" -> "Focus GX"
        # "Core BBS-S" -> keep.
        # Regex to remove (...)
        series = re.sub(r'\s*\(.*?\)', '', series)
        series = series.strip()
        
        wattage = row_data[5]
        tier = row_data[6]
        
        # Filter out rows where Tier is obviously not a Tier (e.g. "Tier" header or empty)
        if not tier or tier == "Tier":
            continue
            
        # Optional: Clean up Wattage strings (remove links if they were just text, though get_text handles it)
        # Clean Tier: sometimes it has footnote markers or links
        
        # Extract additional details - CORRECTED MAPPING (v1.8)
        # Col 0: Index
        # Col 1: Brand
        # Col 2-4: Series
        # Col 5: Wattage
        # Col 6: ?
        # Col 7: Form Factor
        # Col 8: ATX Version
        # Col 9: ?
        # Col 10: Modular
        # Col 11: Efficiency (W, B, S, G, P, T)
        # Col 12: Topology Primary
        # Col 13: Topology Secondary
        # Col 14: Topology SR
        # Col 15: ODM
        # Col 16: Platform
        # Col 17: Notes

        def safe_get(idx):
            return row_data[idx] if len(row_data) > idx and row_data[idx] else None
        
        # Debug block removed




        year = None # Year is apparently not in a fixed column or was misidentified. 
        # User said "Release year" is in sheet. 
        # In Corsair sample (Step 1353), Col 5 was "2018". But Col 5 is also Wattage?
        # Actually Wattage is Col 5 usually (Step 1293: `wattage = row_data[5]`).
        # If Col 5 is 2018, then Wattage is elsewhere?
        # Wait, for Corsair AX: Col 3: "850 / 1000W". Col 5: "2018". 
        # So Wattage is Col 3?
        # Let's STRICTLY use the manual inspection from Step 1353 for Corsair AX.
        # Col 3: Wattage/Model key
        # Col 5: Year
        
        # But `parse_html_table` logic says:
        # `wattage = row_data[5]` (Line 117).
        # And `series` uses cols 2,3,4.
        
        # This implies `parse_html_table` top logic is flawed for the rows I inspected.
        # However, `wattage` (Col 5) works for most?
        # If Corsair AX has 2018 at Col 5, then current script puts "2018" as Wattage?
        # If so, that's a bug.
        
        # Recalibrating based on Corsair AX Row 339:
        # Col 3: "850 / 1000W" -> This is the Wattage column.
        # Col 5: "2018" -> Year.
        
        # Adjusting the extraction completely.
        
        # Series was 2, 3, 4. 
        # In Corsair AX Row: 2="AX (Grey Label)", 3="850 / 1000W", 4="A+".
        # So Series is ONLY Col 2? Or 2+3+4?
        # If script joins 2,3,4: "AX (Grey Label) 850 / 1000W A+".
        # That's messy.
        
        # Let's fix Wattage index first. 
        # It seems Wattage is Col 3 (or range).
        # Let's assume Col 5 is Year.

        # Corrected Mapping (v1.9)
        # Based on Offset 4 (Dump Col + 4 = Row Index)
        year = safe_get(7)
        form_factor = safe_get(9)
        atx_version = safe_get(10)
        # Col 11 is Input Voltage (Full/230V)
        modular = safe_get(12)
        
        eff_code = safe_get(13)
        efficiency = eff_code
        if eff_code:
            eff_map = {
                'W': '80+ White/Standard',
                'B': '80+ Bronze',
                'S': '80+ Silver',
                'G': '80+ Gold',
                'P': '80+ Platinum',
                'T': '80+ Titanium',
                'N': 'Unrated/None'
            }
            if len(eff_code) == 1 and eff_code in eff_map:
                efficiency = eff_map[eff_code]

        topo_parts = [safe_get(14), safe_get(15), safe_get(16)]
        topology = " + ".join([t for t in topo_parts if t])
        
        odm = safe_get(17)
        platform = safe_get(18)
        notes = safe_get(19)

        item = {
            "brand": brand,
            "series": series,
            "wattage": wattage, # Confirmed Col 5
            "tier": tier,
            "year": year,
            "form_factor": form_factor,
            "atx_version": atx_version,
            "modular": modular,
            "efficiency": efficiency,
            "topology": topology,
            "odm": odm,
            "platform": platform,
            "notes": notes
        }
        
        # Remove legacy fix for Wattage vs Year mixup as indices are now confident
        # (The mixup was due to using Col 5 for Year when it was Wattage)


        extracted_data.append(item)

    return extracted_data

def main():
    data = parse_html_table("psu_tier.html")
    print(f"Extracted {len(data)} items.")
    with open("psu_data.json", "w", encoding='utf-8') as f:
        json.dump(data, f, indent=2)

if __name__ == "__main__":
    main()
