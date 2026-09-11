# Forma v1

Forma is a private, device-local health dashboard and food diary. It runs as a static web app and stores data in IndexedDB in the current browser.

## Use

- Add, edit, or delete foods from the Food screen. Nutrition is entered per serving.
- Set calorie and macro targets in Settings.
- In Apple Health on iPhone, tap your profile and choose **Export All Health Data**. Upload the resulting ZIP from Forma's Today screen. Extract and upload `export.xml` if the browser cannot decompress the ZIP.
- Review 7, 30, or 90-day charts from the Trends screen.
- Download a Forma JSON backup from Settings before clearing browser data or changing devices.

## Apple Health import rules

V1 supports steps, sleep, resting heart rate, HRV, weight, respiratory rate, blood oxygen, active energy, exercise time, walking/running distance, and VO₂ max. Raw Apple export records are streamed through a Web Worker and are not uploaded or retained. The app saves daily summaries only.

- Steps use the highest source total for each day to avoid adding overlapping Watch and iPhone totals. This may undercount when different sources cover different parts of a day.
- Overlapping asleep intervals are merged. In-bed and awake records are excluded.
- Active energy, exercise time, and walking/running distance follow the same highest-source-total rule as steps.
- Resting heart rate, HRV, weight, respiratory rate, blood oxygen, and VO₂ max use the latest record for the day.
- A successful new import replaces earlier health summaries. Food records are untouched.

The Trends screen shows the latest value, average, low, high, data coverage, and percentage change from the preceding equal-length period. It presents measurements directly; it does not calculate recovery or strain scores.

ZIP and XML content is read incrementally instead of loaded into memory as one giant string. Standard ZIP archives can be imported directly. If an exceptionally large archive uses ZIP64, extract and upload `export.xml`; direct XML also streams. The small ZIP directory is the only archive structure read into memory at once.

## Structure

- `dist/app.js`: UI flows and screen state
- `dist/domain.js`: validation, dates, and nutrition calculations
- `dist/storage.js`: IndexedDB and backup/restore
- `dist/import-worker.js`: ZIP/XML parsing and health aggregation

There is no backend, account system, photo AI, or automatic Apple Health sync in v1.

Run `npm test` for focused calculation and import checks. Serve `dist/` from any static HTTP server for local development.
