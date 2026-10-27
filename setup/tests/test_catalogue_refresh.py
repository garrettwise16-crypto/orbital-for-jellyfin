import json, os, sys, tempfile, threading, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'sports_service/app'))
import catalogue_refresh as refresh
import catalogue_sources as sources

class CatalogueRefreshTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        env = patch.dict(os.environ, SPORTS_DATA_DIR=temp.name); env.start(); self.addCleanup(env.stop)
        self.data = {'provider':'netflix', 'automatic_refresh':True, 'updated_at':'2026-01-01T00:00:00+00:00',
                     'entries':[{'type':'Movie','tmdb':1,'title':'Saved'}]}
        sources.save(self.data)
        self.path = sources.root() / 'netflix.json'
        self.before = self.path.read_bytes()
        self.stop = threading.Event()
        refresh._state.clear()

    def page(self, provider, kind, number):
        return {'totalPages':1, 'results':[{'id':2,'title':'Updated'}]}

    def test_full_refresh_and_daily_noop(self):
        with patch.object(refresh.catalogue_discovery, 'page', side_effect=self.page) as call:
            self.assertTrue(refresh.refresh('netflix',self.before,self.stop))
            saved = json.loads(self.path.read_bytes())
            self.assertEqual(len(saved['entries']),2)
            self.assertTrue(saved['automatic_refresh'])
            self.assertFalse(refresh.refresh('netflix',self.path.read_bytes(),self.stop))
            self.assertEqual(call.call_count,2)

    def test_partial_failure_preserves_snapshot(self):
        def fail(provider, kind, number):
            if kind == 'tv': raise OSError('private URL or credential')
            return self.page(provider,kind,number)
        with patch.object(refresh.catalogue_discovery,'page',side_effect=fail):
            refresh.cycle(self.stop)
        self.assertEqual(self.path.read_bytes(),self.before)
        self.assertEqual(refresh.status()['netflix']['state'],'retrying')
        self.assertNotIn('credential',str(refresh.status()))

    def test_new_admin_import_wins_over_background_refresh(self):
        def changed(provider,kind,number):
            if kind == 'tv':
                sources.save({**self.data,'automatic_refresh':False,'entries':[{'type':'Movie','tmdb':3,'title':'New admin import'}]})
            return self.page(provider,kind,number)
        with patch.object(refresh.catalogue_discovery,'page',side_effect=changed), self.assertRaises(ValueError):
            refresh.refresh('netflix',self.before,self.stop)
        self.assertEqual(json.loads(self.path.read_bytes())['entries'][0]['title'],'New admin import')

    def test_manual_import_and_cancellation_do_not_fetch(self):
        sources.save({**self.data,'automatic_refresh':False})
        with patch.object(refresh.catalogue_discovery,'page') as call:
            self.assertFalse(refresh.refresh('netflix',self.path.read_bytes(),self.stop))
            self.stop.set()
            with self.assertRaises(InterruptedError):refresh.refresh('netflix',self.before,self.stop)
            call.assert_not_called()

if __name__ == '__main__': unittest.main()
