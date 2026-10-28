import os, tempfile, unittest
from pathlib import Path
from unittest.mock import Mock,patch
from fpmigrate import servercare as c
from fpmigrate.engine import Engine
from fpmigrate.webui import Job
class CareTests(unittest.TestCase):
 def test_timeline_survives_restart_and_is_bounded(self):
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'events.json';job=Job(path)
   for n in range(105):job.record({'at':n,'operation':'fixture','state':'completed'})
   restored=Job(path);self.assertEqual(len(restored.timeline()),100)
   self.assertEqual(restored.timeline()[0]['at'],5)
   copied=restored.timeline();copied[0]['operation']='changed'
   self.assertEqual(restored.timeline()[0]['operation'],'fixture')
 @unittest.skipUnless(os.name=='nt','Native Windows path detection')
 def test_windows_without_legacy_os_field_and_linux_container(self):
  from fpmigrate import sports
  with tempfile.TemporaryDirectory() as tmp:
   e=Engine(Path(tmp));e.jf=Mock();e.jf.base_url='http://127.0.0.1:18496';e.jf_info={'Version':'12.4.0'}
   try:
    with patch.object(sports,'available',return_value=True),patch.object(sports,'status',return_value={}):
     e.jf.call.return_value={'ProgramDataPath':str(Path(tmp).resolve())}
     self.assertTrue(e.sports_status()['available'])
     e.jf.call.return_value={'ProgramDataPath':'/config'}
     self.assertFalse(e.sports_status()['available'])
   finally:e.journal.close()
 def test_version_only_zero_revision_normalized(self):
  self.assertTrue(c.same_version('12.4.0','12.4.0.0'))
  for a,b in [('12.4.0','12.4.0.1'),('12.4.0','12.5'),('12.4-rc1','12.4'),('', '')]:self.assertFalse(c.same_version(a,b))
 def test_busy_viewer_refuses_backup(self):
  jf=Mock();jf.call.return_value=[{'NowPlayingItem':{'Id':'owned'}}]
  with self.assertRaises(ValueError):c.create_backup(jf,{},lambda m:None)
  self.assertEqual(jf.call.call_count,1)
 def test_running_task_refuses_backup(self):
  jf=Mock();jf.call.side_effect=[[],[{'State':'Running'}]]
  with self.assertRaises(ValueError):c.create_backup(jf,{},lambda m:None)
 def test_backup_requires_manifest_readback(self):
  jf=Mock();jf.call.side_effect=[[],[],{'Path':'backup.zip'},[{'Path':'backup.zip','Options':{}}],{}]
  with self.assertRaises(RuntimeError):c.create_backup(jf,{},lambda m:None)
 def test_restore_requires_confirmation_identity_and_exact_selection(self):
  jf=Mock();jf.public_info.return_value={'Id':'A','Version':'12.4.0'}
  with self.assertRaises(ValueError):c.restore_backup(jf,{},lambda m:None)
  jf.call.assert_not_called()
  with self.assertRaises(ValueError):c.restore_backup(jf,{'confirmation':'RESTORE','serverId':'B'},lambda m:None)
  jf.call.assert_not_called()
  jf.call.return_value=[]
  with self.assertRaises(ValueError):c.restore_backup(jf,{'confirmation':'RESTORE','serverId':'A','path':'unlisted.zip'},lambda m:None)
 def test_restore_preserves_current_snapshot_before_request(self):
  jf=Mock();jf.public_info.return_value={'Id':'A','Version':'12.4.0'}
  with patch.object(c,'backups',return_value=[{'path':'selected.zip','serverVersion':'12.4.0.0'}]),patch.object(c,'idle'),patch.object(c,'create_backup',return_value={'backup':{'path':'recovery.zip'}}) as backup:
   result=c.restore_backup(jf,{'confirmation':'RESTORE','serverId':'A','path':'selected.zip'},lambda m:None)
  backup.assert_called_once();self.assertEqual(result['recoveryBackup']['path'],'recovery.zip')
  jf.call.assert_called_once_with('POST','/Backup/Restore',body={'ArchiveFileName':'selected.zip'},timeout=20,retries=0)
 def test_migration_cannot_write_verify_or_undo_another_server(self):
  with tempfile.TemporaryDirectory() as tmp:
   e=Engine(Path(tmp));e.jf=Mock();e.jf.public_info.return_value={'Id':'B'};run=e.journal.new_run('plex','A')
   try:
    for action in [e.apply,e.verify,e.rollback]:
     with self.assertRaises(ValueError):action(run)
    e.jf.update_user_data.assert_not_called();e.jf.get_user_data.assert_not_called()
   finally:e.journal.close()
 def test_timeline_contains_codes_not_exception_secrets(self):
  import time
  job=Job()
  def fail():raise ValueError('private fixture token')
  job.start('fixture',fail)
  for i in range(100):
   if not job.view()['running']:break
   time.sleep(.01)
  self.assertEqual(list(job.events)[-1]['category'],'ValueError')
  self.assertNotIn('private fixture token',str(list(job.events)))
if __name__=='__main__':unittest.main()
