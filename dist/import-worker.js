const MAX_ZIP_BYTES = 120 * 1024 * 1024;
const MAX_XML_BYTES = 400 * 1024 * 1024;

const TYPES = {
  HKQuantityTypeIdentifierStepCount: "steps",
  HKQuantityTypeIdentifierRestingHeartRate: "restingHeartRate",
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: "hrv",
  HKQuantityTypeIdentifierBodyMass: "weight",
  HKCategoryTypeIdentifierSleepAnalysis: "sleep",
};

const send = typeof postMessage === "function" ? postMessage : () => {};

if (typeof self !== "undefined") self.onmessage = async (event) => {
  try {
    const file = event.data.file;
    if (!file || file.size === 0) throw new Error("Choose a non-empty Apple Health export.");
    if (file.size > MAX_ZIP_BYTES) throw new Error("This export is larger than the 120 MB v1 import limit. Try an extracted export.xml or use a desktop browser.");
    send({ type: "progress", stage: "Reading export", progress: 12 });
    const buffer = await file.arrayBuffer();
    let xmlBuffer;
    if (file.name.toLowerCase().endsWith(".xml")) {
      if (buffer.byteLength > MAX_XML_BYTES) throw new Error("This XML file is larger than the 400 MB v1 limit.");
      xmlBuffer = buffer;
    } else {
      xmlBuffer = await extractExportXml(buffer);
    }
    send({ type: "progress", stage: "Finding health records", progress: 45 });
    const xml = new TextDecoder().decode(xmlBuffer);
    if (!xml.includes("<HealthData") || !xml.includes("<Record")) throw new Error("No Apple Health records were found in this file.");
    const result = parseHealthXml(xml);
    if (!result.records.length) throw new Error("No supported records were found. Forma v1 supports steps, sleep, resting heart rate, HRV, and weight.");
    send({ type: "done", ...result });
  } catch (error) {
    send({ type: "error", message: error?.message || "The Apple Health export could not be imported." });
  }
};

async function extractExportXml(buffer) {
  const view = new DataView(buffer);
  const eocd = findSignature(view, 0x06054b50, Math.max(0, buffer.byteLength - 65557));
  if (eocd < 0) throw new Error("This is not a supported ZIP archive.");
  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  for (let i = 0; i < entries; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("The ZIP directory is damaged.");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buffer, offset + 46, nameLength));
    if (/(^|\/)export\.xml$/i.test(name)) {
      if (uncompressedSize > MAX_XML_BYTES) throw new Error("The uncompressed Health XML is larger than the 400 MB v1 limit.");
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("The ZIP entry is damaged.");
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.slice(start, start + compressedSize);
      if (method === 0) return compressed;
      if (method !== 8 || typeof DecompressionStream === "undefined") throw new Error("This browser cannot unpack this Health ZIP. Extract export.xml first and upload that file.");
      send({ type: "progress", stage: "Unpacking export.xml", progress: 28 });
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const result = await new Response(stream).arrayBuffer();
      if (result.byteLength > MAX_XML_BYTES) throw new Error("The uncompressed Health XML is larger than the 400 MB v1 limit.");
      return result;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("export.xml was not found inside this ZIP.");
}

function findSignature(view, signature, from) {
  for (let i = view.byteLength - 22; i >= from; i--) if (view.getUint32(i, true) === signature) return i;
  return -1;
}

function attrs(tag) {
  const result = {};
  const regex = /([A-Za-z][\w]*)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(tag))) result[match[1]] = match[2].replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  return result;
}

function parseDate(value) {
  if (!value) return null;
  const normalized = value.replace(" ", "T").replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseHealthXml(xml) {
  const steps = new Map();
  const sleep = new Map();
  const values = new Map();
  const supportedCounts = { steps: 0, sleep: 0, restingHeartRate: 0, hrv: 0, weight: 0 };
  const recordRegex = /<Record\b[^>]*>/g;
  let match;
  while ((match = recordRegex.exec(xml))) {
    const a = attrs(match[0]);
    const metric = TYPES[a.type];
    if (!metric) continue;
    const start = parseDate(a.startDate);
    const end = parseDate(a.endDate);
    if (!start || !end) continue;
    const date = (metric === "sleep" ? a.endDate : a.startDate).slice(0, 10);
    const source = a.sourceName || "Apple Health";
    supportedCounts[metric]++;
    if (metric === "sleep") {
      if (!/Asleep/i.test(a.value || "") || /InBed|Awake/i.test(a.value || "")) continue;
      if (!sleep.has(date)) sleep.set(date, []);
      sleep.get(date).push([start.getTime(), end.getTime(), source]);
    } else if (metric === "steps") {
      const value = Number(a.value);
      if (!Number.isFinite(value) || value < 0) continue;
      const key = `${date}|${source}`;
      steps.set(key, (steps.get(key) || 0) + value);
    } else {
      let value = Number(a.value);
      if (!Number.isFinite(value) || value < 0) continue;
      let unit = a.unit || "";
      if (metric === "weight" && unit === "lb") { value *= 0.45359237; unit = "kg"; }
      if (metric === "weight" && unit === "g") { value /= 1000; unit = "kg"; }
      const key = `${date}:${metric}`;
      const current = values.get(key);
      if (!current || end > current.end) values.set(key, { id: key, date, metric, value, unit: metric === "weight" ? "kg" : unit, source, measuredAt: end.toISOString() });
    }
  }
  send({ type: "progress", stage: "Building daily summaries", progress: 82 });
  const records = [...values.values()];
  const bestSteps = new Map();
  for (const [key, value] of steps) {
    const [date, source] = key.split("|");
    if (!bestSteps.has(date) || value > bestSteps.get(date).value) bestSteps.set(date, { value, source });
  }
  for (const [date, item] of bestSteps) records.push({ id: `${date}:steps`, date, metric: "steps", value: Math.round(item.value), unit: "count", source: item.source, measuredAt: `${date}T23:59:59`, note: "Highest daily source total; avoids adding overlapping iPhone and Watch counts." });
  for (const [date, intervals] of sleep) {
    intervals.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let [start, end] = intervals[0];
    const sources = new Set();
    for (const [nextStart, nextEnd, source] of intervals) {
      sources.add(source);
      if (nextStart <= end) end = Math.max(end, nextEnd);
      else { total += end - start; start = nextStart; end = nextEnd; }
    }
    total += end - start;
    records.push({ id: `${date}:sleep`, date, metric: "sleep", value: total / 3600000, unit: "hr", source: [...sources].join(", "), measuredAt: new Date(end).toISOString(), note: "Overlapping asleep intervals merged." });
  }
  records.sort((a, b) => a.date.localeCompare(b.date) || a.metric.localeCompare(b.metric));
  return { records, summary: { days: new Set(records.map((r) => r.date)).size, records: records.length, sourceRecords: Object.values(supportedCounts).reduce((a, b) => a + b, 0), counts: supportedCounts } };
}
