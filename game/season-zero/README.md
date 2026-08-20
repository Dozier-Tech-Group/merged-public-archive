# Season Zero — the commitment record

`manifest.json` is the Season Zero manifest (MP-GAME.md §2, §4). Its single
puzzle entry, the **Legendary Hunt**, carries
`keccak256(canonical assignment JSON ‖ 32-byte salt)` — committed **before any
clue drops**, opened (assignment + salt) at reveal.

**Trust rule:** a manifest counts only when its own keccak256 has been echoed
in a zero-value transaction from the treasury
(`0xBCCAecdBb4F0c7af32C8018486D0b52A474d9B4a`) on chain 4663. That echo is
recorded in `echo.json` in this directory the moment it is sent — **no
`echo.json`, no active season, no clues.**

Verify any of it yourself:

```
# the manifest's own hash (what the echo transaction must carry as calldata)
node scripts/echo-manifest.mjs

# at reveal, when assignment + salt are opened:
node generator/merged-public/verify-mp.mjs --commitment --assignment <file> --salt <0x…>
```

The manifest's bytes are the commitment — `.gitattributes` pins them against
line-ending rewrites, and this file is never edited after its echo. Not
endorsed by Robinhood.
