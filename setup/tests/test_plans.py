"""Free and Plus (Oct 22 2026): free is always complete; Plus modules need a valid, current, matching code AND a released
module; nothing a code does (expiry, tampering, clock rollback, wrong server) can affect free features."""
import secrets
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "sports_service"))
import entitlements as E  # noqa: E402

SECRET = secrets.token_bytes(32)
KEYS = {"ktest": E._b64(E.public_key(SECRET))}
NOW = 1_800_000_000.0


def code(**over):
    payload = {"v": 1, "id": "c1", "kind": "founding", "modules": ["picture-lock", "feed-trust", "picture-plays"],
               "not_before": NOW - 10, "expires": NOW + 30 * 86400, **over}
    return E.issue(SECRET, "ktest", payload)


class PlanTests(unittest.TestCase):
    def plan(self, c, released=False, **kw):
        with mock.patch.dict(E.MODULES["picture-lock"], released=released), mock.patch.dict(E.MODULES["feed-trust"], released=released):
            return E.plan(c, keys=KEYS, **{"now": NOW, **kw})

    def test_free_is_complete_without_any_code(self):
        p = self.plan(None)
        self.assertTrue(p["free"])
        self.assertEqual(p["tier"], "free")
        self.assertIsNone(p["code"])
        self.assertTrue(all(not m["on"] and m["free"] for m in p["plus"].values()))

    def test_unreleased_modules_never_switch_on_even_with_a_valid_code(self):
        p = self.plan(code())
        self.assertTrue(p["code"]["valid"])
        self.assertEqual(p["tier"], "free")
        self.assertTrue(all(m["granted"] and not m["on"] for m in p["plus"].values()))

    def test_valid_code_turns_on_released_modules(self):
        p = self.plan(code(modules=["picture-lock"]), released=True)
        self.assertEqual(p["tier"], "plus")
        self.assertTrue(p["plus"]["picture-lock"]["on"])
        self.assertFalse(p["plus"]["feed-trust"]["on"])

    def test_expiry_boundary_and_not_yet_active(self):
        c = code()
        self.assertTrue(self.plan(c, released=True, now=NOW + 30 * 86400 - 1)["plus"]["picture-lock"]["on"])
        ended = self.plan(c, released=True, now=NOW + 30 * 86400)
        self.assertFalse(ended["plus"]["picture-lock"]["on"])
        self.assertIn("Everything free keeps working", ended["code"]["reason"])
        self.assertTrue(ended["free"])
        early = self.plan(code(not_before=NOW + 100), released=True)
        self.assertFalse(early["plus"]["picture-lock"]["on"])

    def test_tampered_or_foreign_codes_are_refused_without_errors(self):
        c = code()
        head, kid, body, sig = c.split(".")
        forged = E._b64(E._unb64(body).replace(b'"founding"', b'"paid"'))
        for bad in (".".join([head, kid, forged, sig]), "FP1.kother." + body + "." + sig, "hello", "FP1." + "x" * 5000, "FP1.a.b.c"):
            p = self.plan(bad, released=True)
            self.assertFalse(p["plus"]["picture-lock"]["on"], bad[:40])
            self.assertFalse(p["code"]["valid"])
        other_key = E.issue(secrets.token_bytes(32), "ktest", {"v": 1, "modules": ["picture-lock"], "expires": NOW + 999})
        self.assertFalse(self.plan(other_key, released=True)["plus"]["picture-lock"]["on"])

    def test_code_bound_to_a_server(self):
        c = code(server="server-a")
        self.assertTrue(self.plan(c, released=True, server_id="server-a")["plus"]["picture-lock"]["on"])
        self.assertFalse(self.plan(c, released=True, server_id="server-b")["plus"]["picture-lock"]["on"])

    def test_rolling_the_clock_back_cannot_stretch_a_code(self):
        with tempfile.TemporaryDirectory() as d:
            c = code()
            later = NOW + 31 * 86400
            self.assertFalse(self.plan(c, released=True, data_dir=d, now=later)["plus"]["picture-lock"]["on"])
            rolled_back = self.plan(c, released=True, data_dir=d, now=NOW)  # PC clock set back a month
            self.assertFalse(rolled_back["plus"]["picture-lock"]["on"])

    def test_no_issuer_key_ships_until_the_owner_creates_one(self):
        self.assertEqual(E.ISSUER_KEYS, {}) if not (Path(E.__file__).parent / "issuer-public.json").exists() else None
        self.assertFalse(E.plan(code(), now=NOW)["code"]["valid"])


if __name__ == "__main__":
    unittest.main()
