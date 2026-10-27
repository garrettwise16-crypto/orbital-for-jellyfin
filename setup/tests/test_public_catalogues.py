import json,os,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'sports_service/app'))
import catalogue_sources as sources
import provider_catalogue as catalog
class CatalogueTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  env=patch.dict(os.environ,SPORTS_DATA_DIR=self.temp.name);env.start();self.addCleanup(env.stop)
  root=patch.object(catalog,'ROOT',Path(self.temp.name)/'catalogues');root.start();self.addCleanup(root.stop)
  catalog._files.clear()
  self.data={'provider':'netflix','updated_at':'2026-01-01T00:00:00+00:00','entries':[{'tmdb':1,'type':'Movie','title':'Fixture','genres':[18],'year':2020,'rating':8,'votes':100,'poster':'/fixture.jpg'}]}
 def test_valid_import_and_status(self):
  self.assertEqual(sources.save(self.data)['entries'],1)
  self.assertEqual(sources.status()['catalogues'][0]['provider'],'netflix')
 def test_other_region_is_not_mislabeled(self):
  self.data['region']='GB'
  with self.assertRaises(ValueError):sources.save(self.data)
  self.assertEqual(sources.status()['catalogues'],[])
 def test_bad_import_does_not_replace_saved_catalogue(self):
  sources.save(self.data);p=sources.root()/'netflix.json';before=p.read_bytes()
  self.data['entries'][0]['poster']='https://untrusted.example/image'
  with self.assertRaises(ValueError):sources.save(self.data)
  self.assertEqual(before,p.read_bytes())
 def test_duplicate_and_unknown_provider_refused(self):
  self.data['entries']*=2
  with self.assertRaises(ValueError):sources.save(self.data)
  self.data['provider']='../outside'
  with self.assertRaises(ValueError):sources.save(self.data)
 def test_future_or_undated_snapshot_refused(self):
  self.data['updated_at']='2999-01-01T00:00:00Z'
  with self.assertRaises(ValueError):sources.save(self.data)
  self.data['updated_at']='2026-01-01'
  with self.assertRaises(ValueError):sources.save(self.data)
 def test_actual_join_uses_only_current_viewer_inventory(self):
  sources.save(self.data)
  item={'Id':'a'*32,'Type':'Movie','Name':'Fixture','ProviderIds':{'Tmdb':'1'},'source':'local'}
  with patch.object(catalog,'inventory',side_effect=lambda user,*args:[item] if user['Id']=='allowed' else []):
   first=catalog.catalogue({'provider':['netflix']},{'Id':'allowed'},'t',None,'http://example.test')
   second=catalog.catalogue({'provider':['netflix']},{'Id':'other'},'t',None,'http://example.test')
  self.assertTrue(first['entries'][0]['in_library'])
  self.assertFalse(second['entries'][0]['in_library']);self.assertIsNone(second['entries'][0]['item'])
  self.assertTrue(second['stale'])
if __name__=='__main__':unittest.main()
