# slate-state

Shared counter for Slate. Push this to a **public** GitHub repo named `slate-state`.

Public matters for two reasons: Actions minutes are unlimited on public repos, and
the clients read `state.json` over anonymous `raw.githubusercontent.com`, which has
no rate limit worth worrying about. The only thing exposed is how many seconds of
reels you watched today.

- `state.json` - today's combined counter. Written only by workflows.
- `config/limit.json` - effective limit and any pending change.
- Devices never write files. They call the `report` workflow and let it do the maths.
