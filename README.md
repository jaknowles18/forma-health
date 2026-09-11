# Forma v1

Forma is a private, device-local health dashboard and food diary. It runs as a static web app and stores data in IndexedDB in the current browser.

## Use

- Add, edit, or delete foods from the Food screen. Nutrition is entered per serving.
- Set calorie and macro targets in Settings.
- In Apple Health on iPhone, tap your profile and choose **Export All Health Data**. Upload the resulting ZIP from Forma's Today screen. Extract and upload `export.xml` if the browser cannot decompress the ZIP.
- Download a Forma JSON backup from Settings before clearing browser data or changing devices.

## Apple Health import rules

V1 supports steps, sleep, resting heart rate, HRV, and weight. Raw Apple export records are processed in a Web Worker and are not uploaded or retained. The app saves daily summaries only.

- Steps use the highest source total for each day to avoid adding overlapping Watch and iPhone totals. This may undercount when different sources cover different parts of a day.
- Overlapping asleep intervals are merged. In-bed and awake records are excluded.
- Resting heart rate, HRV, and weight use the latest record for the day.
- A successful new import replaces earlier health summaries. Food records are untouched.

ZIP files are limited to 120 MB and uncompressed XML to 400 MB. These bounds keep failure recoverable on mobile browsers; large histories may need a desktop browser or extracted XML.

## Structure

- `dist/app.js`: UI flows and screen state
- `dist/domain.js`: validation, dates, and nutrition calculations
- `dist/storage.js`: IndexedDB and backup/restore
- `dist/import-worker.js`: ZIP/XML parsing and health aggregation

There is no backend, account system, photo AI, or automatic Apple Health sync in v1.

Run `npm test` for focused calculation and import checks. Serve `dist/` from any static HTTP server for local development.
