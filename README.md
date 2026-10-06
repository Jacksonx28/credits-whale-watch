# Credits Whale Watch

An independent public Ethereum dashboard by [Jackson](https://x.com/kingjackson_eth).

Site: https://jacksonx28.github.io/credits-whale-watch/

The dashboard reports verified Credit burns into Statements, cumulative assemblies, circulating Statements, Overprinted events, large Credit movements and Statement transfers. An evidence-based brief summarizes a selectable 24/48-hour window. Readers can search addresses/transactions/Statement IDs, filter events and save a local-browser watchlist.

## Updates

`.github/workflows/update.yml` collects snapshots hourly at minute 17, on collector changes, and on manual dispatch. GitHub schedules can be delayed. A snapshot over 90 minutes old is visibly marked stale; the page checks the published JSON every minute. No client API keys or wallet connection. If collection fails, the last good file remains and the failed Actions run is visible in GitHub.

Run locally with Python 3.12 and curl:

```sh
python scripts/update.py
python -m http.server 8000
```

Set `ETHEREUM_RPC_URL` to override the default public Ethereum RPC. This value is a collector setting, not a browser setting. No paid API or secrets are required. Historical RPC requests have a public BlockPI fallback. A saved history checkpoint avoids replaying the whole collection every hour; its block hash is checked before incremental reuse. GitHub Actions needs contents write permission and Pages build access.

## Evidence and limitations

- Credits contract: `0x97630aa70ab14ed9883b41dafccbc11349723043`.
- Statements contract: `0x75edd94b7e49b3bd5c8047b91f165a5e265a069b`, from the official [assembly page](https://jack.art/credits/assemble); deployed at block 26,100,733.
- Statements' complete Transfer history is replayed from deployment to a block 12 blocks behind the head. This confirmation delay reduces reorganisation risk; it is not absolute finality.
- Each original Statement mint must match exactly 80 Credit Transfer-to-zero events in the same transaction. A mismatch aborts publishing. Cumulative mint count is distinct from circulation, which excludes burned Statements. Overprints come from the actual Overprinted event.
- Recent activity covers the latest 48 hours by Ethereum block timestamp. Credit movements are grouped by transaction/sender/receiver. Mint/burn/self-transfer logs are excluded. A qualifying movement involves a monitored address with at least 80 Credits **at the snapshot block**, or moves 80+ Credits between two addresses in one transaction. Transfers do not prove market purchases, sales or intent.
- Holder candidates are Blockscout's first two holder pages (up to 100), then each balance is read through `balanceOf` at the snapshot block. Ranking is within these candidates, not an exhaustive holder census. Indexer lag may omit a newly large holder. Contracts/pools are included and labelled; wallets do not necessarily represent people. Whole-bundle capacity is arithmetic, not intent. Net tracked movement excludes burns.
- Balance is proposed context only; this dashboard has no verified Balance contract configured.
- Watchlists are stored only in the reader's browser. There are no visitor analytics or automated trading features.

The snapshot includes its source block, collection time, coverage start, contract addresses, transaction hashes and monitored holder scope. All dynamic data is inserted as text, and external links are generated from validated addresses/hashes. Failure and stale states never replace missing data with zero.
