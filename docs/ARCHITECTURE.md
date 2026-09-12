# Forma architecture

Forma is intentionally a static, local-first web application. There is no application server or account system. The browser reads Apple Health exports, derives daily summaries, and stores those summaries in IndexedDB.

## Data flow

```text
Apple Health ZIP/XML ──> import worker ──> normalized daily health records
                                                   │
Manual food form ───────────────────────────> IndexedDB
                                                   │
Daily check-in ─────────────────────────────> IndexedDB
                                                   │
                         dashboard, trends, and personal model
```

The raw Health export is never stored by Forma. A successful import replaces the earlier health summaries, while food entries and check-ins remain unchanged.

## Modules

| Module | Responsibility |
| --- | --- |
| `dist/app.js` | Screen state, rendering, forms, and user interactions |
| `dist/domain.js` | Input validation, nutrition totals, dates, and trend calculations |
| `dist/import-worker.js` | Streaming ZIP/XML parsing and daily Apple Health aggregation |
| `dist/storage.js` | IndexedDB access and versioned backup/restore |
| `dist/insights.js` | Feature engineering, personal baselines, ridge regression, and evaluation |

The boundaries keep storage, import parsing, ML calculations, and interface code separate without adding a framework or abstraction layer.

## Personal model

The readiness model predicts the user's own 1-to-5 overall recovery rating. It is not trained to predict illness or medical outcomes.

1. For each labelled day, calculate HRV, resting-heart-rate, and sleep z-scores from the preceding 28 days.
2. Exclude the labelled day from its baseline to prevent data leakage.
3. Require at least seven earlier samples for every feature.
4. Begin training after 14 complete labelled rows.
5. Fit ridge regression locally in JavaScript.
6. Hold out the newest 20% of rows and compare mean absolute error with a predictor that always returns the earlier training average.
7. Refit on all usable rows for the displayed prediction.

Ridge regression was selected because a personal dataset is small and the coefficients are easy to inspect. A more complex model is justified only if it consistently improves chronological held-out performance.

## Storage and backups

IndexedDB database `forma-personal-v1` currently uses schema version 2:

- `foods`: manual food entries keyed by ID
- `health`: imported daily summaries keyed by date and metric
- `checkins`: one subjective check-in per date
- `settings`: nutrition targets
- `meta`: last-import information

Backup schema version 2 includes check-ins. Restore still accepts version 1 backups and treats their missing check-ins as an empty list.

## Future extensions

- A native iPhone companion can produce the same normalized health-record shape for automatic HealthKit sync.
- A cloud persistence adapter can replace the storage module after authentication, ownership, conflict resolution, and migration are designed.
- Natural-language or photo food entry should produce an editable draft and save through the existing food validation path. API credentials must remain on a server.
- Additional models should live beside `insights.js` and report their data requirements and evaluation against a simple baseline.
