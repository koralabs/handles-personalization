from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError


MODULE_PATH = Path(__file__).resolve().parents[1] / 'scripts' / 'inventory_personalization_family.py'
SPEC = spec_from_file_location('inventory_personalization_family', MODULE_PATH)
MODULE = module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class InventoryPersonalizationFamilyTests(unittest.TestCase):
    def test_load_env_file_parses_quotes_and_ignores_comments(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            env_path = Path(tmpdir) / '.env'
            env_path.write_text(
                """
# ignored
KORA_USER_AGENT="kora coverage"
SINGLE='quoted value'
SPACED = plain value
MISSING_EQUALS
EMPTY=
""".lstrip()
            )

            self.assertEqual(
                MODULE.load_env_file(env_path),
                {
                    'KORA_USER_AGENT': 'kora coverage',
                    'SINGLE': 'quoted value',
                    'SPACED': 'plain value',
                    'EMPTY': '',
                },
            )
            self.assertEqual(MODULE.load_env_file(Path(tmpdir) / 'missing.env'), {})

    def test_fetch_handle_and_script_cbor_treat_404_as_absent(self):
        handle_error = HTTPError(
            'https://preview.api.handle.me/handles/pers1@handlecontract',
            404,
            'not found',
            hdrs=None,
            fp=None,
        )
        with patch.object(MODULE, 'fetch_json', side_effect=handle_error) as fetch_json:
            self.assertEqual(
                MODULE.fetch_handle('pers1@handlecontract', 'preview', 'ua'),
                {'exists': False, 'data': None},
            )
            fetch_json.assert_called_once_with(
                'https://preview.api.handle.me/handles/pers1@handlecontract',
                'ua',
            )

        script_error = HTTPError(
            'https://preview.api.handle.me/handles/pers1@handlecontract/script',
            404,
            'not found',
            hdrs=None,
            fp=None,
        )
        with patch.object(MODULE, 'fetch_json', side_effect=script_error):
            self.assertIsNone(MODULE.fetch_script_cbor('pers1@handlecontract', 'preview', 'ua'))

        with patch.object(MODULE, 'fetch_json', return_value={'cborHex': '5901'}):
            self.assertEqual(MODULE.fetch_script_cbor('pers1@handlecontract', 'preview', 'ua'), '5901')

    def test_validator_hash_from_cbor_invokes_cardano_cli_and_removes_temp_file(self):
        seen = {}

        def fake_check_output(argv, text):
            self.assertEqual(argv[:4], ['cardano-cli', 'hash', 'script', '--script-file'])
            self.assertTrue(text)
            script_path = Path(argv[-1])
            seen['path'] = script_path
            seen['script'] = json.loads(script_path.read_text())
            self.assertTrue(script_path.exists())
            return 'validatorhash\n'

        with patch.object(MODULE.subprocess, 'check_output', side_effect=fake_check_output) as check_output:
            self.assertEqual(MODULE.validator_hash_from_cbor('5901'), 'validatorhash')

        check_output.assert_called_once()
        self.assertEqual(
            seen['script'],
            {
                'type': 'PlutusScriptV2',
                'description': 'inventory-personalization-family',
                'cborHex': '5901',
            },
        )
        self.assertFalse(seen['path'].exists())
        self.assertIsNone(MODULE.validator_hash_from_cbor(None))

    def test_parse_static_mainnet_personalization_entries_filters_valid_contract_handles(self):
        source_text = """
export const scripts = {
  preview: {
    ignored_preview: { handle: 'pz_contract_preview', validatorHash: 'bad', cbor: 'bad' },
  },
  mainnet: {
    first: {
      handle: 'pz_contract_1',
      validatorHash: 'vh1',
      cbor: 'cbor1',
      datumCbor: 'datum1',
      latest: true,
      nested: { text: 'brace } inside string' },
    },
    unrelated: {
      handle: 'not_pz_contract',
      validatorHash: 'vh2',
      cbor: 'cbor2',
    },
    incomplete: {
      handle: 'pz_contract_2',
      validatorHash: 'vh3',
    },
    latest: {
      handle: 'pz_contract_04',
      validatorHash: 'vh4',
      cbor: 'cbor4',
      latest: false,
    },
  },
  preprod: {
    ignored_preprod: { handle: 'pz_contract_preprod', validatorHash: 'bad', cbor: 'bad' },
  },
}
"""

        with patch.object(MODULE.subprocess, 'check_output', return_value=source_text):
            entries = MODULE.parse_static_mainnet_personalization_entries()

        self.assertEqual(
            entries,
            [
                {
                    'handle': 'pz_contract_1',
                    'static_address': 'first',
                    'validator_hash': 'vh1',
                    'cbor': 'cbor1',
                    'datum_cbor': 'datum1',
                    'latest': True,
                },
                {
                    'handle': 'pz_contract_04',
                    'static_address': 'latest',
                    'validator_hash': 'vh4',
                    'cbor': 'cbor4',
                    'datum_cbor': None,
                    'latest': False,
                },
            ],
        )

    def test_fetch_validator_handles_pages_until_reference_token_and_uses_cache(self):
        handle_hex = '70657273314068616e646c65636f6e7472616374'
        first_page = [{'asset_list': []} for _ in range(100)]
        second_page = [
            {
                'asset_list': [
                    {
                        'policy_id': MODULE.POLICY,
                        'asset_name': MODULE.REFERENCE_TOKEN_LABEL + handle_hex,
                    }
                ]
            }
        ]
        calls = []

        def fake_fetch_json(url, user_agent, *, method='GET', payload=None):
            calls.append((url, user_agent, method, payload))
            return first_page if len(calls) == 1 else second_page

        cache = {}
        with patch.object(MODULE, 'fetch_json', side_effect=fake_fetch_json):
            self.assertEqual(MODULE.fetch_validator_handles('preview', 'ua', 'vh', cache), ['pers1@handlecontract'])
            self.assertEqual(MODULE.fetch_validator_handles('preview', 'ua', 'vh', cache), ['pers1@handlecontract'])

        self.assertEqual(len(calls), 2)
        self.assertIn('offset=0', calls[0][0])
        self.assertIn('offset=100', calls[1][0])
        self.assertEqual(calls[0][1], 'ua')
        self.assertEqual(calls[0][2], 'POST')
        self.assertEqual(calls[0][3], {'_payment_credentials': ['vh'], '_extended': True})
        self.assertEqual(MODULE.fetch_validator_handles('preview', 'ua', None, {}), [])
        self.assertIsNone(
            MODULE.find_handle_token(
                [
                    {
                        'asset_list': [
                            {'policy_id': MODULE.POLICY, 'asset_name': MODULE.REFERENCE_TOKEN_LABEL + 'nothex'}
                        ]
                    }
                ]
            )
        )

    def test_build_live_versions_preserves_historical_personalization_versions(self):
        legacy = [
            {
                'handle': 'pz_contract',
                'ordinal': 1,
                'utxo': None,
                'validator_hash': 'vh0',
                'validator_handle_tokens': ['oldest'],
                'validator_handle_count': 1,
                'validator_live': True,
            },
            {
                'handle': 'pz_contract_1',
                'ordinal': 2,
                'utxo': None,
                'validator_hash': 'vh1',
                'validator_handle_tokens': ['older'],
                'validator_handle_count': 1,
                'validator_live': True,
            },
            {
                'handle': 'pz_contract_2',
                'ordinal': 3,
                'utxo': None,
                'validator_hash': 'vh2',
                'validator_handle_tokens': ['mid'],
                'validator_handle_count': 1,
                'validator_live': True,
            },
            {
                'handle': 'pz_contract_3',
                'ordinal': 4,
                'utxo': None,
                'validator_hash': 'vh3',
                'validator_handle_tokens': ['newer'],
                'validator_handle_count': 1,
                'validator_live': True,
            },
            {
                'handle': 'pz_contract_04',
                'ordinal': 5,
                'utxo': 'legacy-latest#0',
                'validator_hash': 'vh4',
                'validator_handle_tokens': ['latest'],
                'validator_handle_count': 1,
                'validator_live': True,
            },
        ]
        family = [
            {
                'handle': 'pers1@handlecontract',
                'ordinal': 1,
                'utxo': 'pers1#0',
                'validator_hash': 'vh4',
            }
        ]

        live_versions = MODULE.build_live_versions(legacy, family)

        self.assertEqual(
            [row['legacy_handle'] for row in live_versions],
            ['pz_contract', 'pz_contract_1', 'pz_contract_2', 'pz_contract_3', 'pz_contract_04'],
        )
        self.assertEqual(live_versions[-1]['representative_handle'], 'pers1@handlecontract')
        self.assertEqual(live_versions[-1]['representative_kind'], 'family')
        self.assertEqual([row['chronology_ordinal'] for row in live_versions], [1, 2, 3, 4, 5])

    def test_build_desired_reassignment_order_moves_latest_to_highest_ordinal(self):
        live_versions = [
            {
                'legacy_handle': 'pz_contract',
                'representative_handle': 'pz_contract',
                'representative_kind': 'legacy',
                'representative_utxo': None,
            },
            {
                'legacy_handle': 'pz_contract_1',
                'representative_handle': 'pz_contract_1',
                'representative_kind': 'legacy',
                'representative_utxo': None,
            },
            {
                'legacy_handle': 'pz_contract_2',
                'representative_handle': 'pz_contract_2',
                'representative_kind': 'legacy',
                'representative_utxo': None,
            },
            {
                'legacy_handle': 'pz_contract_3',
                'representative_handle': 'pz_contract_3',
                'representative_kind': 'legacy',
                'representative_utxo': None,
            },
            {
                'legacy_handle': 'pz_contract_04',
                'representative_handle': 'pers1@handlecontract',
                'representative_kind': 'family',
                'representative_utxo': 'pers1#0',
            },
        ]

        desired = MODULE.build_desired_reassignment_order(live_versions, 'pers', 'handlecontract')

        self.assertEqual(
            desired,
            [
                {
                    'source_handle': 'pers1@handlecontract',
                    'source_utxo': 'pers1#0',
                    'target_handle': 'pers5@handlecontract',
                    'reason': 'move latest live personalization contract to the highest handlecontract ordinal',
                },
                {
                    'source_handle': 'pz_contract',
                    'source_utxo': None,
                    'target_handle': 'pers1@handlecontract',
                    'reason': 'backfill older live personalization contract into the next lowest handlecontract ordinal',
                },
                {
                    'source_handle': 'pz_contract_1',
                    'source_utxo': None,
                    'target_handle': 'pers2@handlecontract',
                    'reason': 'backfill older live personalization contract into the next lowest handlecontract ordinal',
                },
                {
                    'source_handle': 'pz_contract_2',
                    'source_utxo': None,
                    'target_handle': 'pers3@handlecontract',
                    'reason': 'backfill older live personalization contract into the next lowest handlecontract ordinal',
                },
                {
                    'source_handle': 'pz_contract_3',
                    'source_utxo': None,
                    'target_handle': 'pers4@handlecontract',
                    'reason': 'backfill older live personalization contract into the next lowest handlecontract ordinal',
                },
            ],
        )
