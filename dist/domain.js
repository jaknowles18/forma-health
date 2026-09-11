export const MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks"];
export const DEFAULT_TARGETS = { calories: 2200, protein: 140, carbs: 260, fat: 65 };

export function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function validateFood(input) {
  const food = {
    id: String(input.id || crypto.randomUUID()),
    date: String(input.date || ""),
    meal: String(input.meal || ""),
    name: String(input.name || "").trim(),
    calories: Number(input.calories),
    protein: Number(input.protein),
    carbs: Number(input.carbs),
    fat: Number(input.fat),
    servings: Number(input.servings),
    notes: String(input.notes || "").trim(),
    source: "manual",
    updatedAt: new Date().toISOString(),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(food.date)) throw new Error("Choose a valid date.");
  if (!MEALS.includes(food.meal)) throw new Error("Choose a meal.");
  if (!food.name) throw new Error("Enter a food name.");
  for (const key of ["calories", "protein", "carbs", "fat"]) {
    if (!Number.isFinite(food[key]) || food[key] < 0 || food[key] > 10000) throw new Error(`Enter a valid ${key} value.`);
  }
  if (!Number.isFinite(food.servings) || food.servings <= 0 || food.servings > 100) throw new Error("Servings must be greater than zero.");
  return food;
}

export function totalsForDate(foods, date) {
  return foods.filter((food) => food.date === date).reduce((totals, food) => {
    for (const key of ["calories", "protein", "carbs", "fat"]) totals[key] += food[key] * food.servings;
    return totals;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

export function validateTargets(input) {
  const result = {};
  for (const key of ["calories", "protein", "carbs", "fat"]) {
    const value = Number(input[key]);
    if (!Number.isFinite(value) || value <= 0 || value > 10000) throw new Error(`${key} target must be greater than zero.`);
    result[key] = value;
  }
  return result;
}

export function validateBackup(data) {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.foods) || !Array.isArray(data.health) || !data.targets) {
    throw new Error("This is not a valid Forma backup.");
  }
  const foods = data.foods.map(validateFood);
  const targets = validateTargets(data.targets);
  const health = data.health.map((item) => {
    if (!item || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !["steps", "sleep", "restingHeartRate", "hrv", "weight"].includes(item.metric)) {
      throw new Error("The backup contains an invalid health record.");
    }
    const value = Number(item.value);
    if (!Number.isFinite(value) || value < 0) throw new Error("The backup contains an invalid health value.");
    return { ...item, id: `${item.date}:${item.metric}`, value };
  });
  return { schemaVersion: 1, exportedAt: String(data.exportedAt || ""), foods, health, targets, importMeta: data.importMeta || null };
}
