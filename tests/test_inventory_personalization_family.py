from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / 'scripts' / 'inventory_personalization_family.py'
SPEC = spec_from_file_location('inventory_personalization_family', MODULE_PATH)
MODULE = module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class InventoryPersonalizationFamilyTests(unittest.TestCase):
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
