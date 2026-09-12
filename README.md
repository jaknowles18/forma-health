# Forma

Forma is a private, device-local health dashboard, food diary, and personal readiness experiment. It imports Apple Health data without uploading the raw export, displays trends, and trains a small model from daily recovery check-ins.

[Open the private hosted app](https://forma-health-jk.jaknowles18.chatgpt.site)

## Features

- Streaming Apple Health ZIP/XML import that works with large exports
- Daily summaries for 11 activity, sleep, cardio, respiratory, fitness, and body metrics
- 7, 30, and 90-day charts with equal-period comparisons
- Manual food and macro tracking with editable targets
- 28-day personal baselines and unusual-signal detection
- Local ridge-regression readiness model with chronological evaluation
- IndexedDB persistence and validated JSON backup/restore
- Responsive phone and desktop layouts

All application data stays in the current browser. The hosted app is private, so the link works only for its owner.

## Run locally

Requirements: a modern browser, Node.js 20 or newer for the checks, and Python 3 for the example static server.

```bash
git clone git@github.com:jaknowles18/forma-health.git
cd forma-health
npm run check
python3 -m http.server 4173 --directory dist
```

Open `http://localhost:4173`. The app has no package dependencies or build step.

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

After 14 check-ins have matching HRV, resting heart rate, sleep, and at least seven earlier baseline measurements, Forma trains a small ridge-regression model in the browser. It predicts the user's 1-to-5 reported recovery, converts that estimate to a 0-to-100 display, and shows each feature's contribution. The newest 20% of usable days are held out chronologically to compare the model's mean absolute error with an average-only prediction.

This model is educational and experimental. It runs locally, does not diagnose health conditions, and deliberately withholds predictions when its data requirements are not met.

ZIP and XML content is read incrementally instead of loaded into memory as one giant string. Standard ZIP archives can be imported directly. If an exceptionally large archive uses ZIP64, extract and upload `export.xml`; direct XML also streams. The small ZIP directory is the only archive structure read into memory at once.

## Project structure

- `dist/app.js`: UI flows and screen state
- `dist/domain.js`: validation, dates, and nutrition calculations
- `dist/insights.js`: baseline features, anomaly detection, ridge regression, and evaluation
- `dist/storage.js`: IndexedDB and backup/restore
- `dist/import-worker.js`: ZIP/XML parsing and health aggregation
- `tests/domain.test.js`: focused domain, import, baseline, and model checks
- `docs/ARCHITECTURE.md`: data flow, ML design, storage, and extension notes

There is no backend, account system, photo AI, or automatic Apple Health sync in v1.

Run `npm test` for focused calculation and import checks, or `npm run check` for the complete JavaScript syntax and test pass.

## Privacy and limitations

- Do not commit Apple Health exports or Forma backup files. The included `.gitignore` excludes their common names.
- Browser storage is specific to one browser and device. Download backups before clearing site data.
- The readiness model is educational and experimental. It is not medical guidance and intentionally produces no score until its data requirements are met.
- A normal web app cannot read HealthKit or connect directly to an Apple Watch. Fresh data requires another manual export and import.

See [the architecture notes](docs/ARCHITECTURE.md) for the module boundaries, ML pipeline, tradeoffs, and future extension points.
