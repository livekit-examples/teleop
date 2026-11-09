"""Launcher contract, no subprocesses or credentials required."""
import importlib.util
from pathlib import Path
import unittest
import tempfile
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('demo_local', Path(__file__).with_name('demo-local.py'))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def test_conflicting_modes_are_rejected(self):
        with self.assertRaises(SystemExit): launcher.arguments(['--modal','--no-modal'])
    def test_default_is_local_even_with_modal_connection_settings(self):
        args = launcher.arguments([])
        self.assertFalse(args.modal)
        _, values, provider = launcher.profile(args, dict(
            SIM_SUPERVISOR_URL='https://example.modal.run', SIM_SUPERVISOR_KEY='k'*32))
        self.assertEqual(provider,'native')
        self.assertEqual(values['SIM_SUPERVISOR_URL'],'http://127.0.0.1:8001')
    def test_old_local_flag_remains_a_compatible_alias(self):
        self.assertFalse(launcher.arguments(['--no-modal']).modal)
    def test_local_does_not_require_modal(self):
        port, values, provider = launcher.profile(launcher.arguments([]), {})
        self.assertEqual(port,3001)
        self.assertEqual(provider,'native')
        self.assertEqual(values['SIM_SUPERVISOR_URL'],'http://127.0.0.1:8001')
    def test_modal_requires_https_service_but_no_local_dependencies(self):
        args = launcher.arguments(['--modal'])
        for values in ({}, {'SIM_SUPERVISOR_URL':'http://localhost:8001','SIM_SUPERVISOR_KEY':'k'*32}):
            with self.assertRaises(ValueError): launcher.profile(args, values)
        port, values, provider = launcher.profile(args, dict(SIM_WEB_PORT='3010',
            SIM_SUPERVISOR_URL='https://example.modal.run', SIM_SUPERVISOR_KEY='k'*32))
        self.assertEqual(port,3010)
        self.assertEqual(provider,'modal')
        self.assertNotIn('LIVEKIT_URL',values)

    def test_modal_dashboard_url_rejected_before_connecting(self):
        for url in ('https://modal.com/apps/livekit/main/deployed/teleop-trials-dev',
                    'https://www.modal.com/apps/example'):
            with self.assertRaisesRegex(ValueError, 'dashboard URL'):
                launcher.profile(launcher.arguments(['--modal']), dict(
                    SIM_SUPERVISOR_URL=url, SIM_SUPERVISOR_KEY='k'*32))
        _, values, _ = launcher.profile(launcher.arguments(['--modal']), dict(
            SIM_SUPERVISOR_URL='https://workspace--app-api.us-east.modal.run/', SIM_SUPERVISOR_KEY='k'*32))
        self.assertEqual(values['SIM_SUPERVISOR_URL'], 'https://workspace--app-api.us-east.modal.run')

    def test_startup_404_is_actionable_and_never_requests_remote_cleanup(self):
        args = launcher.arguments(['--modal'])
        values = dict(SIM_SUPERVISOR_URL='https://example.modal.run', SIM_SUPERVISOR_KEY='k'*32)
        error = urllib.error.HTTPError(values['SIM_SUPERVISOR_URL']+'/simulations', 404, 'Not Found', {}, None)
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(launcher, 'arguments', return_value=args), \
                patch.object(launcher, 'profile', return_value=(3001, values, 'modal')), \
                patch.object(launcher, 'ROOT', Path(directory)), \
                patch.object(launcher.shutil, 'which', return_value='/bin/pnpm'), \
                patch.object(launcher.socket, 'socket'), \
                patch.object(launcher.signal, 'signal'), \
                patch.object(launcher.urllib.request, 'urlopen', side_effect=error) as request, \
                patch('builtins.print') as output:
            with self.assertRaisesRegex(SystemExit, 'HTTP 404'):
                launcher.main()
            request.assert_called_once()
            self.assertEqual(request.call_args.args[0].get_method(), 'GET')
            self.assertNotIn('Remote cleanup request failed', str(output.call_args_list))
