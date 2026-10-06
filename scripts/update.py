#!/usr/bin/env python3
"""Publish evidence-backed Ethereum snapshots. No wallet or paid API required."""
import concurrent.futures as cf
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import time
from collections import Counter, defaultdict

ROOT = Path(__file__).resolve().parents[1]
CREDITS = '0x97630aa70ab14ed9883b41dafccbc11349723043'
STATEMENTS = '0x75edd94b7e49b3bd5c8047b91f165a5e265a069b'
DEPLOYMENT = 26100733
ZERO = '0x' + '0' * 40
TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
OVERPRINT = '0xb1fc4e61314eae47e4cf0df10a3b24d278f28920ca29da6da7739043b3d6a5fa'
RPC = os.environ.get('ETHEREUM_RPC_URL', 'https://ethereum-rpc.publicnode.com')
FALLBACK_RPC = 'https://ethereum.public.blockpi.network/v1/rpc/public'

def request(url, body=None):
    for attempt in range(3):
        args = ['curl', '--fail', '--silent', '--show-error', '--max-time', '45', url]
        if body is not None:
            args += ['-H', 'Content-Type: application/json', '--data-binary', '@-']
        try:
            result = subprocess.run(args, input=json.dumps(body) if body is not None else None,
                                    capture_output=True, text=True, check=True)
            return json.loads(result.stdout)
        except (subprocess.CalledProcessError, json.JSONDecodeError) as error:
            if attempt == 2 or (isinstance(error, subprocess.CalledProcessError) and '403' in (error.stderr or '')):
                raise
            time.sleep(attempt + 1)

def rpc(method, params):
    try:
        result = request(RPC, {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})
    except subprocess.CalledProcessError:
        result = request(FALLBACK_RPC, {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})
    if 'error' in result or 'result' not in result:
        raise RuntimeError(f'{method}: {result.get("error", "missing result")}')
    return result['result']

def batch(calls):
    out = []
    for start in range(0, len(calls), 80):
        part = calls[start:start + 80]
        result = request(RPC, [{'jsonrpc': '2.0', 'id': i, 'method': m, 'params': p}
                               for i, (m, p) in enumerate(part)])
        by_id = {x['id']: x for x in result}
        for i in range(len(part)):
            item = by_id[i]
            if 'error' in item or 'result' not in item:
                raise RuntimeError(f'RPC batch failed: {item}')
            out.append(item['result'])
    return out

def get_logs(address, start, end, topics=None):
    result = []
    for first in range(start, end + 1, 5000):
        result.extend(rpc('eth_getLogs', [{'address': address, 'fromBlock': hex(first),
            'toBlock': hex(min(first + 4999, end)), 'topics': topics or []}]))
    return [x for x in result if not x.get('removed')]

def timestamp(block):
    return int(rpc('eth_getBlockByNumber', [hex(block), False])['timestamp'], 16)

def at_or_after(target, end):
    # 48 hours require roughly 14,400 blocks; widen the lower bound for missed slots.
    lo, hi = max(DEPLOYMENT, end - 18000), end
    while lo < hi:
        points = sorted(set(lo + (hi - lo) * i // 8 for i in range(9)))
        blocks = batch([('eth_getBlockByNumber', [hex(b), False]) for b in points])
        times = [int(x['timestamp'], 16) for x in blocks]
        eligible = [i for i, t in enumerate(times) if t >= target]
        if not eligible:
            raise RuntimeError('Could not locate activity window')
        i = eligible[0]
        if i == 0:
            return points[0]
        lo, hi = points[i - 1] + 1, points[i]

    return lo

def addr(topic):
    return '0x' + topic[-40:].lower()

def iso(seconds):
    return dt.datetime.fromtimestamp(seconds, dt.timezone.utc).isoformat().replace('+00:00', 'Z')

def build_activity(credit_logs, statement_logs, holders, block_times):
    grouped = {}
    for log in credit_logs:
        if log['topics'][0] != TRANSFER or len(log['topics']) != 4:
            continue
        sender, recipient = map(addr, log['topics'][1:3])
        if sender == ZERO or recipient == ZERO or sender == recipient:
            continue
        key = (log['transactionHash'], sender, recipient)
        item = grouped.setdefault(key, {'type': 'movement', 'tx': key[0], 'from': sender,
            'to': recipient, 'amount': 0, 'collection': 'Credits',
            'block': int(log['blockNumber'], 16), 'tokens': []})
        item['amount'] += 1
        item['tokens'].append(int(log['topics'][3], 16))
    monitored = {x['address'] for x in holders if x['balance'] >= 80}
    events = [x for x in grouped.values() if x['amount'] >= 80 or x['from'] in monitored or x['to'] in monitored]
    for log in statement_logs:
        topic = log['topics'][0]
        base = {'tx': log['transactionHash'], 'block': int(log['blockNumber'], 16),
                'collection': 'Statements', 'amount': 1, 'logIndex': int(log['logIndex'], 16)}
        if topic == OVERPRINT:
            events.append(dict(base, type='overprint', base=int(log['topics'][1], 16),
                               top=int(log['topics'][2], 16), wallet=addr(log['topics'][3])))
        elif topic == TRANSFER and len(log['topics']) == 4:
            sender, recipient = map(addr, log['topics'][1:3])
            token = int(log['topics'][3], 16)
            if sender == ZERO:
                events.append(dict(base, type='assembly', wallet=recipient, statement=token, amount=80))
            elif recipient != ZERO and sender != recipient:
                events.append(dict(base, type='statement-transfer', **{'from': sender, 'to': recipient}, statement=token))
    for item in events:
        item['timestamp'] = block_times[item['block']]
        item['id'] = item['tx'] + ':' + item['type'] + ':' + str(item.get('from', item.get('statement', item.get('base', '')))) + ':' + str(item.get('to', '')) + ':' + str(item.get('logIndex', ''))
        # Avoid unnecessarily shipping very large token lists; count stays exact.
        if 'tokens' in item:
            item['tokens'] = item['tokens'][:12]
    return sorted(events, key=lambda x: (x['timestamp'], x['block'], x['id']), reverse=True)

def main():
    head = int(rpc('eth_blockNumber', []), 16) - 12
    head_time = timestamp(head)
    start = at_or_after(head_time - 48 * 3600, head)
    history_path = ROOT / 'data/history.json'
    history = {'block': DEPLOYMENT - 1, 'statements': [], 'burns': {}}
    if history_path.exists():
        old = json.loads(history_path.read_text())
        if old['block'] <= head and rpc('eth_getBlockByNumber', [hex(old['block']), False])['hash'] == old['blockHash']:
            history = old
    history_start = history['block'] + 1
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        statements_f = pool.submit(get_logs, STATEMENTS, history_start, head, [[TRANSFER, OVERPRINT]])
        burns_f = pool.submit(get_logs, CREDITS, history_start, head, [TRANSFER, None, '0x' + '0' * 64])
        credits_f = pool.submit(get_logs, CREDITS, start, head, [TRANSFER])
        holders_f = pool.submit(request, f'https://eth.blockscout.com/api/v2/tokens/{CREDITS}/holders')
        statements, burns, credit_logs, candidate_data = [f.result() for f in [statements_f, burns_f, credits_f, holders_f]]
    statements = history['statements'] + statements
    burn_txs = Counter(history['burns']) + Counter(x['transactionHash'] for x in burns)
    candidates = candidate_data['items']
    cursor = candidate_data.get('next_page_params')
    if cursor:
        from urllib.parse import urlencode
        candidates += request(f'https://eth.blockscout.com/api/v2/tokens/{CREDITS}/holders?' + urlencode(cursor))['items']
    candidates = {x['address']['hash'].lower(): x for x in candidates if x['address']['hash'].lower() != ZERO}
    balances = batch([('eth_call', [{'to': CREDITS, 'data': '0x70a08231' + a[2:].zfill(64)}, hex(head)]) for a in candidates])
    holders = sorted([{'address': a, 'balance': int(b, 16), 'isContract': x['address']['is_contract'],
                       'name': x['address'].get('name')} for (a, x), b in zip(candidates.items(), balances)], key=lambda x: (-x['balance'], x['address']))
    transfer_logs = [x for x in statements if x['topics'][0] == TRANSFER and len(x['topics']) == 4]
    mints = [x for x in transfer_logs if addr(x['topics'][1]) == ZERO]
    mint_txs = Counter(x['transactionHash'] for x in mints)
    if any(burn_txs[tx] != count * 80 for tx, count in mint_txs.items()):
        raise RuntimeError('Assembly mint/burn invariant failed; refusing to publish.')
    owners = {}
    for log in sorted(transfer_logs, key=lambda x: (int(x['blockNumber'], 16), int(x['logIndex'], 16))):
        token, owner = int(log['topics'][3], 16), addr(log['topics'][2])
        if owner == ZERO:
            owners.pop(token, None)
        else:
            owners[token] = owner
    recent_statements = [x for x in statements if int(x['blockNumber'], 16) >= start]
    blocks = sorted({int(x['blockNumber'], 16) for x in credit_logs + recent_statements})
    block_times = {int(x['blockNumber'], 16): int(x['blockTimestamp'], 16) for x in credit_logs + recent_statements if x.get('blockTimestamp')}
    missing = [b for b in blocks if b not in block_times]
    raw_times = batch([('eth_getBlockByNumber', [hex(b), False]) for b in missing])
    block_times.update({b: int(x['timestamp'], 16) for b, x in zip(missing, raw_times)})
    activity = build_activity(credit_logs, recent_statements, holders, block_times)
    now = iso(time.time())
    snapshot = {'version': 1, 'generatedAt': now, 'block': head, 'blockTimestamp': iso(head_time),
        'windowStart': iso(timestamp(start)), 'rpc': RPC, 'confirmations': 12,
        'contracts': {'credits': CREDITS, 'statements': STATEMENTS},
        'totals': {'creditsBurnedIntoStatements': len(mints) * 80, 'statementsComposed': len(mints),
                   'statementsCirculating': len(owners), 'statementHolders': len(set(owners.values())),
                   'overprints': sum(x['topics'][0] == OVERPRINT for x in statements)},
        'holders': holders, 'activity': activity,
        'coverage': {'holderCandidates': len(holders), 'holderSource': 'Blockscout top 100 candidates; balances verified at snapshot block',
                     'statementHistoryFromBlock': DEPLOYMENT}}
    if not mints or len(holders) < 50:
        raise RuntimeError('Unexpected incomplete source; refusing to publish.')
    output = ROOT / 'data/snapshot.json'
    output.parent.mkdir(exist_ok=True)
    temp = output.with_suffix('.tmp')
    temp.write_text(json.dumps(snapshot, separators=(',', ':')) + '\n')
    temp.replace(output)
    historical = {'block': head, 'blockHash': rpc('eth_getBlockByNumber', [hex(head), False])['hash'],
        'statements': [{k: x[k] for k in ['topics', 'blockNumber', 'transactionHash', 'logIndex', 'blockTimestamp'] if k in x} for x in statements],
        'burns': dict(burn_txs)}
    history_path.write_text(json.dumps(historical, separators=(',', ':')) + '\n')
    print(f'Published block {head}: {len(mints)} composed, {len(activity)} recent events, {len(holders)} tracked holders.')

if __name__ == '__main__':
    main()
