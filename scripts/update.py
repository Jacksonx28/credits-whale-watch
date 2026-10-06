#!/usr/bin/env python3
"""Publish evidence-backed Ethereum snapshots. No wallet or paid API required."""
import concurrent.futures as cf
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import time
from collections import Counter

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

def build_activity(credit_logs, statement_logs, holders, block_times, contract_addresses=None, snapshot_time=None):
    """Follow assembly capacity, not individual marketplace/custody transfers."""
    contracts = set(contract_addresses or []) | {x['address'] for x in holders if x['isContract']}
    txs, totals = {}, Counter()
    for log in sorted(credit_logs, key=lambda x: (int(x['blockNumber'], 16), int(x['logIndex'], 16))):
        if log['topics'][0] != TRANSFER or len(log['topics']) != 4:
            continue
        sender, recipient = map(addr, log['topics'][1:3])
        if sender == recipient:
            continue
        tx = txs.setdefault(log['transactionHash'], {'block': int(log['blockNumber'], 16),
            'logIndex': int(log['logIndex'], 16), 'delta': Counter(), 'in': Counter(), 'out': Counter(), 'burns': Counter()})
        if sender != ZERO:
            tx['delta'][sender] -= 1
            totals[sender] -= 1
        if recipient != ZERO:
            tx['delta'][recipient] += 1
            totals[recipient] += 1
        if sender != ZERO and recipient != ZERO:
            tx['out'][sender] += 1
            tx['in'][recipient] += 1
        elif recipient == ZERO:
            tx['burns'][sender] += 1
    balances = {x['address']: x['balance'] - totals[x['address']] for x in holders if not x['isContract']}
    cutoff24 = (snapshot_time if snapshot_time is not None else max(block_times.values(), default=0)) - 24 * 3600
    minimums = dict(balances)
    for holder in holders:
        account = holder['address']
        holder['windowStartBalance'] = holder['balance'] - totals[account]
        holder['net24h'] = sum(tx['delta'][account] for tx in txs.values() if block_times[tx['block']] >= cutoff24)
        holder['net48h'] = totals[account]
        holder['retained48h'] = False
    mint_txs = Counter(log['transactionHash'] for log in statement_logs
        if log['topics'][0] == TRANSFER and len(log['topics']) == 4 and addr(log['topics'][1]) == ZERO)
    events = []
    for tx_hash, tx in txs.items():
        for account, before in list(balances.items()):
            after = before + tx['delta'][account]
            balances[account] = after
            minimums[account] = min(minimums[account], after)
            net = tx['in'][account] - tx['out'][account]
            crossed = before // 80 != after // 80
            # Eight Credits is a material tenth of one Statement. Bundle crossings
            # always qualify, even when just one incoming Credit completes a bundle.
            if not tx['burns'][account] and max(before, after) >= 80 and net and (abs(net) >= 8 or crossed):
                events.append({'type': 'building' if net > 0 else 'reduction', 'wallet': account,
                    'amount': abs(net), 'before': before, 'after': after, 'crossed': crossed,
                    'collection': 'Credits', 'tx': tx_hash, 'block': tx['block'], 'logIndex': tx['logIndex']})
        # These are the actual Credit burn owners, rather than NFT recipients.
        if tx_hash in mint_txs:
            for account, amount in tx['burns'].items():
                if amount >= 80 and amount % 80 == 0:
                    statement_ids = [int(log['topics'][3], 16) for log in statement_logs
                        if log['transactionHash'] == tx_hash and log['topics'][0] == TRANSFER
                        and len(log['topics']) == 4 and addr(log['topics'][1]) == ZERO]
                    events.append({'type': 'assembly', 'wallet': account, 'amount': amount, 'isContract': account in contracts,
                        'statements': statement_ids, 'statement': statement_ids[0],
                        'collection': 'Statements', 'tx': tx_hash, 'block': tx['block'], 'logIndex': tx['logIndex']})
    for holder in holders:
        holder['retained48h'] = not holder['isContract'] and minimums.get(holder['address'], 0) >= 80
    for item in events:
        item['timestamp'] = block_times[item['block']]
        item['id'] = item['tx'] + ':' + item['type'] + ':' + item['wallet']
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
    burn_owners = sorted({addr(x['topics'][1]) for x in credit_logs if x['topics'][0] == TRANSFER and len(x['topics']) == 4 and addr(x['topics'][2]) == ZERO})
    code_addresses = sorted(set(burn_owners) | {h['address'] for h in holders})
    codes = batch([('eth_getCode', [a, hex(head)]) for a in code_addresses])
    contracts = {a for a, code in zip(code_addresses, codes) if code != '0x'}
    for holder in holders:
        holder['isContract'] = holder['address'] in contracts
    activity = build_activity(credit_logs, recent_statements, holders, block_times, contracts, head_time)
    now = iso(time.time())
    snapshot = {'version': 2, 'generatedAt': now, 'block': head, 'blockTimestamp': iso(head_time),
        'windowStart': iso(timestamp(start)), 'rpc': RPC, 'confirmations': 12,
        'contracts': {'credits': CREDITS, 'statements': STATEMENTS},
        'totals': {'creditsBurnedIntoStatements': len(mints) * 80, 'statementsComposed': len(mints),
                   'statementsCirculating': len(owners), 'statementHolders': len(set(owners.values())),
                   'overprints': sum(x['topics'][0] == OVERPRINT for x in statements)},
        'holders': holders, 'activity': activity,
        'coverage': {'holderCandidates': len(holders), 'holderSource': 'Blockscout top 100 candidates; balances verified at snapshot block',
                     'statementHistoryFromBlock': DEPLOYMENT, 'focus': 'Collector capacity: 80+ Credits; net changes of 8+ or any 80-Credit bundle crossing; verified assembly burns including contract wallets; contracts excluded from capacity-change cohort'}}
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
