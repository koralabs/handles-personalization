#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = ROOT.parent
API_REPO = WORKSPACE_ROOT / 'api.handle.me'
POLICY = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a'
REFERENCE_TOKEN_LABEL = '000643b0'


def load_env_file(path: Path):
    values = {}
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        v = v.strip()
        if v[:1] == v[-1:] and v[:1] in {'"', "'"}:
            v = v[1:-1]
        values[k.strip()] = v
    return values


def load_user_agent():
    for path in [
        ROOT / '.env.local',
        ROOT / '.env',
        WORKSPACE_ROOT / 'kora-bot' / '.env.local',
        WORKSPACE_ROOT / 'kora-bot' / '.env',
    ]:
        value = load_env_file(path).get('KORA_USER_AGENT')
        if value:
            return value
    value = os.environ.get('KORA_USER_AGENT')
    if value:
        return value
    raise RuntimeError('KORA_USER_AGENT not found in .env.local, .env, or environment')


def fetch_json(url: str, user_agent: str, *, method='GET', payload=None):
    headers = {'User-Agent': user_agent}
    data = None
    if payload is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(payload).encode()
    req = Request(url, headers=headers, method=method, data=data)
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def api_base(network: str):
    return f'https://{network}.api.handle.me' if network != 'mainnet' else 'https://api.handle.me'


def koios_base(network: str):
    return f'https://{network}.koios.rest/api/v1' if network != 'mainnet' else 'https://api.koios.rest/api/v1'


def fetch_handle(handle: str, network: str, user_agent: str):
    try:
        data = fetch_json(f'{api_base(network)}/handles/{quote(handle, safe="@")}', user_agent)
        return {'exists': True, 'data': data}
    except HTTPError as exc:
        if exc.code == 404:
            return {'exists': False, 'data': None}
        raise


def fetch_script_cbor(handle: str, network: str, user_agent: str):
    try:
        data = fetch_json(f'{api_base(network)}/handles/{quote(handle, safe="@")}/script', user_agent)
        return data.get('cbor') or data.get('cborHex')
    except HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def validator_hash_from_cbor(script_cbor: str | None):
    if not script_cbor:
        return None
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as tmp:
        tmp.write(json.dumps({
            'type': 'PlutusScriptV2',
            'description': 'inventory-personalization-family',
            'cborHex': script_cbor,
        }))
        tmp_path = tmp.name
    try:
        return subprocess.check_output(
            ['cardano-cli', 'hash', 'script', '--script-file', tmp_path],
            text=True,
        ).strip()
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def extract_network_scripts_block(source_text: str, network: str):
    marker = f'{network}: {{'
    start = source_text.index(marker)
    brace_start = source_text.index('{', start)
    depth = 0
    quote_char = ''
    in_string = False
    escaped = False
    for idx in range(brace_start, len(source_text)):
        ch = source_text[idx]
        if in_string:
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == quote_char:
                in_string = False
            continue
        if ch in {"'", '"'}:
            in_string = True
            quote_char = ch
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return source_text[brace_start:idx + 1]
    raise ValueError(f'could not extract {network} scripts block')


def iter_top_level_entries(block_text: str):
    entry_re = re.compile(r'^\s*([a-z0-9_]+):\s*{', re.MULTILINE)
    for match in entry_re.finditer(block_text):
        key = match.group(1)
        brace_start = match.end() - 1
        depth = 0
        quote_char = ''
        in_string = False
        escaped = False
        for idx in range(brace_start, len(block_text)):
            ch = block_text[idx]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == '\\':
                    escaped = True
                elif ch == quote_char:
                    in_string = False
                continue
            if ch in {"'", '"'}:
                in_string = True
                quote_char = ch
                continue
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    yield key, block_text[brace_start:idx + 1]
                    break


def parse_static_mainnet_personalization_entries():
    source_text = subprocess.check_output(
        ['git', '-C', str(API_REPO), 'show', 'master:config/scripts.ts'],
        text=True,
    )
    block = extract_network_scripts_block(source_text, 'mainnet')
    entries = []
    for address, body in iter_top_level_entries(block):
        handle_match = re.search(r"handle:\s*'([^']+)'", body)
        if not handle_match:
            continue
        handle = handle_match.group(1)
        if not handle.startswith('pz_contract'):
            continue
        validator_match = re.search(r"validatorHash:\s*'([^']+)'", body)
        cbor_match = re.search(r"cbor:\s*'([^']+)'", body, re.S)
        if not validator_match or not cbor_match:
            continue
        datum_match = re.search(r"datumCbor:\s*'([^']+)'", body, re.S)
        latest_match = re.search(r"latest:\s*(true|false)", body)
        entries.append({
            'handle': handle,
            'static_address': address,
            'validator_hash': validator_match.group(1),
            'cbor': cbor_match.group(1),
            'datum_cbor': datum_match.group(1) if datum_match else None,
            'latest': latest_match.group(1) == 'true' if latest_match else False,
        })
    return entries


def find_handle_token(utxos):
    for utxo in utxos:
        for asset in utxo.get('asset_list') or []:
            if asset.get('policy_id') != POLICY:
                continue
            asset_name = str(asset.get('asset_name') or '')
            if not asset_name.startswith(REFERENCE_TOKEN_LABEL):
                continue
            try:
                return bytes.fromhex(asset_name[8:]).decode('utf-8')
            except ValueError:
                continue
    return None


def fetch_validator_handles(network: str, user_agent: str, validator_hash: str | None, cache: dict[str, list]):
    if not validator_hash:
        return []
    if validator_hash not in cache:
        found = None
        offset = 0
        while found is None:
            rows = fetch_json(
                f'{koios_base(network)}/credential_utxos?limit=100&offset={offset}',
                user_agent,
                method='POST',
                payload={'_payment_credentials': [validator_hash], '_extended': True},
            )
            found = find_handle_token(rows)
            if found or len(rows) < 100:
                break
            offset += 100
        cache[validator_hash] = [found] if found else []
    return cache[validator_hash]


def build_handle_row(handle: str, ordinal: int, network: str, user_agent: str, validator_cache: dict[str, list]):
    row = fetch_handle(handle, network, user_agent)
    if not row['exists']:
        return None
    data = row['data']
    script_cbor = fetch_script_cbor(handle, network, user_agent)
    validator_hash = validator_hash_from_cbor(script_cbor)
    validator_handles = fetch_validator_handles(network, user_agent, validator_hash, validator_cache)
    return {
        'handle': handle,
        'ordinal': ordinal,
        'utxo': data.get('utxo'),
        'holder_type': data.get('holder_type'),
        'has_datum': data.get('has_datum'),
        'payment_key_hash': data.get('payment_key_hash'),
        'resolved_address': (data.get('resolved_addresses') or {}).get('ada') if isinstance(data.get('resolved_addresses'), dict) else data.get('resolved_addresses'),
        'validator_hash': validator_hash,
        'validator_handle_tokens': validator_handles,
        'validator_handle_count': len(validator_handles),
        'validator_live': len(validator_handles) > 0,
    }


def build_static_legacy_row(entry, ordinal: int, network: str, user_agent: str, validator_cache: dict[str, list]):
    row = fetch_handle(entry['handle'], network, user_agent)
    data = row['data'] if row['exists'] else {}
    validator_handles = fetch_validator_handles(network, user_agent, entry['validator_hash'], validator_cache)
    return {
        'handle': entry['handle'],
        'ordinal': ordinal,
        'utxo': data.get('utxo'),
        'holder_type': data.get('holder_type'),
        'has_datum': data.get('has_datum'),
        'payment_key_hash': data.get('payment_key_hash'),
        'resolved_address': (data.get('resolved_addresses') or {}).get('ada') if isinstance(data.get('resolved_addresses'), dict) else data.get('resolved_addresses'),
        'validator_hash': entry['validator_hash'],
        'validator_handle_tokens': validator_handles,
        'validator_handle_count': len(validator_handles),
        'validator_live': len(validator_handles) > 0,
        'static_only': not row['exists'],
        'script_cbor': entry['cbor'],
        'datum_cbor': entry['datum_cbor'],
        'static_address': entry['static_address'],
        'latest_in_static_list': entry['latest'],
    }


def build_live_versions(legacy, family):
    family_by_hash = {}
    for row in family:
        family_by_hash.setdefault(row['validator_hash'], []).append(row)

    live = []
    for row in legacy:
        if not row['validator_live']:
            continue
        family_rows = sorted(family_by_hash.get(row['validator_hash'], []), key=lambda item: item['ordinal'])
        representative = family_rows[-1] if family_rows else row
        live.append({
            'validator_hash': row['validator_hash'],
            'validator_handle_tokens': row['validator_handle_tokens'],
            'validator_handle_count': row['validator_handle_count'],
            'legacy_handle': row['handle'],
            'legacy_utxo': row['utxo'],
            'family_handles': [item['handle'] for item in family_rows],
            'representative_handle': representative['handle'],
            'representative_kind': 'family' if family_rows else 'legacy',
            'representative_ordinal': representative['ordinal'],
            'representative_utxo': representative['utxo'],
        })
    for idx, row in enumerate(live, start=1):
        row['chronology_ordinal'] = idx
    return live


def build_desired_reassignment_order(live_versions, family_prefix, family_root):
    if len(live_versions) <= 1:
        return []

    latest = live_versions[-1]
    historical = live_versions[:-1]
    desired = []

    if latest['representative_kind'] == 'family':
        target_handle = f'{family_prefix}{len(live_versions)}@{family_root}'
        if target_handle != latest['representative_handle']:
            desired.append({
                'source_handle': latest['representative_handle'],
                'source_utxo': latest['representative_utxo'],
                'target_handle': target_handle,
                'reason': 'move latest live personalization contract to the highest handlecontract ordinal',
            })
    else:
        desired.append({
            'source_handle': latest['representative_handle'],
            'source_utxo': latest['representative_utxo'],
            'target_handle': f'{family_prefix}{len(live_versions)}@{family_root}',
            'reason': 'move latest live personalization contract to the highest handlecontract ordinal',
        })

    for idx, version in enumerate(historical, start=1):
        target_handle = f'{family_prefix}{idx}@{family_root}'
        if target_handle == version['representative_handle']:
            continue
        desired.append({
            'source_handle': version['representative_handle'],
            'source_utxo': version['representative_utxo'],
            'target_handle': target_handle,
            'reason': 'backfill older live personalization contract into the next lowest handlecontract ordinal',
        })

    return desired


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--network', required=True, choices=['preview', 'preprod', 'mainnet'])
    parser.add_argument('--legacy-prefix', default='pz_contract_')
    parser.add_argument('--legacy-max', type=int, default=20)
    parser.add_argument('--family-prefix', default='pers')
    parser.add_argument('--family-max', type=int, default=20)
    parser.add_argument('--family-root', default='handlecontract')
    parser.add_argument('--current-latest', default='pers1@handlecontract')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()

    ua = load_user_agent()
    validator_cache = {}

    legacy = []
    if args.network == 'mainnet':
        static_entries = parse_static_mainnet_personalization_entries()
        for idx, entry in enumerate(reversed(static_entries), start=1):
            legacy.append(build_static_legacy_row(entry, idx, args.network, ua, validator_cache))
    else:
        for i in range(1, args.legacy_max + 1):
            row = build_handle_row(f'{args.legacy_prefix}{i:02d}', i, args.network, ua, validator_cache)
            if row:
                legacy.append(row)

    family = []
    for i in range(1, args.family_max + 1):
        row = build_handle_row(f'{args.family_prefix}{i}@{args.family_root}', i, args.network, ua, validator_cache)
        if row:
            family.append(row)

    live_family = [row for row in family if row.get('validator_hash')]
    latest_family = max(live_family, key=lambda row: row['ordinal'])['handle'] if live_family else args.current_latest
    live_versions = build_live_versions(legacy, family)
    desired = build_desired_reassignment_order(live_versions, args.family_prefix, args.family_root)

    existing_family = {row['handle'] for row in family}
    required_handles = sorted({entry['target_handle'] for entry in desired})
    missing_handles = [handle for handle in required_handles if handle not in existing_family]

    out = {
        'network': args.network,
        'legacy_prefix': args.legacy_prefix,
        'family_prefix': args.family_prefix,
        'family_root': args.family_root,
        'current_latest': latest_family,
        'legacy_handles': legacy,
        'family_handles': family,
        'live_versions': live_versions,
        'desired_reassignment_order': desired,
        'required_handles': required_handles,
        'missing_handles': missing_handles,
    }
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2) + '\n')
    print(out_path)


if __name__ == '__main__':
    main()
