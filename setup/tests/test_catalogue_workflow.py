import sys, unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'sports_service/app'))
from fpmigrate import catalogues
import catalogue_discovery

class Fixture:
 def __init__(self, fail=False): self.calls=[];self.fail=fail
 def call(self, method, path, **kwargs):
  self.calls.append((method,path,kwargs))
  if method=='POST': return {'provider':kwargs['body']['provider'],'entries':len(kwargs['body']['entries'])}
  q=parse_qs(urlsplit(path).query)
  if self.fail and q['kind']==['tv']:raise ValueError('Disconnected')
  n=int(q['page'][0])
  return {'totalPages':2,'results':[{'id':n,'title':'Fixture '+str(n),'genreIds':[], 'releaseDate':'2020-01-01','adult':False}]}

class CatalogueWorkflowTests(unittest.TestCase):
 def test_all_pages_validated_before_save(self):
  jf=Fixture();progress=[]
  with patch.object(catalogues.time,'sleep'):
   result=catalogues.connect(jf,'netflix',progress.append,lambda:None)
  self.assertEqual(result['catalogues'][0]['entries'],4)
  self.assertEqual([x[0] for x in jf.calls],['GET']*4+['POST'])
  self.assertTrue(any('page 2 of 2' in p for p in progress))
  self.assertEqual(jf.calls[-1][2]['body']['region'],'US')
 def test_manual_refresh_choice_is_saved(self):
  jf=Fixture()
  with patch.object(catalogues.time,'sleep'):
   catalogues.connect(jf,'netflix',lambda p:None,lambda:None,False)
  self.assertIs(jf.calls[-1][2]['body']['automatic_refresh'],False)
 def test_invalid_refresh_choice_does_not_fetch(self):
  jf=Fixture()
  with self.assertRaises(ValueError):catalogues.connect(jf,'netflix',lambda p:None,lambda:None,'yes')
  self.assertFalse(jf.calls)
 def test_failure_never_replaces_partial_catalogue(self):
  jf=Fixture(True)
  with patch.object(catalogues.time,'sleep'),self.assertRaises(ValueError):
   catalogues.connect(jf,'netflix',lambda p:None,lambda:None)
  self.assertFalse(any(m=='POST' for m,_,_ in jf.calls))
 def test_cancellation_prevents_save(self):
  jf=Fixture()
  def cancel():raise InterruptedError()
  with self.assertRaises(InterruptedError):catalogues.connect(jf,'netflix',lambda p:None,cancel)
  self.assertFalse(jf.calls)
 def test_server_uses_saved_key_and_fixed_read_route(self):
  seen=[]
  def fetch(url,key): seen.append((url,key));return {'totalPages':1,'results':[]}
  with patch.object(catalogue_discovery.integrations,'load',return_value={'requests':{'enabled':True,'url':'http://seerr.example.test','key':'fixture'}}),patch.object(catalogue_discovery,'FixedJsonGet',return_value=fetch):
   self.assertEqual(catalogue_discovery.page('netflix','movies',1),{'totalPages':1,'results':[]})
  self.assertTrue(seen[0][0].startswith('http://seerr.example.test/api/v1/discover/movies?'))
  self.assertNotIn('fixture',seen[0][0]);self.assertEqual(seen[0][1],'fixture')
  with self.assertRaises(ValueError):catalogue_discovery.page('../private','movies',1)
 def test_rejects_incomplete_upstream_page_limit(self):
  with patch.object(catalogue_discovery.integrations,'load',return_value={'requests':{'enabled':True,'url':'http://seerr.example.test','key':'fixture'}}),patch.object(catalogue_discovery,'FixedJsonGet',return_value=lambda *a:{'totalPages':501,'results':[]}):
   with self.assertRaises(ValueError):catalogue_discovery.page('netflix','movies',1)

if __name__=='__main__':unittest.main()
