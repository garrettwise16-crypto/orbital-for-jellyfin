import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from fpmigrate.webui import serve
from tests.fakes import FakeJellyfin, FakePlex
from tests.test_flows import standard_world, movie_lib


class WebUi(unittest.TestCase):
    """Second server instance for the express path is created in ExpressPath below."""
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        items, fs = standard_world()
        cls.plex = FakePlex([movie_lib(items)])
        cls.jf = FakeJellyfin(fs, wizard_done=False)
        cls.holder, ready = {}, threading.Event()
        cls.thread = threading.Thread(target=serve, args=(Path(cls.tmp.name),), kwargs=dict(
            open_browser=False, ready=ready, holder=cls.holder), daemon=True)
        cls.thread.start()
        ready.wait(10)
        cls.app = cls.holder["app"]
        cls.base = f"http://127.0.0.1:{cls.app.port}"

    @classmethod
    def tearDownClass(cls):
        cls.app.stop.set()
        cls.thread.join(5)
        cls.app.engine.journal.close()
        cls.plex.close()
        cls.jf.close()
        cls.tmp.cleanup()

    def call(self, method, path, body=None, key=None, headers=None):
        h = {"X-FP-Key": self.app.key if key is None else key, "Content-Type": "application/json"}
        h.update(headers or {})
        data = json.dumps(body).encode() if body is not None else (b"{}" if method == "POST" else None)
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def wait_job(self):
        for _ in range(200):
            s = self.call("GET", "/api/status")[1]
            if not s["job"]["running"]:
                return s["job"]
            time.sleep(0.2)
        self.fail("job did not finish")

    def test_security_boundary(self):
        self.assertEqual(self.call("GET", "/api/status", key="wrong")[0], 403)
        self.assertEqual(self.call("GET", "/api/status", key="")[0], 403)
        self.assertEqual(self.call("GET", "/api/status", headers={"Host": "evil.example:80"})[0], 403)
        self.assertEqual(self.call("POST", "/api/quit", headers={"Origin": "http://evil.example"})[0], 403)
        self.assertEqual(self.call("POST", "/api/detect", body={"x": "y" * 70000})[0], 413)
        self.assertEqual(self.call("GET", "/api/nope")[0], 404)
        req = urllib.request.Request(self.base + "/")
        with urllib.request.urlopen(req) as r:
            self.assertIn("default-src 'self'", r.headers["Content-Security-Policy"])
            self.assertEqual(r.headers["X-Frame-Options"], "DENY")
        self.assertFalse(self.app.stop.is_set())

    def test_journey_via_api(self):
        st, det = self.call("POST", "/api/detect", {"plexUrl": self.plex.url, "jellyfinUrl": self.jf.url})
        self.assertEqual(st, 200)
        self.assertTrue(self.call("POST", "/api/plex/connect", {"url": self.plex.url})[1]["ok"])
        st, r = self.call("POST", "/api/jellyfin/connect", {"url": self.jf.url, "username": "me", "password": "pw",
                                                            "createAdmin": False})
        self.assertEqual(st, 409)  # never runs first-time setup unless asked
        self.assertIn("not been set up", r["error"])
        st, r = self.call("POST", "/api/jellyfin/connect", {"url": self.jf.url, "username": "me", "password": "pw",
                                                            "createAdmin": True})
        self.assertEqual(st, 200)
        rows = self.call("GET", "/api/libraries")[1]["rows"]
        self.call("POST", "/api/libraries/apply", {"include": [r["sectionKey"] for r in rows]})
        self.assertIsNone(self.wait_job()["error"])
        users = self.call("GET", "/api/users")[1]
        self.call("POST", "/api/users/apply", {"choices": {"owner": {"mode": "existing",
                                                                     "jfUserId": users["jellyfinUsers"][0]["id"]}}})
        self.call("POST", "/api/preview", {"ratings": True})
        job = self.wait_job()
        self.assertEqual(job["result"]["summary"]["users"][0]["counts"]["toWrite"], 3)
        self.call("POST", "/api/apply", {})
        job = self.wait_job()
        self.assertEqual((job["result"]["status"], job["result"]["verified"]), ("completed", 3))
        rep = self.call("GET", "/api/report")[1]
        self.assertIn("Missing (2005)", rep["csv"])
        self.assertNotIn("pw", json.dumps(self.call("GET", "/api/status")[1]))
        self.assertEqual(self.plex.violations, [])



class ExpressPath(WebUi):
    def test_journey_via_api(self):  # replaces the step-by-step journey with the one-button setup
        self.call("POST", "/api/detect", {"plexUrl": self.plex.url, "jellyfinUrl": self.jf.url})
        self.assertTrue(self.call("POST", "/api/plex/connect", {"url": self.plex.url})[1]["ok"])
        st, _ = self.call("POST", "/api/jellyfin/connect", {"url": self.jf.url, "username": "me", "password": "pw12345678",
                                                            "createAdmin": True})
        self.assertEqual(st, 200)
        self.assertTrue(self.call("GET", "/api/status")[1]["suggestedName"] is not None)
        self.call("GET", "/api/libraries")
        self.call("POST", "/api/setup", {"favorites": True})  # all defaults
        job = self.wait_job()
        self.assertIsNone(job["error"])
        self.assertEqual(job["result"]["summary"]["users"][0]["counts"]["toWrite"], 3)
        self.assertEqual(job["result"]["newAccounts"], [])
        self.call("POST", "/api/apply", {})
        self.assertEqual(self.wait_job()["result"]["verified"], 3)
        self.assertEqual(self.plex.violations, [])

    def test_security_boundary(self):
        pass  # covered by WebUi


if __name__ == "__main__":
    unittest.main()
