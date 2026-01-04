import subprocess
import sys
import os

def run_command(command, cwd=None):
    print(f"Running: {command}")
    try:
        # Use subprocess.call to get exit code cleanly
        ret = subprocess.call(command, shell=True, cwd=cwd)
        if ret != 0:
            print(f"Command failed with return code: {ret}")
            return False
        print("Success.\n")
        return True
    except Exception as e:
        print(f"Error running command: {e}")
        return False

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    print("=== PSU Tier List CI Test Suite ===\n")

    # 1. Parse Data
    print("[1/3] Parsing Tier List...")
    if not run_command("python parse_tier_list.py", cwd=base_dir):
        return sys.exit(1)

    # 2. Generate Userscript (and test map)
    print("[2/3] Generating Userscript & Test Data...")
    if not run_command("python -W ignore generate_userscript.py", cwd=base_dir):
        return sys.exit(1)

    # 3. Run Node.js Tests
    print("[3/3] Running Node.js matching tests...")
    if not run_command("node tests/test_matching.js", cwd=base_dir):
        return sys.exit(1)

    # 4. Run E2E Tests (Playwright)
    # WARNING: Disabled by default to prevent IP bans from PCPartPicker.
    # To run manually: python -m pytest tests/test_e2e.py
    print("\n[4/4] E2E Browser Tests skipped (risk of IP Ban). Run manually if needed.")
    # if not run_command("pytest tests/test_e2e.py", cwd=base_dir):
    #     print("!! E2E tests failed. Ensure you have installed browsers: 'playwright install'")
    #     return sys.exit(1)

    print("=== All Tests Passed! ===")
    sys.exit(0)

if __name__ == "__main__":
    main()
