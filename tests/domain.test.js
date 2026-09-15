import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { totalsForDate, trendForMetric, validateBackup, validateCheckin, validateFood } from "../dist/domain.js";
import { openHealthStream, parseHealthStream, parseHealthXml } from "../dist/import-worker.js";
import { createDemoData, isDemoMode } from "../dist/demo-data.js";

test("portfolio demo stays current, complete, and opt-in", () => {
  const demo = createDemoData("2026-09-14");
  assert.equal(isDemoMode("?demo=1"), true);
  assert.equal(isDemoMode(""), false);
  assert.equal(demo.health.length, 120 * 11);
  assert.equal(demo.health.filter((item) => item.date === "2026-09-14").length, 11);
  assert.equal(demo.checkins.length, 70);
  assert.equal(demo.foods.length, 4);
  assert.equal(totalsForDate(demo.foods, "2026-09-14").calories, 2145);
});

test("servings scale food totals exactly once", () => {
  const food = validateFood({ id: "a", date: "2026-09-11", meal: "Lunch", name: "Rice bowl", calories: 200, protein: 10, carbs: 30, fat: 5, servings: 1.5 });
  assert.deepEqual(totalsForDate([food], "2026-09-11"), { calories: 300, protein: 15, carbs: 45, fat: 7.5 });
  assert.equal(totalsForDate([food], "2026-09-10").calories, 0);
});

test("invalid food and backup data are rejected", () => {
  assert.throws(() => validateFood({ date: "2026-09-11", meal: "Lunch", name: "", calories: 100, protein: 1, carbs: 1, fat: 1, servings: 1 }));
  assert.throws(() => validateBackup({ schemaVersion: 99, foods: [], health: [], targets: {} }));
});

test("daily check-ins provide bounded labels for the personal model", () => {
  const checkin = validateCheckin({ date: "2026-09-11", energy: 4, soreness: 2, mood: 5, recovery: 4, notes: "Easy run" });
  assert.equal(checkin.recovery, 4);
  assert.throws(() => validateCheckin({ ...checkin, recovery: 6 }));
});

test("Apple Health records become stable daily summaries", () => {
  const xml = `<?xml version="1.0"?><HealthData>
    <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" value="1000" startDate="2026-09-11 09:00:00 -0400" endDate="2026-09-11 10:00:00 -0400"/>
    <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" value="1800" startDate="2026-09-11 09:00:00 -0400" endDate="2026-09-11 10:00:00 -0400"/>
    <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Watch" unit="count/min" value="54" startDate="2026-09-11 08:00:00 -0400" endDate="2026-09-11 08:01:00 -0400"/>
    <Record type="HKQuantityTypeIdentifierOxygenSaturation" sourceName="Watch" unit="%" value="0.98" startDate="2026-09-11 08:00:00 -0400" endDate="2026-09-11 08:01:00 -0400"/>
    <Record type="HKQuantityTypeIdentifierActiveEnergyBurned" sourceName="Watch" unit="kJ" value="418.4" startDate="2026-09-11 09:00:00 -0400" endDate="2026-09-11 10:00:00 -0400"/>
    <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-09-10 23:00:00 -0400" endDate="2026-09-11 02:00:00 -0400"/>
    <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" value="HKCategoryValueSleepAnalysisAsleepDeep" startDate="2026-09-11 01:30:00 -0400" endDate="2026-09-11 03:30:00 -0400"/>
  </HealthData>`;
  const result = parseHealthXml(xml);
  assert.equal(result.records.find((item) => item.metric === "steps").value, 1800);
  assert.equal(result.records.find((item) => item.metric === "sleep").value, 4.5);
  assert.equal(result.records.find((item) => item.metric === "restingHeartRate").value, 54);
  assert.equal(result.records.find((item) => item.metric === "oxygenSaturation").value, 98);
  assert.ok(Math.abs(result.records.find((item) => item.metric === "activeEnergy").value - 100) < 0.000001);
});

test("trend summaries compare equal current and previous periods", () => {
  const health = [];
  for (let day = 1; day <= 14; day++) health.push({ date: `2026-09-${String(day).padStart(2, "0")}`, metric: "hrv", value: day <= 7 ? 40 : 50 });
  const trend = trendForMetric(health, "hrv", "2026-09-14", 7);
  assert.equal(trend.startDate, "2026-09-08");
  assert.equal(trend.daysWithData, 7);
  assert.equal(trend.average, 50);
  assert.equal(trend.previousAverage, 40);
  assert.equal(trend.changePercent, 25);
  assert.equal(trend.latest.date, "2026-09-14");
});

test("large XML path handles records split across stream chunks", async () => {
  const xml = `<HealthData><Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" value="321" startDate="2026-09-11 09:00:00 -0400" endDate="2026-09-11 10:00:00 -0400"/></HealthData>`;
  const bytes = new TextEncoder().encode(xml);
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 11) controller.enqueue(bytes.slice(i, i + 11));
      controller.close();
    },
  });
  const result = await parseHealthStream(stream, bytes.length);
  assert.equal(result.records[0].value, 321);
  assert.equal(result.summary.days, 1);
});

test("standard ZIP export streams without loading the whole archive", async () => {
  const xml = `<HealthData><Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" value="456" startDate="2026-09-11 09:00:00 -0400" endDate="2026-09-11 10:00:00 -0400"/></HealthData>`;
  const zip = makeZip("apple_health_export/export.xml", Buffer.from(xml));
  const file = new Blob([zip]);
  Object.defineProperty(file, "name", { value: "export.zip" });
  const input = await openHealthStream(file);
  const result = await parseHealthStream(input.stream, input.uncompressedSize);
  assert.equal(result.records[0].value, 456);
});

function makeZip(filename, content) {
  const name = Buffer.from(filename);
  const compressed = deflateRawSync(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(name.length, 28);
  const directoryOffset = local.length + name.length + compressed.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(directoryOffset, 16);
  return Buffer.concat([local, name, compressed, central, name, eocd]);
}
