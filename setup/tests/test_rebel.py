import json
import unittest
from unittest.mock import patch, Mock
from fpmigrate import rebel


class RebelSetup(unittest.TestCase):
    def setUp(self):
        self.jf = Mock(base_url='http://127.0.0.1:8096')

    def test_missing_docker_is_resumable_without_mutation(self):
        with patch.object(rebel.shutil, 'which', return_value=None), patch.object(rebel, 'command') as run:
            self.assertEqual(rebel.ready(self.jf)['phase'], 'docker')
            run.assert_not_called()

    def test_remote_docker_is_never_modified(self):
        with patch.object(rebel.shutil, 'which', return_value='docker'), patch.object(rebel, 'command', return_value=json.dumps([{'Endpoints':{'docker':{'Host':'ssh://another-machine'}}}])) as run:
            with self.assertRaisesRegex(ValueError, 'remote machine'):
                rebel.ready(self.jf)
            self.assertEqual(run.call_count, 1)

    def test_unowned_name_collision_is_not_adopted(self):
        with patch.object(rebel, 'command', side_effect=['abc', json.dumps([{'Config':{'Labels':{}}}])]):
            with self.assertRaisesRegex(ValueError, 'different installation'):
                rebel.inspect_owned()

    def test_install_requires_explicit_personal_use(self):
        with patch.object(rebel, 'ready') as ready:
            with self.assertRaises(ValueError): rebel.install(self.jf, {})
            ready.assert_not_called()

    def test_official_install_local_only_no_host_control_or_sources(self):
        with patch.object(rebel, 'ready', side_effect=[{'phase':'install'},{'phase':'configure'}]), patch.object(rebel, 'inspect_owned', return_value=None), patch.object(rebel, 'command') as run:
            messages=[]
            self.assertEqual(rebel.install(self.jf, {'personal_use':True}, messages.append)['phase'], 'configure')
            args=run.call_args_list[-1].args[0]
            self.assertIn('127.0.0.1:18808:8080',args)
            self.assertEqual(args[-1],'rebeliptv/iptv:latest')
            self.assertFalse(any('docker.sock' in x or '--privileged' in x for x in args))
            self.assertEqual(len(messages),2)

    def test_resume_does_not_pull_or_duplicate_running_install(self):
        with patch.object(rebel, 'ready', return_value={'phase':'configure'}),patch.object(rebel,'command') as run:
            rebel.install(self.jf, {'personal_use':True})
            run.assert_not_called()

    def test_existing_owned_stopped_container_is_started_without_replacing_data(self):
        with patch.object(rebel, 'ready', side_effect=[{'phase':'install'},{'phase':'configure'}]),patch.object(rebel,'inspect_owned',return_value={'State':{'Running':False}}),patch.object(rebel,'command') as run:
            rebel.install(self.jf, {'personal_use':True})
            self.assertEqual(run.call_args.args[0],['start',rebel.NAME])
