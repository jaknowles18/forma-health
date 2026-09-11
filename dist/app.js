import { DEFAULT_TARGETS, MEALS, localDay, totalsForDate, validateFood, validateTargets, validateBackup } from "./domain.js";
import { storage } from "./storage.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const state = { date: localDay(), view: "today", foods: [], health: [], targets: { ...DEFAULT_TARGETS }, importMeta: null, restoreData: null, worker: null };

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
];

function renderHealth() {
  const records = state.health.filter((item) => item.date === state.date);
  $("#metricGrid").innerHTML = METRICS.map((metric) => {
    const record = records.find((item) => item.metric === metric.key);
    const value = record ? Number(record.value).toFixed(metric.digits).replace(/\.0$/, "") : "—";
    const note = record ? `${metric.unit} · ${escapeHtml(record.source || "Apple Health")}` : "No imported data";
    return `<article class="metric-card ${metric.tone}"><span class="metric-icon">${metric.icon}</span><p>${metric.label}</p><strong>${value}</strong><small>${note}</small></article>`;
  }).join("");
  $("#openImport").textContent = state.importMeta ? "Import newer data" : "Import data";
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
    <section class="settings-card form-stack"><div><p class="eyebrow">Health import</p><h2>${state.importMeta ? "Last import" : "No data imported"}</h2></div>${state.importMeta ? `<p class="import-stat"><strong>${state.importMeta.days}</strong><span>days available</span></p><p class="muted compact">Imported ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.importMeta.importedAt))}. Upload another complete export to replace these summaries.</p>` : `<p class="muted compact">Import the ZIP from Apple Health to add steps, sleep, resting heart rate, HRV, and weight.</p>`}<button class="secondary-button" id="settingsImport">${state.importMeta ? "Import newer export" : "Import Apple Health"}</button></section>
  </div>`;
  $("#targetsForm").addEventListener("submit", saveTargets);
  $("#downloadBackup").addEventListener("click", downloadBackup);
  $("#backupFile").addEventListener("change", prepareRestore);
  $("#settingsImport").addEventListener("click", openImport);
}

function render() {
  renderDate(); renderNutrition(); renderHealth(); renderMeals();
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
$("#settingsShortcut").addEventListener("click", () => showView("settings"));
$("#dateButton").addEventListener("click", () => $("#datePicker").showPicker?.() || $("#datePicker").click());
$("#datePicker").addEventListener("change", (event) => { if (event.target.value) { state.date = event.target.value; render(); } });
$("#previousDay").addEventListener("click", () => moveDay(-1)); $("#nextDay").addEventListener("click", () => moveDay(1));
$("#addFood").addEventListener("click", () => openFood()); $("#openImport").addEventListener("click", openImport); $("#foodForm").addEventListener("submit", saveFood); $("#deleteFood").addEventListener("click", deleteFood);
$("#healthFile").addEventListener("change", (event) => startHealthImport(event.target.files?.[0]));
$("#cancelImport").addEventListener("click", () => { finishImport(); $("#importError").textContent = "Import cancelled. Your existing health data is unchanged."; });
$("#restoreForm").addEventListener("submit", restoreBackup); $$('[data-close]').forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.close}`).close()));
registerWebMcp(); loadState();
