# Forma

Forma is a local-first health dashboard, food diary, and personal readiness experiment. It imports Apple Health data without uploading the raw export, displays trends, and calls a small Python model trained from daily recovery check-ins.

[Open the private hosted app](https://forma-health-jk.jaknowles18.chatgpt.site)

## Features

- Streaming Apple Health ZIP/XML import that works with large exports
- Daily summaries for 11 activity, sleep, cardio, respiratory, fitness, and body metrics
- 7, 30, and 90-day charts with equal-period comparisons
- Manual food and macro tracking with editable targets
- 28-day personal baselines and unusual-signal detection
- Python ridge-regression readiness model with chronological evaluation
- IndexedDB persistence and validated JSON backup/restore
- Responsive phone and desktop layouts

Food entries, imported health records, check-ins, and backups remain in the current browser. When Insights opens, the browser sends only the compact daily HRV, resting-heart-rate, sleep, respiratory-rate, and recovery-label values needed for that calculation to the stateless Python function.

## Run locally

Requirements: a modern browser, Node.js 20 or newer, Python 3.12 or newer, and the Vercel CLI for the complete local application.

```bash
git clone git@github.com:jaknowles18/forma-health.git
cd forma-health
npm run check
vercel dev
```

Open the local URL printed by Vercel. A plain static server can display the dashboard, but the Insights screen needs the Python API provided by `vercel dev`.

## Deploy to Vercel

Import `jaknowles18/forma-health` as a new Vercel project and deploy it. The checked-in `vercel.json` selects `dist` as the static output and packages `api/readiness.py` as a Python Function. No build command or environment variable is required for the current model.

## Use

- Add, edit, or delete foods from the Food screen. Nutrition is entered per serving.
- Set calorie and macro targets in Settings.
- In Apple Health on iPhone, tap your profile and choose **Export All Health Data**. Upload the resulting ZIP from Forma's Today screen. Extract and upload `export.xml` if the browser cannot decompress the ZIP.
- Review 7, 30, or 90-day charts from the Trends screen.
- Complete a daily 1-to-5 check-in from Insights to train the personal readiness model.
- Download a Forma JSON backup from Settings before clearing browser data or changing devices.

## Apple Health import rules

V1 supports steps, sleep, resting heart rate, HRV, weight, respiratory rate, blood oxygen, active energy, exercise time, walking/running distance, and VO₂ max. Raw Apple export records are streamed through a Web Worker and are not uploaded or retained. The app saves daily summaries only.

- Steps use the highest source total for each day to avoid adding overlapping Watch and iPhone totals. This may undercount when different sources cover different parts of a day.
- Overlapping asleep intervals are merged. In-bed and awake records are excluded.
- Active energy, exercise time, and walking/running distance follow the same highest-source-total rule as steps.
- Resting heart rate, HRV, weight, respiratory rate, blood oxygen, and VO₂ max use the latest record for the day.
- A successful new import replaces earlier health summaries. Food records are untouched.

The Trends screen shows the latest value, average, low, high, data coverage, and percentage change from the preceding equal-length period. It presents those measurements directly; the separate Insights screen contains the experimental personal prediction.

## Experimental personal model

The Insights screen compares each day with the preceding 28 days and highlights measurements outside the user's usual range. The current date is excluded from its own baseline to prevent data leakage.

After 14 check-ins have matching HRV, resting heart rate, sleep, and at least seven earlier baseline measurements, the Python function trains a small ridge-regression model. It predicts the user's 1-to-5 reported recovery, converts that estimate to a 0-to-100 display, and returns each feature's contribution. The newest 20% of usable days are held out chronologically to compare the model's mean absolute error with an average-only prediction.

This model is educational and experimental. Its Python code exposes the baseline, matrix solving, regularization, evaluation, and explanation steps. It does not diagnose health conditions and deliberately withholds predictions when its data requirements are not met.

ZIP and XML content is read incrementally instead of loaded into memory as one giant string. Standard ZIP archives can be imported directly. If an exceptionally large archive uses ZIP64, extract and upload `export.xml`; direct XML also streams. The small ZIP directory is the only archive structure read into memory at once.

## Project structure

- `dist/app.js`: UI flows and screen state
- `dist/domain.js`: validation, dates, and nutrition calculations
- `dist/insights.js`: compact API client for the Python model
- `dist/storage.js`: IndexedDB and backup/restore
- `dist/import-worker.js`: ZIP/XML parsing and health aggregation
- `api/readiness.py`: Vercel Python Function and request validation
- `backend/features.py`: leakage-safe 28-day baselines and feature rows
- `backend/ridge.py`: commented ridge-regression matrix calculation
- `backend/readiness.py`: training, chronological evaluation, and explanations
- `tests/`: focused JavaScript and Python checks
- `docs/ARCHITECTURE.md`: data flow, ML design, storage, and extension notes

There is no backend database, account system, photo AI, or automatic Apple Health sync in v1. The Python function is stateless and retrains from the compact values supplied with each request.

Run `npm test` for focused calculation and import checks, or `npm run check` for the complete JavaScript syntax and test pass.

## Privacy and limitations

- Do not commit Apple Health exports or Forma backup files. The included `.gitignore` excludes their common names.
- Browser storage is specific to one browser and device. Download backups before clearing site data.
- The readiness model is educational and experimental. Its compact input is processed by the deployed Python function, it is not medical guidance, and it intentionally produces no score until its data requirements are met.
- A normal web app cannot read HealthKit or connect directly to an Apple Watch. Fresh data requires another manual export and import.

See [the architecture notes](docs/ARCHITECTURE.md) for the module boundaries, ML pipeline, tradeoffs, and future extension points.
