import { DEFAULT_TARGETS, MEALS, localDay, totalsForDate, trendForMetric, validateFood, validateTargets, validateBackup } from "./domain.js";
import { storage } from "./storage.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const state = { date: localDay(), view: "today", trendMetric: "hrv", trendRange: 30, foods: [], health: [], targets: { ...DEFAULT_TARGETS }, importMeta: null, restoreData: null, worker: null };

function showView(view) {
  state.view = view;
  $$(".view").forEach((el) => el.classList.toggle("active", el.id === `${view}View`));
  $$('[data-view]').forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}

function displayDate(dateString, options = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(`${dateString}T12:00:00`));
}

function renderDate() {
  $("#todayDate").textContent = displayDate(state.date, { weekday: "long", month: "long", day: "numeric" });
  $("#shortDate").textContent = displayDate(state.date);
  $("#datePicker").value = state.date;
  $("#datePicker").max = localDay();
  $("#foodDateLabel").textContent = state.date === localDay() ? "Today" : displayDate(state.date, { weekday: "short", month: "short", day: "numeric" });
  $("#nextDay").disabled = state.date >= localDay();
}

function moveDay(offset) {
  const date = new Date(`${state.date}T12:00:00`);
  date.setDate(date.getDate() + offset);
  const next = localDay(date);
  if (next <= localDay()) { state.date = next; render(); }
}

function renderNutrition() {
  const totals = totalsForDate(state.foods, state.date);
  const caloriePercent = Math.min(100, Math.round((totals.calories / state.targets.calories) * 100));
  $("#calorieTotal").textContent = number.format(totals.calories);
  $("#calorieRemaining").textContent = number.format(Math.abs(state.targets.calories - totals.calories));
  $("#calorieRemaining").parentElement.lastChild.textContent = totals.calories > state.targets.calories ? " above target" : " remaining";
  $("#energyRing").style.setProperty("--ring", `${caloriePercent * 3.6}deg`);
  $("#energyRing span").textContent = `${caloriePercent}%`;
  $("#energyRing").setAttribute("aria-label", `${caloriePercent} percent of calorie target`);
  for (const key of ["protein", "carbs", "fat"]) {
    const parent = $(`#${key}Total`).closest("div");
    parent.querySelector("strong").innerHTML = `<b id="${key}Total">${number.format(totals[key])}</b> / ${number.format(state.targets[key])}g`;
    parent.querySelector("i").style.setProperty("--progress", `${Math.min(100, (totals[key] / state.targets[key]) * 100)}%`);
  }
}

const METRICS = [
  { key: "steps", label: "Steps", icon: "↟", unit: "steps", tone: "accent-lime", digits: 0 },
  { key: "sleep", label: "Sleep", icon: "☾", unit: "hours", tone: "accent-blue", digits: 1 },
  { key: "restingHeartRate", label: "Resting heart rate", icon: "♥", unit: "bpm", tone: "accent-red", digits: 0 },
  { key: "hrv", label: "HRV", icon: "〰", unit: "ms", tone: "accent-purple", digits: 0 },
  { key: "weight", label: "Weight", icon: "◎", unit: "kg", tone: "accent-orange", digits: 1 },
  { key: "respiratoryRate", label: "Respiratory rate", icon: "≈", unit: "breaths/min", tone: "accent-blue", digits: 1 },
  { key: "oxygenSaturation", label: "Blood oxygen", icon: "◉", unit: "%", tone: "accent-red", digits: 1 },
  { key: "activeEnergy", label: "Active energy", icon: "ϟ", unit: "kcal", tone: "accent-orange", digits: 0 },
  { key: "exercise", label: "Exercise", icon: "⌁", unit: "min", tone: "accent-lime", digits: 0 },
  { key: "distance", label: "Walking + running", icon: "→", unit: "km", tone: "accent-blue", digits: 1 },
  { key: "vo2Max", label: "VO₂ max", icon: "◇", unit: "mL/kg/min", tone: "accent-purple", digits: 1 },
];

function metricValue(metric, value) {
  if (value === null || value === undefined) return "—";
  return Number(value).toFixed(metric.digits).replace(/\.0$/, "");
}

function renderHealth() {
  const records = state.health.filter((item) => item.date === state.date);
  $("#metricGrid").innerHTML = METRICS.map((metric) => {
    const record = records.find((item) => item.metric === metric.key);
    const value = record ? metricValue(metric, record.value) : "—";
    const note = record ? `${metric.unit} · ${escapeHtml(record.source || "Apple Health")}` : "No imported data";
    return `<article class="metric-card ${metric.tone}"><span class="metric-icon">${metric.icon}</span><p>${metric.label}</p><strong>${value}</strong><small>${note}</small></article>`;
  }).join("");
  $("#openImport").textContent = state.importMeta ? "Import newer data" : "Import data";
}

function chartSvg(trend, metric, compact = false) {
  if (!trend.points.length) return `<div class="no-trend-data">No data in this range</div>`;
  const width = compact ? 260 : 900;
  const height = compact ? 74 : 260;
  const pad = compact ? 4 : 18;
  const usableWidth = width - pad * 2;
  const usableHeight = height - pad * 2;
  const range = Math.max(trend.maximum - trend.minimum, Math.abs(trend.maximum) * 0.03, 1);
  const start = Date.parse(`${trend.startDate}T12:00:00Z`);
  const end = Date.parse(`${trend.endDate}T12:00:00Z`);
  const x = (date) => pad + ((Date.parse(`${date}T12:00:00Z`) - start) / Math.max(1, end - start)) * usableWidth;
  const y = (value) => pad + (1 - (Number(value) - trend.minimum) / range) * usableHeight;
  const points = trend.points.map((point) => `${x(point.date).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const area = `${pad},${height - pad} ${points} ${width - pad},${height - pad}`;
  const grid = compact ? "" : [0.25, 0.5, 0.75].map((part) => `<line x1="${pad}" y1="${(pad + usableHeight * part).toFixed(1)}" x2="${width - pad}" y2="${(pad + usableHeight * part).toFixed(1)}" />`).join("");
  const dots = compact || trend.points.length > 31 ? "" : trend.points.map((point) => `<circle cx="${x(point.date).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="3"><title>${displayDate(point.date)}: ${metricValue(metric, point.value)} ${metric.unit}</title></circle>`).join("");
  return `<svg class="trend-chart${compact ? " mini-chart" : ""}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(metric.label)} trend with ${trend.daysWithData} days of data"><g class="chart-grid">${grid}</g><polygon class="chart-area" points="${area}"/><polyline class="chart-line" points="${points}"/>${dots}</svg>`;
}

function changeHtml(change) {
  if (change === null) return `<span class="change-pill neutral">No prior period</span>`;
  const direction = change > 0.05 ? "↑" : change < -0.05 ? "↓" : "→";
  return `<span class="change-pill ${change > 0 ? "up" : change < 0 ? "down" : "neutral"}">${direction} ${number.format(Math.abs(change))}% vs prior period</span>`;
}

function renderTrends() {
  const selected = METRICS.find((metric) => metric.key === state.trendMetric) || METRICS[0];
  const trend = trendForMetric(state.health, selected.key, state.date, state.trendRange);
  $("#trendMetricTabs").innerHTML = METRICS.map((metric) => `<button role="tab" aria-selected="${metric.key === selected.key}" class="${metric.key === selected.key ? "active" : ""}" data-trend-metric="${metric.key}">${metric.icon} ${metric.label}</button>`).join("");
  $("#trendRangeLabel").textContent = `${displayDate(trend.startDate)}–${displayDate(trend.endDate)}`;
  if (!trend.points.length) {
    $("#trendHero").innerHTML = `<div class="trend-empty"><span class="trend-empty-icon">${selected.icon}</span><div><p class="eyebrow">${selected.label}</p><h2>No data for this range</h2><p class="muted">Import an Apple Health export that includes ${selected.label.toLowerCase()} records.</p></div><button class="primary-button" id="trendImport">Import data</button></div>`;
    $("#trendImport").addEventListener("click", openImport);
  } else {
    $("#trendHero").innerHTML = `<div class="trend-summary"><div><p class="eyebrow">Latest ${selected.label}</p><div class="trend-current"><strong>${metricValue(selected, trend.latest.value)}</strong><span>${selected.unit}</span></div>${changeHtml(trend.changePercent)}</div><div class="trend-dates"><span>${displayDate(trend.startDate)}</span><span>${displayDate(trend.endDate)}</span></div></div><div class="chart-wrap">${chartSvg(trend, selected)}</div><div class="trend-stats"><div><span>Average</span><strong>${metricValue(selected, trend.average)} ${selected.unit}</strong></div><div><span>Low</span><strong>${metricValue(selected, trend.minimum)} ${selected.unit}</strong></div><div><span>High</span><strong>${metricValue(selected, trend.maximum)} ${selected.unit}</strong></div><div><span>Coverage</span><strong>${trend.daysWithData} of ${state.trendRange} days</strong></div></div>`;
  }
  $("#trendCards").innerHTML = METRICS.map((metric) => {
    const item = trendForMetric(state.health, metric.key, state.date, state.trendRange);
    return `<button class="trend-card ${metric.tone}${metric.key === selected.key ? " selected" : ""}" data-trend-metric="${metric.key}"><span class="trend-card-label"><span>${metric.icon} ${metric.label}</span><small>${item.daysWithData}/${state.trendRange} days</small></span><strong>${metricValue(metric, item.latest?.value)} <small>${item.latest ? metric.unit : ""}</small></strong>${chartSvg(item, metric, true)}</button>`;
  }).join("");
  $$('[data-trend-metric]').forEach((button) => button.addEventListener("click", () => { state.trendMetric = button.dataset.trendMetric; renderTrends(); }));
}

function mealFoodHtml(food) {
  const calories = food.calories * food.servings;
  return `<button class="food-row" data-edit-food="${escapeHtml(food.id)}"><span class="food-dot"></span><span><strong>${escapeHtml(food.name)}</strong><small>${number.format(food.servings)} serving${food.servings === 1 ? "" : "s"}${food.notes ? ` · ${escapeHtml(food.notes)}` : ""}</small></span><b>${number.format(calories)} <small>kcal</small></b><span aria-hidden="true">›</span></button>`;
}

function renderMeals() {
  const dayFoods = state.foods.filter((food) => food.date === state.date);
  $("#mealGroups").innerHTML = MEALS.map((meal) => {
    const entries = dayFoods.filter((food) => food.meal === meal);
    const calories = entries.reduce((sum, food) => sum + food.calories * food.servings, 0);
    return `<section class="meal-group"><div class="meal-head"><h2>${meal}</h2><span>${number.format(calories)} kcal</span></div>${entries.length ? entries.map(mealFoodHtml).join("") : `<button class="empty-meal" data-add-meal="${meal}"><span>＋</span>Add ${meal.toLowerCase()}</button>`}</section>`;
  }).join("");
  $("#todayMeals").innerHTML = dayFoods.length
    ? `<div><p class="eyebrow">Food log</p><h2>${dayFoods.length} ${dayFoods.length === 1 ? "entry" : "entries"} today</h2><p class="muted">${number.format(totalsForDate(state.foods, state.date).calories)} kcal logged</p></div><button class="primary-button" id="quickAdd">＋ Add food</button>`
    : `<div><p class="eyebrow">Food log</p><h2>Nothing logged yet</h2><p class="muted">Add your first meal to start today's totals.</p></div><button class="primary-button" id="quickAdd">＋ Add food</button>`;
  $("#quickAdd").addEventListener("click", () => openFood());
  $$('[data-edit-food]').forEach((button) => button.addEventListener("click", () => openFood(button.dataset.editFood)));
  $$('[data-add-meal]').forEach((button) => button.addEventListener("click", () => openFood(null, button.dataset.addMeal)));
}

function renderSettings() {
  $("#settingsContent").innerHTML = `<div class="settings-grid">
    <form class="settings-card form-stack" id="targetsForm"><div><p class="eyebrow">Daily targets</p><h2>Nutrition goals</h2></div><div class="field-grid two"><label>Calories<input name="calories" type="number" min="1" max="10000" step="1" value="${state.targets.calories}" required /></label><label>Protein (g)<input name="protein" type="number" min="1" max="10000" step="1" value="${state.targets.protein}" required /></label><label>Carbs (g)<input name="carbs" type="number" min="1" max="10000" step="1" value="${state.targets.carbs}" required /></label><label>Fat (g)<input name="fat" type="number" min="1" max="10000" step="1" value="${state.targets.fat}" required /></label></div><p class="muted compact">These are display targets you choose, not personalized recommendations.</p><p class="form-error" id="targetsError" role="alert"></p><button class="primary-button" type="submit">Save targets</button></form>
    <section class="settings-card form-stack"><div><p class="eyebrow">Local data</p><h2>Backup & restore</h2></div><p class="muted compact">Your diary and imported health summaries live only in this browser. Download a backup before clearing browser data or changing devices.</p><button class="secondary-button" id="downloadBackup">Download backup</button><label class="secondary-button file-button">Restore from backup<input id="backupFile" type="file" accept="application/json,.json" /></label><small class="muted">A restore replaces the local data only after the file passes validation.</small></section>
    <section class="settings-card form-stack"><div><p class="eyebrow">Health import</p><h2>${state.importMeta ? "Last import" : "No data imported"}</h2></div>${state.importMeta ? `<p class="import-stat"><strong>${state.importMeta.days}</strong><span>days available</span></p><p class="muted compact">Imported ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.importMeta.importedAt))}. Upload another complete export to replace these summaries.</p>` : `<p class="muted compact">Import your Apple Health ZIP to add activity, sleep, heart, respiratory, blood oxygen, fitness, and body metrics.</p>`}<button class="secondary-button" id="settingsImport">${state.importMeta ? "Import newer export" : "Import Apple Health"}</button></section>
  </div>`;
  $("#targetsForm").addEventListener("submit", saveTargets);
  $("#downloadBackup").addEventListener("click", downloadBackup);
  $("#backupFile").addEventListener("change", prepareRestore);
  $("#settingsImport").addEventListener("click", openImport);
}

function render() {
  renderDate(); renderNutrition(); renderHealth(); renderMeals();
  if (state.view === "trends") renderTrends();
  if (state.view === "settings") renderSettings();
}

function openFood(id = null, meal = "Lunch") {
  const form = $("#foodForm");
  form.reset(); $("#foodError").textContent = "";
  const food = id ? state.foods.find((item) => item.id === id) : null;
  $("#foodDialogTitle").textContent = food ? "Edit food" : "Add food";
  form.elements.id.value = food?.id || ""; form.elements.name.value = food?.name || "";
  form.elements.meal.value = food?.meal || meal; form.elements.date.value = food?.date || state.date; form.elements.date.max = localDay();
  for (const key of ["calories", "protein", "carbs", "fat"]) form.elements[key].value = food?.[key] ?? "";
  form.elements.servings.value = food?.servings ?? 1; form.elements.notes.value = food?.notes || "";
  $("#deleteFood").classList.toggle("hidden", !food); $("#foodDialog").showModal();
  setTimeout(() => form.elements.name.focus(), 50);
}

async function saveFood(event) {
  event.preventDefault(); const form = event.currentTarget;
  try {
    const existing = state.foods.find((item) => item.id === form.elements.id.value);
    const food = validateFood({ ...existing, ...Object.fromEntries(new FormData(form)) });
    await storage.putFood(food); state.foods = await storage.foods(); state.date = food.date;
    $("#foodDialog").close(); render(); toast(existing ? "Food updated" : "Food added");
  } catch (error) { $("#foodError").textContent = error.message; }
}

async function deleteFood() {
  const id = $("#foodForm").elements.id.value;
  if (!id || !window.confirm("Delete this food entry?")) return;
  await storage.deleteFood(id); state.foods = await storage.foods(); $("#foodDialog").close(); render(); toast("Food deleted");
}

function openImport() {
  $("#healthFile").value = ""; $("#importError").textContent = ""; $("#importProgress").classList.add("hidden"); $("#importResult").classList.add("hidden"); $("#importDialog").showModal();
}

function startHealthImport(file) {
  if (!file) return;
  if (state.worker) state.worker.terminate();
  const worker = new Worker("./import-worker.js", { type: "module" }); state.worker = worker;
  $("#importError").textContent = ""; $("#importResult").classList.add("hidden"); $("#importProgress").classList.remove("hidden"); $("#healthFile").disabled = true;
  worker.onmessage = async ({ data }) => {
    if (data.type === "progress") { $("#importStage").textContent = data.stage; $("#importPercent").textContent = `${data.progress}%`; $("#importBar").value = data.progress; }
    else if (data.type === "error") { finishImport(); $("#importError").textContent = data.message; }
    else if (data.type === "done") {
      try {
        const meta = { importedAt: new Date().toISOString(), fileName: file.name, ...data.summary };
        await storage.replaceHealth(data.records, meta); state.health = data.records; state.importMeta = meta; finishImport();
        $("#importResult").innerHTML = `<strong>Import complete</strong><span>${data.summary.days} days · ${data.summary.records} daily summaries from ${number.format(data.summary.sourceRecords)} supported source records</span>`;
        $("#importResult").classList.remove("hidden"); render(); toast("Health data imported");
      } catch (error) { finishImport(); $("#importError").textContent = `The file was valid, but its summaries could not be saved: ${error.message}`; }
    }
  };
  worker.onerror = () => { finishImport(); $("#importError").textContent = "The importer stopped unexpectedly. Your existing data has not changed."; };
  worker.postMessage({ file });
}

function finishImport() { state.worker?.terminate(); state.worker = null; $("#healthFile").disabled = false; $("#importProgress").classList.add("hidden"); }

async function saveTargets(event) {
  event.preventDefault();
  try { const targets = validateTargets(Object.fromEntries(new FormData(event.currentTarget))); await storage.saveTargets(targets); state.targets = targets; render(); toast("Targets saved"); }
  catch (error) { $("#targetsError").textContent = error.message; }
}

async function downloadBackup() {
  const backup = await storage.backup(); const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: `forma-backup-${localDay()}.json` }).click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast("Backup downloaded");
}

async function prepareRestore(event) {
  const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
  try { if (file.size > 50 * 1024 * 1024) throw new Error("This backup is larger than 50 MB."); state.restoreData = validateBackup(JSON.parse(await file.text())); $("#restoreError").textContent = ""; $("#restoreDialog").showModal(); }
  catch (error) { toast(error.message, true); }
}

async function restoreBackup(event) {
  event.preventDefault();
  try { await storage.restore(state.restoreData); $("#restoreDialog").close(); state.restoreData = null; await loadState(); toast("Backup restored"); }
  catch (error) { $("#restoreError").textContent = error.message; }
}

function toast(message, error = false) { const el = $("#toast"); el.textContent = message; el.classList.toggle("error", error); el.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2800); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }

function registerWebMcp() {
  const context = document.modelContext; if (!context?.registerTool) return;
  Promise.resolve(context.registerTool({ name: "add_food_entry", title: "Add food entry", description: "Add one reviewed manual food entry to the Forma diary and update the visible daily totals.", inputSchema: { type: "object", additionalProperties: false, required: ["date", "meal", "name", "calories", "protein", "carbs", "fat", "servings"], properties: { date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, meal: { type: "string", enum: MEALS }, name: { type: "string", minLength: 1, maxLength: 100 }, calories: { type: "number", minimum: 0, maximum: 10000 }, protein: { type: "number", minimum: 0, maximum: 10000 }, carbs: { type: "number", minimum: 0, maximum: 10000 }, fat: { type: "number", minimum: 0, maximum: 10000 }, servings: { type: "number", exclusiveMinimum: 0, maximum: 100 }, notes: { type: "string", maxLength: 500 } } }, annotations: { readOnlyHint: false, untrustedContentHint: false }, async execute(input) { const food = validateFood(input); await storage.putFood(food); state.foods = await storage.foods(); state.date = food.date; render(); return { id: food.id, date: food.date, calories: food.calories * food.servings }; } })).catch(() => {});
}

async function loadState() {
  try { [state.foods, state.health, state.targets, state.importMeta] = await Promise.all([storage.foods(), storage.health(), storage.targets(), storage.importMeta()]); render(); }
  catch (error) { toast(`Local storage is unavailable: ${error.message}`, true); }
}

$$('[data-view]').forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$$('[data-range]').forEach((button) => button.addEventListener("click", () => { state.trendRange = Number(button.dataset.range); $$('[data-range]').forEach((item) => item.classList.toggle("active", item === button)); renderTrends(); }));
$("#settingsShortcut").addEventListener("click", () => showView("settings"));
$("#dateButton").addEventListener("click", () => $("#datePicker").showPicker?.() || $("#datePicker").click());
$("#datePicker").addEventListener("change", (event) => { if (event.target.value) { state.date = event.target.value; render(); } });
$("#previousDay").addEventListener("click", () => moveDay(-1)); $("#nextDay").addEventListener("click", () => moveDay(1));
$("#addFood").addEventListener("click", () => openFood()); $("#openImport").addEventListener("click", openImport); $("#foodForm").addEventListener("submit", saveFood); $("#deleteFood").addEventListener("click", deleteFood);
$("#healthFile").addEventListener("change", (event) => startHealthImport(event.target.files?.[0]));
$("#cancelImport").addEventListener("click", () => { finishImport(); $("#importError").textContent = "Import cancelled. Your existing health data is unchanged."; });
$("#restoreForm").addEventListener("submit", restoreBackup); $$('[data-close]').forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.close}`).close()));
registerWebMcp(); loadState();
