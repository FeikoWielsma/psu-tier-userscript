"""Offline source/parser/build tests, including release validation failures."""

import csv
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import build_extension
import fetch_sheet
import generate_userscript
import snapshot
from parse_tier_list import clean_series, parse_csv, validate_header
from verify_artifacts import validation_inputs, verify_artifacts, verify_attestation


def csv_text(rows):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerows(rows)
    return output.getvalue()


def header():
    return [
        "Brand",
        "Series",
        "",
        "",
        "Wattages",
        "Tier",
        "Year",
        "Size",
        "ATX",
        "Input",
        "Modularity",
        "Efficiency",
        "Prim.",
        "Secondary",
        "Reg.",
        "ODM",
        "Platform",
        "Notes",
    ]


def row(brand="Example", series="Alpha", v1="II", v2="Gold", tier="A"):
    return [brand, series, v1, v2, "850W", tier, "2024", "ATX", "3.1", "Full", "Full", "G"] + [
        ""
    ] * 6


class ParserTests(unittest.TestCase):
    def parse(self, rows, **kwargs):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.csv"
            path.write_bytes(csv_text([header(), *rows]).encode("utf-8"))
            return parse_csv(path, **kwargs)

    def test_merged_variants_and_resets(self):
        entries = self.parse(
            [
                row(),
                row("", "", "", ""),
                row("", "", "III", ""),
                row("", "Beta", "", ""),
                row("Other", "Gamma", "", ""),
            ]
        )
        self.assertEqual(
            [e["model"] for e in entries],
            ["Alpha II Gold", "Alpha II Gold", "Alpha III", "Beta", "Gamma"],
        )
        self.assertEqual(entries[-1]["brand"], "Other")

    def test_brand_change_does_not_inherit_old_series(self):
        with self.assertRaisesRegex(ValueError, "missing brand or series"):
            self.parse([row(), row("Other", "", "", "")])

    def test_dashes_clear_variants_without_filling_specs(self):
        missing = row("", "", "-", "-")
        missing[4] = missing[11] = ""
        entry = self.parse([row(), missing])[1]
        self.assertEqual(entry["model"], "Alpha")
        self.assertIsNone(entry["wattage"])
        self.assertIsNone(entry["efficiency"])

    def test_limited_ratings_and_source_rows(self):
        entries = self.parse([row(tier="A"), row(tier="B-*")], only_limited=True, source_gid="123")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["tier"], "B-")
        self.assertTrue(entries[0]["is_limited"])
        self.assertEqual(entries[0]["source"], {"gid": "123", "row": 3})

    def test_identifying_parentheses_survive(self):
        for name in ["Alpha (2024)", "Alpha (rev. 2.0)", "Alpha (Black Label)", "Alpha (ATX 3.1)"]:
            self.assertEqual(clean_series(name), name)
        self.assertEqual(clean_series("Alpha (AL)"), "Alpha")

    def test_header_position_and_truncated_ratings(self):
        bad = header()
        bad[4], bad[5] = bad[5], bad[4]
        with self.assertRaises(ValueError):
            validate_header(bad)
        with self.assertRaises(ValueError):
            self.parse([row()[:6]])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "empty.csv"
            path.write_text("", encoding="utf-8")
            with self.assertRaises(ValueError):
                parse_csv(path)


class FetchTests(unittest.TestCase):
    def test_html_and_wrong_headers_are_rejected(self):
        for content in [b"<!doctype html><html>Login</html>", b"something,else"]:
            response = unittest.mock.MagicMock()
            response.__enter__.return_value.read.return_value = content
            with (
                patch("urllib.request.urlopen", return_value=response),
                self.assertRaises(ValueError),
            ):
                fetch_sheet.fetch("https://example.invalid")

    def test_partial_refresh_leaves_reviewed_files_intact(self):
        before = snapshot.SNAPSHOT.read_bytes()
        metadata = snapshot.METADATA.read_bytes()
        with (
            patch(
                "fetch_sheet.fetch", side_effect=[csv_text([header(), row()]), OSError("offline")]
            ),
            self.assertRaises(OSError),
        ):
            snapshot.refresh()
        self.assertEqual(snapshot.SNAPSHOT.read_bytes(), before)
        self.assertEqual(snapshot.METADATA.read_bytes(), metadata)

    def test_snapshot_is_reproducible_from_frozen_sources(self):
        self.assertEqual(snapshot.verify_snapshot()["entries"], len(snapshot.load_data()))

    def test_write_failure_rolls_back_every_snapshot_file(self):
        sources = [
            (snapshot.METADATA.parent / f"{name}.csv").read_text(encoding="utf-8")
            for name in snapshot.SOURCES
        ]
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            dataset = stage / "data.json"
            metadata = stage / "metadata.json"
            dataset.write_bytes(snapshot.SNAPSHOT.read_bytes())
            metadata.write_bytes(snapshot.METADATA.read_bytes())
            expected = {dataset: dataset.read_bytes(), metadata: metadata.read_bytes()}
            original = snapshot.atomic_write
            calls = 0

            def fail_once(path, content):
                nonlocal calls
                calls += 1
                if calls == 3:
                    raise OSError("simulated disk failure")
                original(path, content)

            with (
                patch.object(snapshot, "SNAPSHOT", dataset),
                patch.object(snapshot, "METADATA", metadata),
                patch.object(snapshot, "load_data", return_value=snapshot.load_data()),
                patch.object(snapshot, "atomic_write", side_effect=fail_once),
                patch("fetch_sheet.fetch", side_effect=sources),
                self.assertRaisesRegex(OSError, "simulated disk failure"),
            ):
                snapshot.refresh()
            self.assertEqual(set(stage.iterdir()), set(expected))
            for path, content in expected.items():
                self.assertEqual(path.read_bytes(), content)

    def test_semantic_diff_reports_duplicates_conflicts_and_completeness(self):
        entry = snapshot.load_data()[0]
        changed = dict(entry, tier="F", year=None)
        report = snapshot.semantic_diff([], [entry, entry, dict(entry, tier="F"), changed])
        self.assertEqual(report["quality_after"]["duplicate_identities"][0]["count"], 2)
        self.assertEqual(len(report["quality_after"]["conflicting_tiers"]), 1)
        self.assertEqual(report["quality_after"]["missing_fields"]["year"], 1)


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.source = generate_userscript.build()
        (self.directory / "psutier.user.js").write_bytes(self.source.encode("utf-8"))
        build_extension.package(
            self.source, self.directory / "dist-extension", self.directory / "psutier-extension.zip"
        )

    def test_artifact_equality_and_deterministic_zip(self):
        report = verify_artifacts(self.directory)
        before = (self.directory / "psutier-extension.zip").read_bytes()
        build_extension.package(
            self.source, self.directory / "dist-extension", self.directory / "psutier-extension.zip"
        )
        self.assertEqual(before, (self.directory / "psutier-extension.zip").read_bytes())
        self.assertEqual(
            report["build"]["dataset_sha256"], snapshot.sha256(snapshot.SNAPSHOT.read_bytes())
        )

    def test_changed_data_fails_release_validation(self):
        path = self.directory / "changed.json"
        changed = snapshot.load_data()
        changed[0]["tier"] = "F"
        path.write_bytes(snapshot.json_bytes(changed))
        with self.assertRaisesRegex(ValueError, "differs"):
            verify_artifacts(self.directory, path)

    def test_changed_unpacked_script_fails_release_validation(self):
        (self.directory / "dist-extension/content.js").write_text("broken", encoding="utf-8")
        with self.assertRaises(ValueError):
            verify_artifacts(self.directory)

    def test_changed_zip_fails_release_validation(self):
        import zipfile

        with zipfile.ZipFile(self.directory / "psutier-extension.zip", "w") as archive:
            archive.writestr("content.js", self.source)
        with self.assertRaises(ValueError):
            verify_artifacts(self.directory)

    def test_signed_extension_accepts_signatures_but_rejects_changed_code(self):
        import zipfile

        signed = self.directory / "psutier-extension.xpi"
        extension = self.directory / "dist-extension"
        for tamper in (False, True):
            with zipfile.ZipFile(signed, "w") as archive:
                for file in extension.iterdir():
                    archive.writestr(
                        file.name,
                        b"changed" if tamper and file.name == "content.js" else file.read_bytes(),
                    )
                archive.writestr("META-INF/mozilla.rsa", b"signature placeholder")
            if tamper:
                with self.assertRaisesRegex(ValueError, "Signed extension differs"):
                    verify_artifacts(self.directory)
            else:
                verify_artifacts(self.directory)

    def test_manifest_drift_fails_release_validation(self):
        path = self.directory / "dist-extension/manifest.json"
        manifest = json.loads(path.read_text(encoding="utf-8"))
        manifest["version"] = "0.0.0"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaises(ValueError):
            verify_artifacts(self.directory)

    def test_js_context_escaping(self):
        escaped = generate_userscript.js_safe("<>&\u2028\u2029")
        self.assertNotIn("<", escaped)
        self.assertIn("\\u2028", escaped)

    def test_rebuilt_artifacts_still_need_a_matching_test_attestation(self):
        actual = verify_artifacts(self.directory)
        report = dict(actual, releaseValidated=True, validationInputs=validation_inputs())
        verify_attestation(report, actual)
        changed = dict(actual, artifacts={**actual["artifacts"], "psutier.user.js": "new bytes"})
        with self.assertRaisesRegex(ValueError, "changed after"):
            verify_attestation(report, changed)
        report["releaseValidated"] = False
        with self.assertRaisesRegex(ValueError, "has not passed"):
            verify_attestation(report, actual)

    def test_changed_test_inputs_invalidate_attestation(self):
        actual = verify_artifacts(self.directory)
        report = dict(actual, releaseValidated=True, validationInputs={})
        with self.assertRaisesRegex(ValueError, "Validation inputs changed"):
            verify_attestation(report, actual)

    def test_packaging_does_not_remove_unknown_user_files(self):
        unknown = self.directory / "dist-extension/do-not-delete.txt"
        unknown.write_text("keep", encoding="utf-8")
        with self.assertRaises(ValueError):
            build_extension.package(
                self.source, self.directory / "dist-extension", self.directory / "other.zip"
            )
        self.assertEqual(unknown.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
