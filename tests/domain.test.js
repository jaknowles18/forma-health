import test from "node:test";
import assert from "node:assert/strict";
import { totalsForDate, validateBackup, validateFood } from "../dist/domain.js";
import { parseHealthXml } from "../dist/import-worker.js";

test("servings scale food totals exactly once", () => {
  const food = validateFood({ id: "a", date: "2026-09-11", meal: "Lunch", name: "Rice bowl", calories: 200, protein: 10, carbs: 30, fat: 5, servings: 1.5 });
  assert.deepEqual(totalsForDate([food], "2026-09-11"), { calories: 300, protein: 15, carbs: 45, fat: 7.5 });
  assert.equal(totalsForDate([food], "2026-09-10").calories, 0);
});

test("invalid food and backup data are rejected", () => {
  assert.throws(() => validateFood({ date: "2026-09-11", meal: "Lunch", name: "", calories: 100, protein: 1, carbs: 1, fat: 1, servings: 1 }));
  assert.throws(() => validateBackup({ schemaVersion: 99, foods: [], health: [], targets: {} }));
});

test("Apple Health records become stable daily summaries", () => {
  const xml = `<?xml version="1.0"?><HealthData>
    <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" value="1000" startDate="2026-09-11 09:00:00 -0400" endDate="2026-09-11 10:00:00 -0400"/>
    <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" value="1800" startDate="2026-09-11 09:00:00 -0400" endDate="2026-09-11 10:00:00 -0400"/>
    <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Watch" unit="count/min" value="54" startDate="2026-09-11 08:00:00 -0400" endDate="2026-09-11 08:01:00 -0400"/>
    <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-09-10 23:00:00 -0400" endDate="2026-09-11 02:00:00 -0400"/>
    <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" value="HKCategoryValueSleepAnalysisAsleepDeep" startDate="2026-09-11 01:30:00 -0400" endDate="2026-09-11 03:30:00 -0400"/>
  </HealthData>`;
  const result = parseHealthXml(xml);
  assert.equal(result.records.find((item) => item.metric === "steps").value, 1800);
  assert.equal(result.records.find((item) => item.metric === "sleep").value, 4.5);
  assert.equal(result.records.find((item) => item.metric === "restingHeartRate").value, 54);
});
