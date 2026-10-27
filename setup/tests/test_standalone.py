import sys,unittest
from pathlib import Path
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fpmigrate import sports
class StandaloneTests(unittest.TestCase):
 def test_existing_authenticated_backend_is_not_installed_twice(self):
  jf=Mock();jf.call.return_value={'edition':'customer','version':'sports-ce-fixture','sports':True}
  with patch.object(sports,'plugin_entry',return_value=None),patch.object(sports,'available',return_value=True):
   result=sports.status(jf)
  self.assertTrue(result['installed']);self.assertEqual(result['deployment'],'standalone')
  self.assertTrue(result['service']['ready']);jf.call.assert_called_once_with('GET','/sports/api/status',timeout=8,retries=0)
 def test_unrelated_service_not_accepted(self):
  for data in ({},{'edition':'customer','version':'other'},{'edition':'other','version':'sports-ce-fixture'}):
   jf=Mock();jf.call.return_value=data
   with patch.object(sports,'plugin_entry',return_value=None),patch.object(sports,'available',return_value=True):self.assertFalse(sports.status(jf)['installed'])
 def test_unreachable_backend_keeps_install_available(self):
  jf=Mock();jf.call.side_effect=OSError('offline')
  with patch.object(sports,'plugin_entry',return_value=None),patch.object(sports,'available',return_value=True):
   self.assertFalse(sports.status(jf)['installed'])
 def test_remote_existing_service_is_configured_without_plugin_install(self):
  from fpmigrate.engine import Engine
  e=Engine.__new__(Engine);e.jf=Mock();e.jf.base_url='http://jellyfin.example:8096';e.jf_info={'Version':'12.2.0'}
  current={'installed':True,'deployment':'standalone','service':{'ready':True}}
  with patch.object(sports,'available',return_value=True),patch.object(sports,'status',return_value=current),patch.object(sports,'install') as install:
   self.assertTrue(e.sports_status()['available']);result=e.install_sports()
  self.assertFalse(result['changed']);install.assert_not_called();e.jf.call.assert_not_called()
 def test_untested_minor_version_is_not_accepted_by_prefix(self):
  from fpmigrate.engine import Engine
  e=Engine.__new__(Engine);e.jf=Mock();e.jf_info={'Version':'12.20.0'}
  with patch.object(sports,'available',return_value=True):self.assertFalse(e.sports_status()['available'])
if __name__=='__main__':unittest.main()
