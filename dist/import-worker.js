const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;

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
    send({ type: "progress", stage: "Opening export", progress: 2 });
    const input = await openHealthStream(file);
    const result = await parseHealthStream(input.stream, input.uncompressedSize);
    if (!result.records.length) throw new Error("No supported records were found. Forma supports steps, sleep, resting heart rate, HRV, and weight.");
    send({ type: "done", ...result });
  } catch (error) {
    send({ type: "error", message: error?.message || "The Apple Health export could not be imported." });
  }
};

export async function openHealthStream(file) {
  if (file.name.toLowerCase().endsWith(".xml")) {
    return { stream: file.stream(), uncompressedSize: file.size };
  }
  if (file.size < 22) throw new Error("This is not a supported Apple Health ZIP.");

  const tailSize = Math.min(file.size, 65557);
  const tailStart = file.size - tailSize;
  const tail = await file.slice(tailStart).arrayBuffer();
  const tailView = new DataView(tail);
  const relativeEocd = findSignature(tailView, 0x06054b50, 0);
  if (relativeEocd < 0) throw new Error("This is not a supported ZIP archive.");
  if (tailView.getUint16(relativeEocd + 4, true) !== 0 || tailView.getUint16(relativeEocd + 6, true) !== 0) {
    throw new Error("Multi-part ZIP files are not supported. Extract export.xml and upload it directly.");
  }

  const entries = tailView.getUint16(relativeEocd + 10, true);
  const directorySize = tailView.getUint32(relativeEocd + 12, true);
  const directoryOffset = tailView.getUint32(relativeEocd + 16, true);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error("This ZIP uses the ZIP64 format. Extract export.xml and upload that file directly; large XML files now stream safely.");
  }
  if (directorySize > MAX_DIRECTORY_BYTES || directoryOffset + directorySize > file.size) throw new Error("The ZIP directory is too large or damaged.");

  send({ type: "progress", stage: "Finding export.xml", progress: 4 });
  const directory = await file.slice(directoryOffset, directoryOffset + directorySize).arrayBuffer();
  const view = new DataView(directory);
  let offset = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw new Error("The ZIP directory is damaged.");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(directory, offset + 46, nameLength));
    if (/(^|\/)export\.xml$/i.test(name)) {
      if ([compressedSize, uncompressedSize, localOffset].includes(0xffffffff)) throw new Error("The export.xml entry uses ZIP64. Extract it first and upload the XML directly.");
      return openZipEntry(file, { method, compressedSize, uncompressedSize, localOffset });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("export.xml was not found inside this ZIP.");
}

async function openZipEntry(file, entry) {
  const header = await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer();
  if (header.byteLength < 30) throw new Error("The export.xml ZIP entry is damaged.");
  const view = new DataView(header);
  if (view.getUint32(0, true) !== 0x04034b50) throw new Error("The export.xml ZIP entry is damaged.");
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  if (start + entry.compressedSize > file.size) throw new Error("The export.xml ZIP entry is incomplete.");
  const compressedStream = file.slice(start, start + entry.compressedSize).stream();
  if (entry.method === 0) return { stream: compressedStream, uncompressedSize: entry.uncompressedSize };
  if (entry.method !== 8 || typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot unpack this Health ZIP. Extract export.xml first and upload that file.");
  }
  send({ type: "progress", stage: "Streaming export.xml", progress: 5 });
  return { stream: compressedStream.pipeThrough(new DecompressionStream("deflate-raw")), uncompressedSize: entry.uncompressedSize };
}

function findSignature(view, signature, from) {
  for (let i = view.byteLength - 22; i >= from; i--) if (view.getUint32(i, true) === signature) return i;
  return -1;
}

export async function parseHealthStream(stream, expectedBytes) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const accumulator = createAccumulator();
  let carry = "";
  let bytesRead = 0;
  let lastProgress = 5;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    carry = consumeChunk(carry + decoder.decode(value, { stream: true }), accumulator);
    const progress = expectedBytes ? Math.min(94, 5 + Math.floor((bytesRead / expectedBytes) * 89)) : Math.min(94, lastProgress + 1);
    if (progress >= lastProgress + 2) {
      lastProgress = progress;
      send({ type: "progress", stage: `Reading health records · ${formatBytes(bytesRead)}`, progress });
    }
  }
  carry = consumeChunk(carry + decoder.decode(), accumulator, true);
  if (accumulator.supportedTotal === 0) throw new Error("No supported Apple Health records were found in this file.");
  send({ type: "progress", stage: "Building daily summaries", progress: 97 });
  return finalizeAccumulator(accumulator);
}

function consumeChunk(text, accumulator, final = false) {
  let cursor = 0;
  while (true) {
    const start = text.indexOf("<Record", cursor);
    if (start < 0) return final ? "" : text.slice(Math.max(cursor, text.length - 16));
    const end = text.indexOf(">", start + 7);
    if (end < 0) {
      const incomplete = text.slice(start);
      if (incomplete.length > 256000) throw new Error("The export contains a malformed Health record.");
      return incomplete;
    }
    consumeRecord(attrs(text.slice(start, end + 1)), accumulator);
    cursor = end + 1;
  }
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

function createAccumulator() {
  return { steps: new Map(), sleep: new Map(), values: new Map(), counts: { steps: 0, sleep: 0, restingHeartRate: 0, hrv: 0, weight: 0 }, supportedTotal: 0 };
}

function consumeRecord(a, accumulator) {
  const metric = TYPES[a.type];
  if (!metric) return;
  const start = parseDate(a.startDate);
  const end = parseDate(a.endDate);
  if (!start || !end || end < start) return;
  const date = (metric === "sleep" ? a.endDate : a.startDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const source = a.sourceName || "Apple Health";
  accumulator.counts[metric]++;
  accumulator.supportedTotal++;

  if (metric === "sleep") {
    if (!/Asleep/i.test(a.value || "") || /InBed|Awake/i.test(a.value || "")) return;
    if (!accumulator.sleep.has(date)) accumulator.sleep.set(date, []);
    accumulator.sleep.get(date).push([start.getTime(), end.getTime(), source]);
    return;
  }
  if (metric === "steps") {
    const value = Number(a.value);
    if (!Number.isFinite(value) || value < 0) return;
    const key = `${date}|${source}`;
    accumulator.steps.set(key, (accumulator.steps.get(key) || 0) + value);
    return;
  }

  let value = Number(a.value);
  if (!Number.isFinite(value) || value < 0) return;
  let unit = a.unit || "";
  if (metric === "weight" && unit === "lb") { value *= 0.45359237; unit = "kg"; }
  if (metric === "weight" && unit === "g") { value /= 1000; unit = "kg"; }
  const key = `${date}:${metric}`;
  const current = accumulator.values.get(key);
  if (!current || end > current.end) accumulator.values.set(key, { id: key, date, metric, value, unit: metric === "weight" ? "kg" : unit, source, measuredAt: end.toISOString(), end });
}

function finalizeAccumulator(accumulator) {
  const records = [...accumulator.values.values()].map(({ end, ...record }) => record);
  const bestSteps = new Map();
  for (const [key, value] of accumulator.steps) {
    const divider = key.indexOf("|");
    const date = key.slice(0, divider);
    const source = key.slice(divider + 1);
    if (!bestSteps.has(date) || value > bestSteps.get(date).value) bestSteps.set(date, { value, source });
  }
  for (const [date, item] of bestSteps) records.push({ id: `${date}:steps`, date, metric: "steps", value: Math.round(item.value), unit: "count", source: item.source, measuredAt: `${date}T23:59:59`, note: "Highest daily source total; avoids adding overlapping iPhone and Watch counts." });

  for (const [date, intervals] of accumulator.sleep) {
    if (!intervals.length) continue;
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
  return { records, summary: { days: new Set(records.map((record) => record.date)).size, records: records.length, sourceRecords: accumulator.supportedTotal, counts: accumulator.counts } };
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

export function parseHealthXml(xml) {
  const accumulator = createAccumulator();
  const recordRegex = /<Record\b[^>]*>/g;
  let match;
  while ((match = recordRegex.exec(xml))) consumeRecord(attrs(match[0]), accumulator);
  return finalizeAccumulator(accumulator);
}
