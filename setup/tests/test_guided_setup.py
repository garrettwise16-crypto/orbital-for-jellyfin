import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from fpmigrate.webui import App
from fpmigrate import serverinstall

class GuidedSetup(unittest.TestCase):
    def test_source_failure_remedies_and_badge_evidence(self):
        from fpmigrate import sports
        jf = Mock()
        for reason, expected in [('credentials', 'refused access'), ('rate-limit', 'Wait a minute'),
                                 ('address', 'not found'), ('network', 'internet connection')]:
            jf.call.return_value = {'sources':[{'type':'thesportsdb','ok':False,'reason':reason}]}
            result = sports.check_sources(jf)
            self.assertFalse(result['ready'])
            self.assertIn(expected, result['sources'][0]['message'])
        jf.call.return_value = {'sources':[{'type':'feed','ok':True,'games':2,'teamEntries':4,'badgeLinks':3}]}
        self.assertIn('3 of 4', sports.check_sources(jf)['sources'][0]['message'])
    def test_artwork_preview_uses_bounded_real_secure_source_images(self):
        from fpmigrate import sports
        jf=Mock()
        teams=[{'name':'Team '+str(i),'logo':'https://images.example.test/'+str(i)+'.png'} for i in range(9)]
        teams += [{'name':'Unsafe','logo':url} for url in ['http://images.example.test/a.png','https://user:pass@images.example.test/a.png','javascript:alert(1)','https://images.example.test/a.png#secret']]
        jf.call.return_value={'sources':[{'type':'feed','ok':True}], 'events':[{'teams':teams}]}
        result=sports.check_sources(jf)
        self.assertEqual(len(result['artwork']),6)
        self.assertEqual(result['teamEntries'],13)
        self.assertTrue(all(x['name'].startswith('Team ') for x in result['artwork']))
        jf.call.return_value={'sources':[], 'events':[]}
        self.assertEqual(sports.check_sources(jf)['artwork'],[])

    def test_scoreboard_keeps_provider_artwork(self):
        import espn_core
        raw={'id':'1','date':'2026-10-27T00:00:00Z','competitions':[{'competitors':[{'team':{'displayName':'Example','logo':'https://images.example.test/team.png'}}]}]}
        self.assertEqual(espn_core.normalize(raw,'NBA')['teams'][0]['logo'],'https://images.example.test/team.png')
        raw['competitions'][0]['competitors'][0]['team']['logo']='javascript:alert(1)'
        self.assertNotIn('logo',espn_core.normalize(raw,'NBA')['teams'][0])

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = App(Path(self.tmp.name))
        self.original = self.app.engine
        self.app.engine = Mock()
        self.app.engine.jf = Mock()
        self.app.engine.jf_info = {'Id':'fixture-server'}
        self.app.engine.jf.base_url = 'http://127.0.0.1:18097'
        self.app.engine.orbital_status.return_value = dict(installed=True, filesPresent=True, needsReapply=False)
        self.app.engine.sports_status.return_value = dict(installed=True, service=dict(ready=True))
    def tearDown(self):
        self.original.journal.close()
        self.tmp.cleanup()
    def result(self):
        for _ in range(100):
            state = self.app.job.view()
            if not state['running']:
                self.assertFalse(state['error'])
                return state['result']
            time.sleep(.01)
        self.fail('job did not finish')
    def test_sports_alone_without_plex_or_web(self):
        self.app.features_install({},dict(features=['sports'],allowRestart=True))
        self.assertTrue(self.result()['features']['sports']['ready'])
        self.app.engine.install_orbital.assert_not_called()
    def test_failure_isolated_and_retry_verifies(self):
        self.app.engine.install_orbital.side_effect = RuntimeError('Access denied')
        self.app.features_install({},dict(features=['orbital','sports'],allowRestart=True))
        r=self.result()['features']
        self.assertFalse(r['orbital']['ready']);self.assertTrue(r['sports']['ready'])
        self.app.engine.install_orbital.side_effect=None
        self.app.features_install({},dict(features=['orbital']))
        self.assertTrue(self.result()['features']['orbital']['ready'])
    def test_unready_service_is_not_success(self):
        self.app.engine.sports_status.return_value=dict(installed=True,service=dict(ready=False))
        self.app.features_install({},dict(features=['sports'],allowRestart=True))
        self.assertFalse(self.result()['features']['sports']['ready'])
    def test_restart_and_selection_checks(self):
        for body in ({'features':['sports']},{'features':[]},{'features':['unknown']}):
            with self.assertRaises(ValueError):self.app.features_install({},body)
        self.app.engine.install_sports.assert_not_called()
    def test_duplicate_library_is_not_created(self):
        jf=self.app.engine.jf
        jf.virtual_folders.return_value=[dict(Name='Movies',Locations=['D:/Movies'],CollectionType='movies')]
        self.app.library_create({},dict(name='Movies',path='D:/Movies',kind='movies'))
        jf.add_library.assert_not_called()
        with self.assertRaises(ValueError):self.app.library_create({},dict(name='Movies',path='E:/Different',kind='movies'))
    def test_unreadable_folder_no_mutation(self):
        jf=self.app.engine.jf;jf.virtual_folders.return_value=[];jf.validate_path.return_value=False
        with self.assertRaises(ValueError):self.app.library_create({},dict(name='Movies',path='X:/missing',kind='movies'))
        jf.add_library.assert_not_called()
    def test_create_readback_and_ownership(self):
        jf=self.app.engine.jf;jf.virtual_folders.side_effect=[[],[dict(Name='Movies',Locations=['D:/Movies'],ItemId='new')]]
        self.app.library_create({},dict(name='Movies',path='D:/Movies',kind='movies'))
        self.app.engine.journal.add_owned.assert_called_once_with('setup','library','new','Movies')
    def test_failed_readback_not_owned_or_claimed(self):
        jf=self.app.engine.jf;jf.virtual_folders.return_value=[]
        with self.assertRaises(RuntimeError):self.app.library_create({},dict(name='Movies',path='D:/Movies',kind='movies'))
        self.app.engine.journal.add_owned.assert_not_called()
    def test_server_install_requires_agreement(self):
        with self.assertRaises(ValueError):self.app.server_install({}, {})
    @patch.object(serverinstall.sys,'platform','win32')
    @patch.object(serverinstall.shutil,'which',return_value='winget.exe')
    @patch.object(serverinstall.subprocess,'run')
    @patch.object(serverinstall,'Jellyfin')
    def test_install_waits_for_real_server(self,jf,run,which):
        run.return_value.returncode=0;jf.return_value.wait_until_ready.return_value={'Version':'example'}
        self.assertTrue(serverinstall.install(Mock())['ready'])
        args=run.call_args.args[0]
        self.assertIn('--no-upgrade',args);self.assertNotIn('--ignore-security-hash',args)
        jf.return_value.wait_until_ready.assert_called_once_with(120)

    def test_checkpoint_does_not_cross_servers(self):
        self.app.save_setup({'features':['sports'],'results':{},'phase':'running'})
        self.assertEqual(self.app.setup_progress({}, {})['features'],['sports'])
        self.app.engine.jf_info={'Id':'different-server'}
        self.assertNotIn('features',self.app.setup_progress({}, {}))
    def test_busy_job_refuses_reconnect(self):
        self.app.job.running=True
        with self.assertRaises(RuntimeError):self.app.jellyfin_connect({},dict(url='http://example',username='x',password='x'))
        self.app.engine.connect_jellyfin.assert_not_called()
        self.app.job.running=False
    @patch.object(serverinstall.sys,'platform','win32')
    @patch.object(serverinstall.subprocess,'run')
    @patch.object(serverinstall,'Jellyfin')
    def test_existing_server_never_runs_os_installer(self,jf,run):
        jf.return_value.public_info.return_value={'Version':'12.3'}
        self.assertTrue(serverinstall.install(Mock())['alreadyRunning'])
        run.assert_not_called()
    def test_source_health_failure_is_not_configuration_success(self):
        from fpmigrate import sports
        jf=Mock();jf.call.return_value={'sources':[{'type':'thesportsdb','ok':False}],'warnings':['failed']}
        result=sports.check_sources(jf)
        self.assertFalse(result['ready']);self.assertIn('key or address',result['sources'][0]['message'])
        self.assertEqual(jf.call.call_args.args[:2],('GET','/sports/api/events'))
    def test_empty_source_health_not_ready(self):
        from fpmigrate import sports
        jf=Mock();jf.call.return_value={}
        result=sports.check_sources(jf)
        self.assertFalse(result['ready']);self.assertIn('No source health',result['message'])
    def test_source_health_no_games_is_not_failure(self):
        from fpmigrate import sports
        jf=Mock();jf.call.return_value={'sources':[{'type':'guide','ok':True,'games':0}]}
        result=sports.check_sources(jf)
        self.assertTrue(result['ready']);self.assertIn('0 games',result['sources'][0]['message'])
    def test_pending_source_health_is_bounded_and_not_ready(self):
        from fpmigrate import sports
        jf=Mock();jf.call.return_value={'metadata_pending':True,'sources':[{'type':'guide','ok':True,'games':0}]}
        with patch.object(sports.time,'sleep'):
            result=sports.check_sources(jf)
        self.assertFalse(result['ready']);self.assertEqual(jf.call.call_count,3)

    def test_owned_records_cannot_be_removed_on_a_different_server(self):
        journal=self.original.journal
        journal.bind_server('server-A@url-A');journal.add_owned('setup','library','same-id','Movies A')
        journal.bind_server('server-B@url-B');self.assertEqual(journal.owned(),[])
        journal.add_owned('setup','library','same-id','Movies B');journal.mark_owned_removed('library','same-id')
        journal.bind_server('server-A@url-A');self.assertEqual([o['name'] for o in journal.owned()],['Movies A'])
    def test_unbound_legacy_history_is_preserved_not_assumed(self):
        journal=self.original.journal
        journal.add_owned('setup','library','old-id','Old Movies')
        journal.bind_server('new-server');self.assertEqual(journal.owned(),[])
        self.assertEqual(journal.legacy_owned_count(),1)

    def test_http_second_tab_cannot_mutate_during_active_job(self):
        import json,threading,urllib.request,urllib.error
        from http.server import ThreadingHTTPServer
        from fpmigrate.webui import make_handler
        server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(self.app));self.app.port=server.server_port
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.app.job.running=True
        try:
            for path in ('/api/jellyfin/connect','/api/quit','/api/features/install','/api/undo-setup'):
                req=urllib.request.Request(f'http://127.0.0.1:{self.app.port}'+path,data=b'{}',headers={'X-FP-Key':self.app.key,'Content-Type':'application/json'})
                with self.assertRaises(urllib.error.HTTPError) as err:urllib.request.urlopen(req)
                self.assertEqual(err.exception.code,409)
                self.assertIn('Another setup step',json.loads(err.exception.read())['error'])
                err.exception.close()
            self.app.engine.connect_jellyfin.assert_not_called()
            self.assertFalse(self.app.stop.is_set())
        finally:
            self.app.job.running=False;server.shutdown();server.server_close();thread.join()

if __name__ == '__main__':unittest.main()
