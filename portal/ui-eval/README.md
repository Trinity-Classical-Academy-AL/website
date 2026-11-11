# Portal UI scoring loop

Two stages, from `LOOP-PLAN.md`.

1. **Gates** (this folder’s `run.mjs`). They compare the portal to the v5 export in `design/` using `reference-manifest.json` (design file, route, state). A run writes `reports/latest.json` and `reports/latest.html`.
2. **Judges.** Off until an API key is present. See below.

## Run the gates

```bash
node portal/ui-eval/run.mjs
```

No browser is required. The job checks:

- every manifest state has its v5 HTML file
- labels and controls in that HTML also appear in the mapped source file
- list routes do not keep a create/edit `POST` form outside a side sheet or dialog
- portal CSS defines the export’s color tokens, and page source does not add a raw hex color

```bash
PORTAL_BASE_URL=https://portal.trinityclassical.academy node portal/ui-eval/run.mjs --browser
```

`--browser` also screenshots public routes with Playwright and system Chrome (`CHROME_PATH`, default `/usr/bin/google-chrome`). Authenticated screens are not claimed as visually compared unless `PORTAL_SESSION` is a `tca_family_session` cookie.

## Judges (disabled here)

No `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or `GOOGLE_API_KEY` is available in this environment, so the panel does not run and cannot invent scores.

To turn it on:

1. Put ceiling and floor screenshots in `anchors/ceiling/` and `anchors/floor/` (Linear, Stripe, and the other references named in the plan). Do not commit credentials.
2. Export one of the keys above.
3. Run `node portal/ui-eval/run.mjs --judges`.

Each round should send unlabeled, shuffled images (candidate, previous round, golden, two ceiling anchors, one floor anchor), hide the target score, re-score the anchors, and report `candidate − anchor mean`. Polish that leaves the export goes in `reports/proposals.md`, not into the portal.
