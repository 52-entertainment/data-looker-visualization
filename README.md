# data-looker-visualization

**Public** repository hosting 52 Entertainment's Looker *custom visualizations*.
Files are served to browsers via **jsDelivr** (public CDN, HTTPS, CORS handled) and referenced in
Looker (Admin → Platform → Visualizations, or the `visualization:` block of a LookML project).

## ⚠️ Golden rule: no secrets

This repo is **public**. It must contain **display code only** (layout, client-side computation).
Never commit:

- API keys, tokens, passwords, service-account credentials;
- private internal URLs, Looker/GCP/BigQuery secrets;
- data or data extracts (data stays in Looker/BigQuery and never appears here).

A custom viz receives its data **at runtime** from the tile's Looker query — nothing to store here.

## Structure

```
data-looker-visualization/
├── README.md
└── exoty-health/
    └── exoty_health_viz.js     # "Exoty Health Cards" viz (Exoty games health)
```

One folder per visualization. Add future visualizations following the same pattern.

## Publish / update a visualization

1. Commit the `.js` file in its folder.
2. Create a **tag / release** (pinned versioning, recommended for Looker):
   - e.g. `v1`, then `v2`, `v3`… on each update.
3. The matching jsDelivr URL is:
   ```
   https://cdn.jsdelivr.net/gh/52-entertainment/data-looker-visualization@<TAG>/<folder>/<file>.js
   ```
   Example for Exoty Health, tag `v1`:
   ```
   https://cdn.jsdelivr.net/gh/52-entertainment/data-looker-visualization@v1/exoty-health/exoty_health_viz.js
   ```
   > Use a **tag** rather than `@main`: `@main` is cached by jsDelivr (~12h), which makes updates
   > unpredictable. A new tag = a new URL = no caching issues.

## Reference in Looker

Admin → Platform → **Visualizations → Add Visualization**:
- **ID**: `exoty_health_cards`
- **Label**: `Exoty Health Cards`
- **Main / URL**: the jsDelivr URL above

## Available visualizations

| Viz | ID | Folder | Query to feed |
|-----|----|--------|---------------|
| Exoty Health Cards | `exoty_health_cards` | `exoty-health/` | Daily `main_kpi` explore (KPI) or daily `std_crashlytics` explore (technical) — see the JS file header |

## "Exoty Health Cards" — how it works

- **Comparison model**: each metric is computed over its most recent **mature trailing 7-day window**
  and compared to the previous 7 days (rolling, works any day of the week).
- **Maturity**: retention cohorts are only counted once mature (Dn ⇒ installs from D−n−1 and earlier),
  so D3/D7 may reference a slightly older window than D1.
- **Metrics**: Ad spend, CPI, ARPU, ARPPU (rebuilt from daily building blocks, validated against
  Looker's native measures), Retention D1/D3/D7, and technical volumes (Android crashes / ANR, iOS crashes).
- The viewer's current date drives the windows, so everyone sees "as of the day they look".
