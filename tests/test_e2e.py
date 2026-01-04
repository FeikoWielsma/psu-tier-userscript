import pytest
from playwright.sync_api import sync_playwright
import os

def test_pcpp_badges():
    # Load userscript content
    # Assuming the test is run from root or tests dir, we locate file relative to this script
    base_dir = os.path.dirname(os.path.abspath(__file__))
    userscript_path = os.path.join(base_dir, '../psutier.user.js')
    
    if not os.path.exists(userscript_path):
        pytest.fail("psutier.user.js not found. Run generate_userscript.py first.")

    with open(userscript_path, 'r', encoding='utf-8') as f:
        js_content = f.read()

    print("Content length:", len(js_content))

    with sync_playwright() as p:
        # Launch browser (headless for CI)
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        print("Navigating to PCPartPicker...")
        # Go to power supply page
        page.goto("https://pcpartpicker.com/products/power-supply/", timeout=60000)
        
        print("Injecting userscript...")
        # Inject script now that DOM is ready
        page.evaluate(js_content)
        
        # Wait for badges to appear
        print("Waiting for .tier-badge selector...")
        try:
            page.wait_for_selector(".tier-badge", timeout=15000)
        except Exception as e:
            # Capture failure state
            page.screenshot(path="e2e_failure.png")
            print("Screenshot saved to e2e_failure.png")
            pytest.fail(f"Badges did not appear within timeout: {e}")

        # Count badges
        count = page.locator(".tier-badge").count()
        print(f"Badges found: {count}")
        assert count > 0, "No badges found on the page!"
        
        # Optional: Verify text of first badge
        first_text = page.locator(".tier-badge").first.inner_text()
        print(f"First badge text: {first_text}")
        assert "Tier" in first_text

        browser.close()

if __name__ == "__main__":
    test_pcpp_badges()
