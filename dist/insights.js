const MODEL_FEATURES = [
  { metric: "hrv", label: "HRV" },
  { metric: "restingHeartRate", label: "Resting heart rate" },
  { metric: "sleep", label: "Sleep" },
];

const BASELINE_DAYS = 28;
const MIN_BASELINE_SAMPLES = 7;
export const MIN_TRAINING_ROWS = 14;

function shiftDay(day, offset) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/**
 * Compare one day's value with the preceding 28 calendar days.
 * The current day is deliberately excluded. Including it would leak the value
 * we are evaluating into its own baseline and make unusual values look safer.
 */
export function baselineForMetric(health, metric, date, windowDays = BASELINE_DAYS) {
  const current = health.find((item) => item.metric === metric && item.date === date) || null;
  const start = shiftDay(date, -windowDays);
  const history = health
    .filter((item) => item.metric === metric && item.date >= start && item.date < date)
    .map((item) => Number(item.value))
    .filter(Number.isFinite);
  if (!current || history.length < MIN_BASELINE_SAMPLES) {
    return { metric, current, average: null, standardDeviation: null, zScore: null, samples: history.length, requiredSamples: MIN_BASELINE_SAMPLES };
  }
  const average = history.reduce((sum, value) => sum + value, 0) / history.length;
  const variance = history.reduce((sum, value) => sum + (value - average) ** 2, 0) / history.length;
  const standardDeviation = Math.sqrt(variance);
  // A flat history has no usable standard deviation. Preserve exact matches as
  // normal, but cap a changed value at ±3 so it is still reported as unusual.
  const difference = Number(current.value) - average;
  const zScore = standardDeviation < 1e-9 ? (Math.abs(difference) < 1e-9 ? 0 : Math.sign(difference) * 3) : difference / standardDeviation;
  return { metric, current, average, standardDeviation, zScore, samples: history.length, requiredSamples: MIN_BASELINE_SAMPLES };
}

export function unusualSignals(health, date) {
  return ["hrv", "restingHeartRate", "sleep", "respiratoryRate"]
    .map((metric) => baselineForMetric(health, metric, date))
    .filter((item) => item.current)
    .sort((a, b) => Math.abs(b.zScore || 0) - Math.abs(a.zScore || 0));
}

function featureRow(health, date) {
  const baselines = MODEL_FEATURES.map((feature) => ({ ...feature, baseline: baselineForMetric(health, feature.metric, date) }));
  const missing = baselines.filter((item) => item.baseline.zScore === null).map((item) => item.label);
  return { date, values: baselines.map((item) => item.baseline.zScore), baselines, missing };
}

// Solve a small linear system with Gaussian elimination. Keeping this here
// makes the model inspectable and avoids shipping a large ML dependency for a
// three-feature personal regression.
function solveLinearSystem(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < rows.length; column++) {
    let pivot = column;
    for (let row = column + 1; row < rows.length; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    if (Math.abs(rows[column][column]) < 1e-10) return null;
    const divisor = rows[column][column];
    for (let cell = column; cell <= rows.length; cell++) rows[column][cell] /= divisor;
    for (let row = 0; row < rows.length; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let cell = column; cell <= rows.length; cell++) rows[row][cell] -= factor * rows[column][cell];
    }
  }
  return rows.map((row) => row.at(-1));
}

/** Train ridge regression: (XᵀX + λI)⁻¹Xᵀy. */
function fitRidge(rows, lambda = 1.5) {
  const width = MODEL_FEATURES.length + 1;
  const matrix = Array.from({ length: width }, () => Array(width).fill(0));
  const vector = Array(width).fill(0);
  for (const row of rows) {
    const x = [1, ...row.values];
    for (let i = 0; i < width; i++) {
      vector[i] += x[i] * row.target;
      for (let j = 0; j < width; j++) matrix[i][j] += x[i] * x[j];
    }
  }
  // Do not penalize the intercept; penalize only feature coefficients.
  for (let i = 1; i < width; i++) matrix[i][i] += lambda;
  const coefficients = solveLinearSystem(matrix, vector);
  return coefficients ? { intercept: coefficients[0], weights: coefficients.slice(1) } : null;
}

function predict(model, values) {
  return model.intercept + values.reduce((sum, value, index) => sum + value * model.weights[index], 0);
}

export function trainReadinessModel(health, checkins) {
  const rows = checkins
    .map((checkin) => ({ ...featureRow(health, checkin.date), target: Number(checkin.recovery) }))
    .filter((row) => row.missing.length === 0 && Number.isFinite(row.target))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < MIN_TRAINING_ROWS) return { ready: false, rows: rows.length, requiredRows: MIN_TRAINING_ROWS, skippedRows: checkins.length - rows.length };

  // The newest 20% is held out chronologically. Random splitting would let
  // nearby future days influence evaluation and overstate time-series quality.
  const testSize = Math.max(3, Math.floor(rows.length * 0.2));
  const training = rows.slice(0, -testSize);
  const testing = rows.slice(-testSize);
  const evaluationModel = fitRidge(training);
  const naivePrediction = training.reduce((sum, row) => sum + row.target, 0) / training.length;
  const mae = testing.reduce((sum, row) => sum + Math.abs(predict(evaluationModel, row.values) - row.target), 0) / testing.length;
  const baselineMae = testing.reduce((sum, row) => sum + Math.abs(naivePrediction - row.target), 0) / testing.length;
  return { ready: true, rows: rows.length, requiredRows: MIN_TRAINING_ROWS, model: fitRidge(rows), evaluation: { mae, baselineMae, testDays: testSize } };
}

export function readinessForDate(health, checkins, date) {
  const training = trainReadinessModel(health, checkins);
  const features = featureRow(health, date);
  if (!training.ready || features.missing.length) return { ...training, date, missing: features.missing, baselines: features.baselines, prediction: null };
  const rawPrediction = predict(training.model, features.values);
  const prediction = Math.min(5, Math.max(1, rawPrediction));
  const contributions = MODEL_FEATURES.map((feature, index) => ({
    label: feature.label,
    zScore: features.values[index],
    effect: training.model.weights[index] * features.values[index],
  })).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  return {
    ...training,
    date,
    missing: [],
    baselines: features.baselines,
    prediction,
    score: Math.round(((prediction - 1) / 4) * 100),
    confidence: training.rows >= 60 ? "Established" : training.rows >= 30 ? "Growing" : "Early",
    contributions,
  };
}
