import unittest,json,tempfile
from pathlib import Path
from types import SimpleNamespace as N
from unittest.mock import Mock,patch
from fpmigrate import onboarding as o
from fpmigrate.webui import App
class OnboardingTests(unittest.TestCase):
 def test_compose_media_read_only_and_explicit_version(self):
  r=o.deployment({'mode':'docker','media':'/media/movies','version':'12.2','port':'18096','uid':'1001','gid':'1002'})
  c=json.loads(r['files'][0]['content'])['services']['jellyfin']
  self.assertEqual(c['image'],'jellyfin/jellyfin:12.2');self.assertEqual(c['ports'],['18096:8096']);self.assertEqual(c['user'],'1001:1002')
  self.assertTrue(c['volumes'][-1]['read_only']);self.assertFalse(c['volumes'][-1]['bind']['create_host_path'])
  self.assertIn('ps -aq',r['files'][1]['content'])
 def test_reject_unsafe_or_incomplete_options(self):
  base={'mode':'docker','media':'/media/media','version':'12.2'}
  for k,v in [('media','/'),('media','relative'),('media','/media/../etc'),('media','/media/$HOME'),('version','latest'),('version','12;whoami'),('uid','1;id'),('port','80')]:
   with self.subTest(k=k,v=v),self.assertRaises(ValueError):o.deployment(dict(base,**{k:v}))
 def test_linux_verifies_before_exec_and_asks(self):
  r=o.deployment({'mode':'linux'});s=r['files'][0]['content']
  self.assertLess(s.index('sha256sum -c'),s.index('sudo bash'));self.assertIn('INSTALL',s);self.assertIn('Debian',r['message'])
 def test_findings_allowlist_excludes_machine_and_account_data(self):
  e=N(plex_account_token='SECRET123',plex=N(token='PLEXSECRET'),jf=N(token='JFSECRET'),plex_identity={'version':'1','hostname':'PRIVATEHOST'},jf_info={'Version':'12.2','ServerName':'PRIVATEHOST'})
  app=N(engine=e,last_run=None,job=Mock());app.job.view.return_value={'name':'setup','running':False,'error':'PRIVATEHOST SECRET123','result':{'password':'SECRET123'}}
  report=o.findings(app,{'description':'token=SECRET123 https://example.org/private /media/private/movie','checks':{'movie':'passed'}})
  text=json.dumps(report)
  for x in ('SECRET123','PLEXSECRET','JFSECRET','PRIVATEHOST','example.org','/media/private'):self.assertNotIn(x,text)
  self.assertEqual(report['playbackChecks']['movie'],'passed');self.assertEqual(report['playbackChecks']['remote'],'not_tested');self.assertTrue(report['job']['errorPresent'])
 def test_remote_choice_never_probes_default_local_server(self):
  with tempfile.TemporaryDirectory() as tmp:
   app=App(Path(tmp))
   try:
    with patch.object(app.engine,'detect',return_value={}) as detect:
     app.detect({}, {'deployment':'docker'})
     self.assertFalse(detect.call_args.kwargs['include_defaults'])
    with self.assertRaises(ValueError):app.server_install({}, {'agreed':True})
   finally:app.engine.journal.close()
 def test_checks_reject_fabricated_success_value(self):
  e=N(plex_account_token=None,plex=None,jf=None,plex_identity={},jf_info={})
  app=N(engine=e,last_run=None,job=Mock());app.job.view.return_value={'name':None,'running':False,'error':None,'result':None}
  with self.assertRaises(ValueError):o.findings(app,{'checks':{'movie':'probably'}})
if __name__=='__main__':unittest.main()
