# Forma architecture

Forma is a local-first web application with one stateless Python calculation endpoint. There is no account system or backend database. The browser reads Apple Health exports, derives daily summaries, and stores those summaries in IndexedDB.

## Data flow

```text
Apple Health ZIP/XML ──> import worker ──> normalized daily health records
                                                   │
Manual food form ───────────────────────────> IndexedDB
                                                   │
Daily check-in ─────────────────────────────> IndexedDB
                                                   │
               compact ML values ──> Python Function ──> Insights
```

The raw Health export is never stored or sent to the backend. A successful import replaces the earlier health summaries, while food entries and check-ins remain unchanged. Insights sends only the four supported daily health series and recovery labels to a stateless Python function.

## Modules

| Module | Responsibility |
| --- | --- |
| `dist/app.js` | Screen state, rendering, forms, and user interactions |
| `dist/demo-data.js` | Deterministic, in-memory portfolio data selected by `?demo=1` |
| `dist/domain.js` | Input validation, nutrition totals, dates, and trend calculations |
| `dist/import-worker.js` | Streaming ZIP/XML parsing and daily Apple Health aggregation |
| `dist/storage.js` | IndexedDB access and versioned backup/restore |
| `dist/insights.js` | Compact request construction and Python API client |
| `api/readiness.py` | HTTP validation and Vercel Python Function response |
| `backend/features.py` | Personal baselines and model feature construction |
| `backend/ridge.py` | Ridge-regression matrix construction and solution |
| `backend/readiness.py` | Training, chronological evaluation, and prediction explanations |

The boundaries keep storage, import parsing, Python ML calculations, HTTP transport, and interface code separate without adding an application framework.

## Portfolio demo

Demo mode generates 120 rolling days of health history and 70 matching recovery labels in the browser. It uses the same domain, chart, API-client, and Python-model paths as personal data; only its data source changes. Write operations are disabled and the storage module is bypassed, which prevents sample records from mixing with a visitor's IndexedDB data. The generated signals intentionally contain a learnable relationship so the readiness screen demonstrates model training rather than a hard-coded result.

## Personal model

The readiness model predicts the user's own 1-to-5 overall recovery rating. It is not trained to predict illness or medical outcomes.

1. For each labelled day, calculate HRV, resting-heart-rate, and sleep z-scores from the preceding 28 days.
2. Exclude the labelled day from its baseline to prevent data leakage.
3. Require at least seven earlier samples for every feature.
4. Begin training after 14 complete labelled rows.
5. Fit ridge regression in a stateless Python Function.
6. Hold out the newest 20% of rows and compare mean absolute error with a predictor that always returns the earlier training average.
7. Refit on all usable rows for the displayed prediction.

Ridge regression was selected because a personal dataset is small and the coefficients are easy to inspect. The implementation uses plain Python so each matrix operation is visible. A more complex model is justified only if it consistently improves chronological held-out performance.

The function retrains for each Insights request. This repeats a small amount of work, but avoids accounts, server persistence, stale model versions, and synchronization rules while the app has one user.

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
