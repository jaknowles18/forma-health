import { DEFAULT_TARGETS, validateBackup } from "./domain.js";

const DB_NAME = "forma-personal-v1";
const DB_VERSION = 1;
const STORES = ["foods", "health", "settings", "meta"];

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Browser storage failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Browser storage failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Storage update was cancelled."));
  });
}

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("foods")) {
        const foods = db.createObjectStore("foods", { keyPath: "id" });
        foods.createIndex("date", "date", { unique: false });
      }
      if (!db.objectStoreNames.contains("health")) {
        const health = db.createObjectStore("health", { keyPath: "id" });
        health.createIndex("date", "date", { unique: false });
      }
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Forma could not open browser storage."));
  });
}

async function all(storeName) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName, "readonly").objectStore(storeName).getAll());
}

export const storage = {
  foods: () => all("foods"),
  health: () => all("health"),
  async targets() {
    const db = await openDatabase();
    const record = await requestResult(db.transaction("settings", "readonly").objectStore("settings").get("targets"));
    return record?.value || { ...DEFAULT_TARGETS };
  },
  async importMeta() {
    const db = await openDatabase();
    const record = await requestResult(db.transaction("meta", "readonly").objectStore("meta").get("lastHealthImport"));
    return record?.value || null;
  },
  async putFood(food) {
    const db = await openDatabase();
    const tx = db.transaction("foods", "readwrite");
    tx.objectStore("foods").put(food);
    await transactionDone(tx);
  },
  async deleteFood(id) {
    const db = await openDatabase();
    const tx = db.transaction("foods", "readwrite");
    tx.objectStore("foods").delete(id);
    await transactionDone(tx);
  },
  async saveTargets(targets) {
    const db = await openDatabase();
    const tx = db.transaction("settings", "readwrite");
    tx.objectStore("settings").put({ key: "targets", value: targets });
    await transactionDone(tx);
  },
  async replaceHealth(records, meta) {
    const db = await openDatabase();
    const tx = db.transaction(["health", "meta"], "readwrite");
    const store = tx.objectStore("health");
    store.clear();
    for (const record of records) store.put(record);
    tx.objectStore("meta").put({ key: "lastHealthImport", value: meta });
    await transactionDone(tx);
  },
  async backup() {
    const [foods, health, targets, importMeta] = await Promise.all([this.foods(), this.health(), this.targets(), this.importMeta()]);
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), foods, health, targets, importMeta };
  },
  async restore(input) {
    const data = validateBackup(input);
    const db = await openDatabase();
    const tx = db.transaction(STORES, "readwrite");
    STORES.forEach((name) => tx.objectStore(name).clear());
    data.foods.forEach((item) => tx.objectStore("foods").put(item));
    data.health.forEach((item) => tx.objectStore("health").put(item));
    tx.objectStore("settings").put({ key: "targets", value: data.targets });
    if (data.importMeta) tx.objectStore("meta").put({ key: "lastHealthImport", value: data.importMeta });
    await transactionDone(tx);
    return data;
  },
};
