"use strict";

const STORAGE_KEY = "garagelog.milestone1.vehicles.v1";
const $ = (id) => document.getElementById(id);
let vehicles = [];
let selectedVehicleId = null;
let pendingVehicle = null;
let pendingMaintenance = null;
let currentRoute = "vehicles";
const undoStack = [];
const redoStack = [];

function safeText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}
function prettyMiles(value) {
  return Number(value).toLocaleString("en-US");
}
function readableDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate));
  if (!match) return String(isoDate);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    .toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function newId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function getVehicle(id) { return vehicles.find((v) => v.id === id); }

function announce(message, isError = false) {
  const status = $("status");
  status.hidden = false;
  status.classList.toggle("error-status", isError);
  status.textContent = message;
}
function hideStatus() { $("status").hidden = true; }
function updateUndoRedo() {
  $("undo-btn").disabled = undoStack.length === 0;
  $("redo-btn").disabled = redoStack.length === 0;
}
function writeData(data) {
  // If storage fails (private mode, quota, or blocked permissions), do NOT
  // claim the record was saved or alter the displayed data.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    announce("Saving failed because browser storage is unavailable or full. Your changes were not saved.", true);
    console.error("GarageLog save failed:", error);
    return false;
  }
}
function commitData(next, label) {
  if (!writeData(next)) return false;
  undoStack.push({ before: clone(vehicles), after: clone(next), label });
  redoStack.length = 0;
  vehicles = clone(next);
  updateUndoRedo();
  return true;
}
function undo() {
  const action = undoStack[undoStack.length - 1];
  if (!action || !writeData(action.before)) return;
  undoStack.pop();
  redoStack.push(action);
  vehicles = clone(action.before);
  updateUndoRedo();
  if (selectedVehicleId && !getVehicle(selectedVehicleId)) selectedVehicleId = null;
  showRoute("vehicles");
  announce(`Undid ${action.label}. You can redo this change.`);
}
function redo() {
  const action = redoStack[redoStack.length - 1];
  if (!action || !writeData(action.after)) return;
  redoStack.pop();
  undoStack.push(action);
  vehicles = clone(action.after);
  updateUndoRedo();
  showRoute("vehicles");
  announce(`Redid ${action.label}.`);
}
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Stored data is not a vehicle array");
    for (const vehicle of parsed) {
      if (!vehicle || typeof vehicle.id !== "string" || typeof vehicle.make !== "string" ||
        !Array.isArray(vehicle.maintenance)) throw new Error("Stored vehicle is invalid");
    }
    vehicles = parsed;
  } catch (error) {
    // Do not overwrite damaged or inaccessible data with an empty array.
    announce("Existing saved data could not be loaded. Avoid saving new records until the issue is resolved.", true);
    console.error("GarageLog load failed:", error);
    $("save-vehicle").disabled = true;
    $("save-maintenance").disabled = true;
  }
}
function showRoute(route) {
  currentRoute = route;
  for (const name of ["vehicles", "add", "detail", "maintenance"]) {
    $("view-" + name).hidden = route !== name;
  }
  const selectedNav = route === "add" ? "add" : "vehicles";
  $("nav-vehicles").classList.toggle("active", selectedNav === "vehicles");
  $("nav-add").classList.toggle("active", selectedNav === "add");
  $("nav-vehicles").setAttribute("aria-current", selectedNav === "vehicles" ? "page" : "false");
  $("nav-add").setAttribute("aria-current", selectedNav === "add" ? "page" : "false");
  if (route === "vehicles") renderVehicles();
  if (route === "detail") renderDetails();
  if (route === "maintenance") renderMaintenanceContext();
  window.scrollTo({ top: 0, behavior: "instant" });
  $("main").focus({ preventScroll: true });
}
function renderVehicles() {
  $("vehicle-count").textContent = prettyMiles(vehicles.length);
  $("service-count").textContent = prettyMiles(
    vehicles.reduce((total, vehicle) => total + vehicle.maintenance.length, 0)
  );
  $("mileage-total").textContent = prettyMiles(
    vehicles.reduce((total, vehicle) => total + vehicle.mileage, 0)
  );
  const term = $("vehicle-search").value.trim().toLowerCase();
  const filtered = vehicles.filter((v) => (`${v.year} ${v.make} ${v.model}`).toLowerCase().includes(term));
  if (!filtered.length) {
    $("vehicle-list").innerHTML = `<div class="empty"><div class="empty-icon" aria-hidden="true">${term ? "⌕" : "+"}</div>
      <h3>${term ? "No matching vehicles" : "Your garage is ready"}</h3>
      <p>${term ? "Try a different search, or clear the search field." : "Add your first vehicle to start tracking maintenance and service history."}</p>
      ${term ? '<button type="button" class="button ghost" id="clear-search">Clear Search</button>' : '<button type="button" class="button primary" id="empty-add">+ Add Your First Vehicle</button>'}</div>`;
    return;
  }
  $("vehicle-list").innerHTML = filtered.map((v) => {
    const lastMaintenance = [...v.maintenance].sort((a, b) =>
      b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
    return `
      <article class="vehicle-card">
        <div class="vehicle-card-banner">
          <div class="vehicle-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 13 1.6-5h10.8l1.6 5v5h-2v-2H7v2H5v-5Z"/><path d="M5 13h14M8 11h.01M16 11h.01"/></svg></div>
          <span class="service-count-badge">${v.maintenance.length} ${v.maintenance.length === 1 ? "record" : "records"}</span>
        </div>
        <div class="vehicle-card-content">
          <h3>${safeText(v.year)} ${safeText(v.make)} ${safeText(v.model)}</h3>
          <div class="vehicle-card-meta"><strong>${prettyMiles(v.mileage)} <span>mi</span></strong>
            <span>Last: ${lastMaintenance ? safeText(lastMaintenance.service) : "No service yet"}</span></div>
          <div class="card-actions"><button type="button" class="small-button secondary" data-open="${safeText(v.id)}">View Details</button>
            <button type="button" class="small-button" data-maintenance="${safeText(v.id)}">+ Add Service</button></div>
        </div>
      </article>`;
  }).join("");
}
function beginAddVehicle() {
  pendingVehicle = null;
  $("vehicle-form").reset();
  $("vehicle-error").hidden = true;
  showVehicleStage("details");
  hideStatus();
  showRoute("add");
  $("vehicle-year").focus();
}
function showVehicleStage(stage) {
  $("vehicle-form").hidden = stage !== "details";
  $("vehicle-review").hidden = stage !== "review";
  $("vehicle-step-1").className = `step ${stage === "details" ? "current" : "done"}`;
  $("vehicle-step-2").className = `step ${stage === "review" ? "current" : ""}`;
}
function showMaintenanceStage(stage) {
  $("maintenance-form").hidden = stage !== "details";
  $("maintenance-review").hidden = stage !== "review";
  $("maintenance-step-1").className = `step ${stage === "details" ? "current" : "done"}`;
  $("maintenance-step-2").className = `step ${stage === "review" ? "current" : ""}`;
}
function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}
function isWholeNumber(value, min, max) {
  return value !== "" && Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
}
function appendReview(targetId, pairs) {
  const target = $(targetId);
  target.replaceChildren();
  for (const [name, value] of pairs) {
    const line = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = name;
    dd.textContent = String(value);
    line.append(dt, dd);
    target.append(line);
  }
}
function reviewVehicle(event) {
  event.preventDefault();
  const v = formValues($("vehicle-form"));
  const maxYear = new Date().getFullYear() + 1;
  if (!isWholeNumber(v.year, 1886, maxYear) || !v.make.trim() || !v.model.trim() ||
      v.make.trim().length > 50 || v.model.trim().length > 50 ||
      !isWholeNumber(v.mileage, 0, 2000000)) {
    $("vehicle-error").textContent = `Enter a valid year (1886–${maxYear}), make, model, and nonnegative whole-number mileage.`;
    $("vehicle-error").hidden = false;
    return;
  }
  $("vehicle-error").hidden = true;
  pendingVehicle = { year: Number(v.year), make: v.make.trim(), model: v.model.trim(), mileage: Number(v.mileage) };
  appendReview("vehicle-review-data", [["Year", pendingVehicle.year], ["Make", pendingVehicle.make],
    ["Model", pendingVehicle.model], ["Current mileage", `${prettyMiles(pendingVehicle.mileage)} mi`]]);
  showVehicleStage("review");
  $("save-vehicle").focus();
}
function saveVehicle() {
  if (!pendingVehicle) return;
  const next = [...vehicles, { ...pendingVehicle, id: newId(), maintenance: [] }];
  if (!commitData(next, "saving the vehicle")) return;
  selectedVehicleId = next[next.length - 1].id;
  pendingVehicle = null;
  showRoute("detail");
  announce("Vehicle saved successfully. You can undo this save using the Undo control below.");
}
function openDetail(id) {
  if (!getVehicle(id)) return announce("That vehicle was not found.", true);
  selectedVehicleId = id;
  hideStatus();
  showRoute("detail");
}
function renderDetails() {
  const vehicle = getVehicle(selectedVehicleId);
  if (!vehicle) { showRoute("vehicles"); return; }
  $("detail-heading").textContent = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  $("detail-subtitle").textContent = "View past services and add a new maintenance record.";
  $("detail-year").textContent = vehicle.year;
  $("detail-mileage").textContent = prettyMiles(vehicle.mileage);
  $("detail-count").textContent = vehicle.maintenance.length;
  if (!vehicle.maintenance.length) {
    $("maintenance-list").innerHTML = `<div class="empty"><div class="empty-icon" aria-hidden="true">≡</div>
      <h3>No maintenance recorded yet</h3><p>Keep your first service record so it's easy to find later.</p>
      <button type="button" class="button primary" id="first-service">+ Record Maintenance</button></div>`;
    return;
  }
  $("maintenance-list").innerHTML = [...vehicle.maintenance].sort((a, b) =>
      b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).map((record) => `
    <article class="history-record"><div><h3>${safeText(record.service)}</h3>
    <p>Service date: ${safeText(readableDate(record.date))}</p>
    ${record.notes ? `<small>Notes: ${safeText(record.notes)}</small>` : ""}</div>
    <span class="history-mileage">${prettyMiles(record.mileage)} mi</span></article>`).join("");
}
function beginMaintenance(id) {
  if (!getVehicle(id)) { announce("Choose a saved vehicle first.", true); return; }
  selectedVehicleId = id;
  pendingMaintenance = null;
  $("maintenance-form").reset();
  $("maintenance-date").value = todayLocal();
  $("maintenance-mileage").value = getVehicle(id).mileage;
  $("maintenance-error").hidden = true;
  showMaintenanceStage("details");
  hideStatus();
  showRoute("maintenance");
  $("maintenance-date").focus();
}
function renderMaintenanceContext() {
  const vehicle = getVehicle(selectedVehicleId);
  if (!vehicle) { showRoute("vehicles"); return; }
  $("maintenance-vehicle-label").textContent = `For ${vehicle.year} ${vehicle.make} ${vehicle.model}`;
}
function reviewMaintenance(event) {
  event.preventDefault();
  const v = formValues($("maintenance-form"));
  const dateIsValid = /^\d{4}-\d{2}-\d{2}$/.test(v.date) && !Number.isNaN(Date.parse(`${v.date}T12:00:00`)) && v.date <= todayLocal();
  if (!dateIsValid || !isWholeNumber(v.mileage, 0, 2000000) || !v.service.trim() ||
      v.service.trim().length > 120 || v.notes.length > 500) {
    $("maintenance-error").textContent = "Enter a past or current service date, a nonnegative whole-number mileage, and a service description.";
    $("maintenance-error").hidden = false;
    return;
  }
  $("maintenance-error").hidden = true;
  pendingMaintenance = { date: v.date, mileage: Number(v.mileage), service: v.service.trim(), notes: v.notes.trim() };
  const vehicle = getVehicle(selectedVehicleId);
  appendReview("maintenance-review-data", [["Vehicle", `${vehicle.year} ${vehicle.make} ${vehicle.model}`],
    ["Service date", readableDate(pendingMaintenance.date)], ["Mileage", `${prettyMiles(pendingMaintenance.mileage)} mi`],
    ["Service performed", pendingMaintenance.service], ["Notes", pendingMaintenance.notes || "None"]]);
  showMaintenanceStage("review");
  $("save-maintenance").focus();
}
function saveMaintenance() {
  const vehicle = getVehicle(selectedVehicleId);
  if (!vehicle || !pendingMaintenance) return;
  const next = vehicles.map((v) => v.id !== selectedVehicleId ? v : {
    ...v, maintenance: [...v.maintenance, { ...pendingMaintenance, id: newId(), createdAt: new Date().toISOString() }]
  });
  if (!commitData(next, "saving the maintenance record")) return;
  pendingMaintenance = null;
  showRoute("detail");
  announce("Maintenance saved successfully under this vehicle. You can undo this save using the Undo control below.");
}

function initialize() {
  $("vehicle-year").max = new Date().getFullYear() + 1;
  $("maintenance-date").max = todayLocal();
  loadData();
  $("nav-vehicles").addEventListener("click", () => { hideStatus(); showRoute("vehicles"); });
  $("nav-add").addEventListener("click", beginAddVehicle);
  $("brand-link").addEventListener("click", (e) => { e.preventDefault(); hideStatus(); showRoute("vehicles"); });
  $("new-vehicle-btn").addEventListener("click", beginAddVehicle);
  $("vehicle-search").addEventListener("input", renderVehicles);
  $("vehicle-list").addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    const maintenance = e.target.closest("[data-maintenance]");
    if (open) openDetail(open.dataset.open);
    else if (maintenance) beginMaintenance(maintenance.dataset.maintenance);
    else if (e.target.closest("#empty-add")) beginAddVehicle();
    else if (e.target.closest("#clear-search")) { $("vehicle-search").value = ""; renderVehicles(); $("vehicle-search").focus(); }
  });
  $("vehicle-form").addEventListener("submit", reviewVehicle);
  $("cancel-vehicle").addEventListener("click", () => { pendingVehicle = null; showRoute("vehicles"); });
  $("edit-vehicle").addEventListener("click", () => { showVehicleStage("details"); $("vehicle-year").focus(); });
  $("save-vehicle").addEventListener("click", saveVehicle);
  $("back-to-vehicles").addEventListener("click", () => { hideStatus(); showRoute("vehicles"); });
  $("detail-add-maintenance").addEventListener("click", () => beginMaintenance(selectedVehicleId));
  $("maintenance-list").addEventListener("click", (e) => { if (e.target.closest("#first-service")) beginMaintenance(selectedVehicleId); });
  $("maintenance-form").addEventListener("submit", reviewMaintenance);
  $("cancel-maintenance").addEventListener("click", () => { pendingMaintenance = null; showRoute("detail"); });
  $("edit-maintenance").addEventListener("click", () => { showMaintenanceStage("details"); $("maintenance-date").focus(); });
  $("save-maintenance").addEventListener("click", saveMaintenance);
  $("undo-btn").addEventListener("click", undo);
  $("redo-btn").addEventListener("click", redo);
  $("nav-vehicles").setAttribute("aria-current", "page");
  updateUndoRedo();
  renderVehicles();
}

document.addEventListener("DOMContentLoaded", initialize);
