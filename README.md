# Credits Whale Watch

An independent Statement-focused watch by [Jackson](https://x.com/kingjackson_eth).

Site: https://jacksonx28.github.io/credits-whale-watch/

The site follows collector wallets building or retaining enough Credits to compose a Statement, material reductions in that capacity, and verified Credit burns into Statements. It also explains Jack's proposed Balance design from the note Jackson shared, with an illustrative quantity-transfer slider. The proposal is not presented as a confirmed launch.

## Scope

- Candidate wallets come from Blockscout's top 100 holder entries. Credit balances and contract code are verified at an Ethereum snapshot block. The holder table includes only candidates without contract code holding 80+ Credits. Contract exclusion can omit legitimate smart-wallet collectors, and indexer lag can omit a newly large holder. This is a monitored cohort, not a holder census.
- Credit changes are netted per wallet and transaction. A feed event requires at least eight net Credits added/removed, or crossing a whole 80-Credit bundle boundary, and a balance of 80+ before or after the change. Small changes that do not change bundle capacity, self-transfers, generic Statement transfers, overprints and contract wallet activity are omitted from the feed.
- A single Credit completing 79 → 80 qualifies. Eight routing Credits received and forwarded in the same transaction, with zero net position change, do not qualify. Transfers are not labelled purchases or sales.
- All Credit transfers, mint and burn logs in the 48-hour window are replayed against the verified ending balances. Holder position change includes every change, including small transfers omitted from the feed and burns. “Held 80+ throughout 48h” requires the balance never to fall below 80 after any transaction in the window. Capacity and holding are evidence, not proof of a plan to burn or the artistic quality of a curation.
- Assembly events identify the actual Credit burn owner. A mint to another recipient does not establish that recipient as the burner. Collector assembly burns outside the indexed candidate cohort are also included after checking their contract code.

## Evidence and updates

Credits: `0x97630aa70ab14ed9883b41dafccbc11349723043`.
Statements: `0x75edd94b7e49b3bd5c8047b91f165a5e265a069b`, from the official [assembly page](https://jack.art/credits/assemble), deployed at block 26,100,733.

Statement history is replayed from deployment. Each original mint must match 80 Credit Transfer-to-zero events in the same transaction; mismatches abort publishing. Cumulative mint count is distinct from circulation after overprint burns. Historical totals cover the collection even though the reader feed is filtered to collector signals.

The GitHub workflow collects hourly at minute 17, on collector/workflow changes, or manual dispatch. Public Ethereum RPC is used with an archival BlockPI fallback. A history checkpoint is reused only after its source block hash is checked. Reads use a block 12 blocks behind the chain head, reducing reorganisation risk without guaranteeing absolute finality. Failed collection retains the last successful snapshot; data older than 90 minutes is visibly stale. The page checks for new snapshots every minute. GitHub schedules can be delayed.

Run with Python 3.12 and curl:

```sh
python scripts/update.py
python -m http.server 8000
```

`ETHEREUM_RPC_URL` overrides the collector RPC. No paid API or client keys are required. GitHub Actions needs contents and Pages write permission. `data/snapshot.json` is schema version 2; `data/history.json` checkpoints raw Statement events and matched Credit burn totals. Watchlists stay in each reader's browser. There are no visitor analytics, wallet connections or trading features.

## Balance explanation

Based on the text supplied by Jackson from Jack. The proposed design permanently locks a Statement; one rating point releases one transferable ERC-20 token. A receiving wallet gets a non-transferable ERC-721 artwork that reads its balance, remains at zero, and reflects amount-weighted aggregate color ancestry. Exchange custody can further mix colors. The illustration uses a hypothetical 32,000 rating and arbitrary CMYK proportions, not a real Statement or financial forecast. Divisibility is not a promise of liquidity or demand. No Balance contract is configured or tracked as live.
