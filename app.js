"use strict";

const app = document.querySelector("#app");
const dialog = document.querySelector("#dialog");
const toast = document.querySelector("#toast");
const key = "mranti-buggy-demo-v1";
const legacyStops = ["CUBE Plaza", "HIVE 5", "Innovation Hub"];
const stops = mrantiBuildingStops.map(([name]) => name);
const mapOrigin = "https://app.mappedin.com";
const parkMap = mapOrigin + "/map/686e226a0c030e000b832a48";
const bookingMapQuery = "embedded=true&pitch=0";
const overviewQuery = bookingMapQuery + "&multiFloorView=true";
const mappedStops = new Map(mrantiVenues);
for (const [name, mapName] of mrantiBuildingStops) {
  if (mapName) mappedStops.set(name, mappedStops.get(mapName));
}
const defaultPickup = stops.indexOf("Parking MLP 2");
const boardingWarning = "Board only with the number of passengers on your booking. Extra passengers may delay departure or prevent the buggy from operating.";

function bookingStop(value) {
  return safe(typeof value === "number" ? legacyStops[value] : value);
}

function ticketQr(code) {
  const qr = qrcode(0, "M");
  qr.addData(code);
  qr.make();
  return qr.createImgTag(4, 16, "Boarding QR code for " + code);
}
const fleet = ["BGY-01", "BGY-02", "BGY-03", "BGY-04", "BGY-05"];
const fleetColors = ["#2f17e9", "#007554", "#ae3c08", "#9b2677", "#006998"];
const fleetBatteryLevels = [78, 92, 64, 85, 73];
const fleetStaging = ["Parking MLP 2", "HIVE 4", "Parking MLP 1", "Biotechnology Incubation Centre", "HIVE 8"];
const defaults = {
  paused: false, fare: 3, paid: true, lockedVehicles: [], assignedDrivers: {}, nextCode: 101,
  safetyDrivers: [
    {name:"Wong", contact:"+1 202-555-0147"},
    {name:"Kok", contact:"+1 202-555-0183"},
    {name:"Yeoh", contact:"+1 202-555-0126"},
    {name:"Aniff", contact:"+1 202-555-0169"},
    {name:"Haqim", contact:"+1 202-555-0192"}
  ],
  bookings: [],
  incidents: [{id:1, vehicle:"BGY-01", title:"Temporary obstruction", detail:"HIVE 5 approach · Clearance requested", state:"Open"}],
  activity: [{time:"10:18", description:"Temporary obstruction logged"}, {time:"10:12", description:"BGY-01 began the previous departure"}]
};
let state = structuredClone(defaults);
try { state = JSON.parse(localStorage.getItem(key)) || state; } catch {}
state.lockedVehicles ??= state.ready === false ? [fleet[0]] : [];
state.assignedDrivers ??= {};
state.safetyDrivers ??= structuredClone(defaults.safetyDrivers);
for (const driver of state.safetyDrivers) {
  if (driver.contact) continue;
  const defaultDriver = defaults.safetyDrivers.find(item => item.name === driver.name);
  if (defaultDriver) driver.contact = defaultDriver.contact;
}
for (const incident of state.incidents) {
  if (incident.id === 1) incident.vehicle ??= fleet[0];
}
for (const booking of state.bookings) {
  booking.vehicle ??= state.departures?.find(slot => slot.time === booking.time)?.vehicle ?? fleet[0];
}
let selectedVehicle;
const vehicleCapacity = 4;
let origin = defaultPickup;
let destination = -1;
let seats = 1;
let opsTab = "Overview";
let toastTimer;
let pendingRoute;
let routeTimer;
let mapReady = false;
let mapLoadTimer;

function save() {
  try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
}
const operationTimeFormat = new Intl.DateTimeFormat("en-MY", {
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23", timeZone: "Asia/Kuala_Lumpur"
});
function record(description) {
  const time = operationTimeFormat.format(new Date());
  state.activity.unshift({time, description});
}
function update(message) {
  record(message);
  save();
  render();
  announce(message);
}
function announce(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3700);
}
function safe(text) {
  return String(text).replace(/[&<>"']/g, character => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[character]));
}
function money(value) { return "RM " + Number(value).toFixed(2); }
function vehicleReady(vehicle) { return !state.lockedVehicles.includes(vehicle); }
function vehicleStatusDot(vehicle) {
  const online = vehicleReady(vehicle);
  const label = online ? "Online" : "Offline";
  const color = online ? "#087e4b" : "#c42b3f";
  return '<span role="img" aria-label="'+label+'" title="'+label+'" style="color:'+color+';margin-inline-end:7px">●</span>';
}
function safetyDriverSelect(vehicle) {
  const selected = state.assignedDrivers[vehicle];
  return '<label class="driver-assignment">Assign safety driver<select data-driver-vehicle="'+vehicle+'" aria-label="Assign safety driver for '+vehicle+'">'+
    '<option value="">Unassigned</option>'+
    state.safetyDrivers.map(({name}) => '<option value="'+safe(name)+'"'+(selected === name ? " selected" : "")+'>'+safe(name)+'</option>').join("")+
    '</select></label>';
}
function activeRide(booking) { return booking.status === "Booked" || booking.status === "Checked in"; }
function vehicleBooking(vehicle) {
  return state.bookings.findLast(booking => booking.vehicle === vehicle && booking.status === "Checked in") ??
    state.bookings.findLast(booking => booking.vehicle === vehicle && booking.status === "Booked");
}
function vehicleAvailable(vehicle) {
  return fleet.includes(vehicle) && vehicleReady(vehicle) && !vehicleBooking(vehicle);
}
function vehicleStatus(vehicle) {
  if (!vehicleReady(vehicle)) return "Out of service";
  const booking = vehicleBooking(vehicle);
  if (booking?.status === "Checked in") return "On a ride";
  return booking ? "Reserved" : "Available now";
}
function canBookRide() {
  return !state.paused && vehicleAvailable(selectedVehicle) &&
    origin >= 0 && destination >= 0 && origin !== destination && seats >= 1 && seats <= vehicleCapacity;
}
function vehicleRouteLabel(vehicle) {
  const booking = vehicleBooking(vehicle);
  if (!vehicleReady(vehicle)) return "Out of service";
  if (!booking) return "Idle";
  return bookingStop(booking.origin) + " → " + bookingStop(booking.destination);
}
function sendFleetRoutes(frame) {
  if (frame?.dataset.ready !== "true") return;
  const payload = fleet.map((code, index) => {
    const booking = vehicleReady(code) && vehicleBooking(code);
    return {
      code,
      color: fleetColors[index],
      staging: mappedStops.get(fleetStaging[index]),
      pickup: mappedStops.get(booking?.origin),
      dropOff: mappedStops.get(booking?.destination),
      startedAt: booking?.status === "Checked in" ? booking.startedAt : undefined
    };
  });
  frame.contentWindow.postMessage({ type: "fleet-routes", payload }, location.origin);
}
function bookingsPaused() { return state.paused || !fleet.some(vehicleReady); }
function pill(text, style = "neutral") { return '<span class="pill ' + style + '">' + safe(text) + '</span>'; }
function button(text, action, options = {}) {
  const {id, variant = "", disabled = false, pressed} = options;
  return '<button type="button" class="btn '+ variant +'" data-action="' + action + '"' + (id === undefined ? "" : ' data-id="' + safe(id) + '"') + (disabled ? " disabled" : "") + (pressed === undefined ? "" : ' aria-pressed="'+pressed+'"') + '>' + safe(text) + '</button>';
}
function mapMarkup(id = "") {
  let source = id === "booking-map"
    ? (location.protocol === "file:" ? parkMap : "route-map.html") + "?" + overviewQuery
    : parkMap + "?embedded=true";
  if (id === "fleet-map" && location.protocol !== "file:") {
    source = "route-map.html?" + overviewQuery + "&fleet=true";
  }
  return '<div class="map"><iframe id="' + id + '" title="MRANTI Park interactive map" src="' + safe(source) + '" allow="clipboard-write; web-share" allowfullscreen></iframe></div>';
}

function setRouteStatus(message) {
  document.querySelector("#route-status").textContent = message;
}

function resetRouteRequest() {
  clearTimeout(routeTimer);
  pendingRoute = undefined;
}

function sendRoute(frame) {
  if (!mapReady) return;
  const frameOrigin = new URL(frame.src).origin;
  const payload = pendingRoute
    ? { state: "/directions", departure: pendingRoute.pickup, location: pendingRoute.dropOff }
    : { state: "/" };
  frame.contentWindow.postMessage({ type: "set-state", payload }, frameOrigin);
}

function watchRouteRequest() {
  clearTimeout(routeTimer);
  routeTimer = setTimeout(() => {
    setRouteStatus("The route preview is taking longer than expected.");
  }, 12000);
}

function useHostedMap(frame) {
  clearTimeout(mapLoadTimer);
  mapReady = false;
  frame.src = parkMap + "?" + overviewQuery;
  if (pendingRoute) watchRouteRequest();
}

function previewRoute() {
  resetRouteRequest();
  const frame = document.querySelector("#booking-map");
  const pickup = mappedStops.get(stops[origin]);
  const dropOff = mappedStops.get(stops[destination]);
  if (destination < 0 || origin === destination || !pickup || !dropOff) {
    sendRoute(frame);
    if (destination < 0) {
      setRouteStatus("Choose a drop-off to preview your route.");
    } else if (origin === destination) {
      setRouteStatus("Choose a different pickup and drop-off.");
    } else {
      setRouteStatus("Mappedin has no routing point linked to " +
        [!pickup && stops[origin], !dropOff && stops[destination]].filter(Boolean).join(" or ") + ".");
    }
    return;
  }
  pendingRoute = { pickup, dropOff };
  setRouteStatus("Updating directions…");
  sendRoute(frame);
  watchRouteRequest();
}

function syncRoutePreview() {
  const caption = document.querySelector("#map-trip");
  const frame = document.querySelector("#booking-map");
  const pickup = mappedStops.get(stops[origin]);
  const dropOff = mappedStops.get(stops[destination]);
  const hasRoute = Boolean(pickup && dropOff && origin !== destination);
  frame.parentElement.classList.toggle("show-route", hasRoute);
  caption.textContent = hasRoute
    ? stops[origin] + " → " + stops[destination]
    : "Choose a drop-off to see the route.";
}

window.addEventListener("message", event => {
  const monitor = document.querySelector("#fleet-map");
  if (monitor && event.source === monitor.contentWindow &&
      event.origin === location.origin && new URL(monitor.src).origin === location.origin) {
    if (event.data?.type === "app-loaded") {
      monitor.dataset.ready = "true";
      sendFleetRoutes(monitor);
    } else if (event.data?.type === "route-map-unavailable") {
      monitor.src = parkMap + "?" + bookingMapQuery;
    }
    return;
  }
  const frame = document.querySelector("#booking-map");
  if (!frame || event.source !== frame.contentWindow) return;
  const frameOrigin = new URL(frame.src).origin;
  if (event.origin !== frameOrigin) return;
  const fittedPreview = frameOrigin !== mapOrigin;
  const { type, payload } = event.data ?? {};
  if (fittedPreview && type === "route-map-unavailable") {
    useHostedMap(frame);
    return;
  }
  if (type === "app-loaded") {
    mapReady = true;
    clearTimeout(mapLoadTimer);
    if (pendingRoute) {
      sendRoute(frame);
      watchRouteRequest();
    }
    return;
  }

  if (fittedPreview && (type === "route-preview-ready" || type === "route-preview-unavailable")) {
    if (payload?.pickup !== mappedStops.get(stops[origin]) ||
        payload?.dropOff !== mappedStops.get(stops[destination])) return;
    resetRouteRequest();
    setRouteStatus(type === "route-preview-ready"
      ? "Route preview ready."
      : "The map couldn’t preview this route.");
    return;
  }
  if (type !== "state-changed" || payload?.state !== "/directions" ||
      !Array.isArray(payload.departure) || !Array.isArray(payload.location) ||
      !payload.departure.length || !payload.location.length) return;

  if (pendingRoute) {
    if (!payload.departure.includes(pendingRoute.pickup) ||
        !payload.location.includes(pendingRoute.dropOff)) return;
    if (fittedPreview) return;
    resetRouteRequest();
  }

  const pickup = stops.findIndex(stop => payload.departure.includes(mappedStops.get(stop)));
  const dropOff = stops.findIndex(stop => payload.location.includes(mappedStops.get(stop)));
  if (pickup < 0 || dropOff < 0 || pickup === dropOff) {
    setRouteStatus("Choose two different buggy stops in the booking form to use them for your reservation.");
    return;
  }

  if (pickup !== origin || dropOff !== destination) {
    origin = pickup;
    destination = dropOff;
    render();
    if (fittedPreview) {
      setRouteStatus("Updating directions…");
      return;
    }
  }
  if (!fittedPreview) setRouteStatus("Route preview ready.");
});

const stakeholders = [
  ["Passengers and park visitors", "Book a ride, find the boarding point, check in and receive trip updates.", "CUBE passenger interface for available departures, seat reservations, stop directions, booking confirmation, check-in, service alerts and help requests. Fare payment and refund status when paid booking is activated."],
  ["MRANTI CUBE and service management", "Own the visitor experience, service hours, stops, fares and customer support.", "Book a Buggy in CUBE, with admin controls for timetables, seat availability, service notices and booking policies, plus ridership and revenue reporting."],
  ["MRANTI command centre", "Monitor service, coordinate with UiTM staff and escalate incidents.", "Live dashboard for buggy location, departures, boarding count, readiness, connectivity and alerts. Authorised controls to hold departures and suspend bookings."],
  ["MRANTI emergency response team", "Respond on site, assist passengers and coordinate recovery.", "Incident location, passenger count, responder access point and event timeline. Track acknowledgement, escalation and closure."],
  ["MRANTI IT and data team", "Provide hosting and storage, manage access and set retention policies.", "Data pipeline linking bookings, trip events, vehicle telemetry and incidents to MRANTI storage via a common trip ID."],
  ["HelloWorld Robotics", "Own automated driving, vehicle controls, HD map and fixed-route execution.", "Integrate the agreed vehicle interface for location, readiness, trip status, faults and approved trip requests where supported."],
  ["UiTM safety drivers and maintenance team", "Perform pre-service checks, supervise rides, maintain the buggy and confirm readiness after servicing.", "Pre-service checks, readiness confirmation, defect reporting, maintenance lockout and return-to-service sign-off."],
  ["MRANTI park facilities and security", "Maintain boarding areas and communicate closures, events and access restrictions.", "Show affected stops and departures on the dashboard and update CUBE availability."],
  ["MRANTI finance and payment provider", "Own fare collection, settlement, refunds and payment support.", "Checkout, receipts, refunds and reconciliation when MRANTI activates paid rides."]
];

function renderBooking() {
  const options = (index, placeholder) => '<option value="-1" disabled'+(index < 0 ? ' selected' : '')+'>'+placeholder+'</option>' +
    stops.map((stop, i) => '<option value="'+i+'"'+(i === index ? " selected" : "")+'>'+safe(stop)+'</option>').join("");
  const available = fleet.filter(vehicleAvailable);
  if (!available.includes(selectedVehicle)) selectedVehicle = available[0];
  const tickets = state.bookings.map(booking => {
    const posted = booking.status === "Booked";
    return '<article class="card card-pad stack"><div class="space-between"><span class="ticket-code">'+safe(booking.code)+'</span>'+pill(booking.status,posted ? "good" : "neutral")+'</div><h3>'+safe(booking.vehicle)+' · '+(booking.time ? safe(booking.time)+' · ' : '')+bookingStop(booking.origin)+' to '+bookingStop(booking.destination)+'</h3><p class="sub">'+booking.seats+' seat'+(booking.seats>1?"s":"")+' · '+(booking.total ? money(booking.total) : "Complimentary")+'</p>'+(posted ? '<div class="boarding-pass">'+ticketQr(booking.code)+'<div><h3>Scan at the buggy entrance</h3><p class="sub">Show this QR code to the boarding team.</p></div></div><p class="banner">'+boardingWarning+'</p><div class="actions">'+button("Cancel booking","cancel",{id:booking.code,variant:"small danger"})+'</div>' : '')+(booking.status==="Cancelled" && booking.total ? '<p class="sub">Simulated refund · '+money(booking.total)+'</p>' : '')+'</article>';
  }).join("");
  return '<div class="intro"><div><p class="eyebrow">CUBE Services · L4 Autonomous Buggy</p><h1>Book a Buggy</h1><p class="muted">Get around MRANTI Park with CUBE. Choose your stops and reserve a seat.</p></div><a href="#tickets" class="btn" data-action="tickets">My bookings'+(state.bookings.length ? ' ('+state.bookings.length+')' : '')+'</a></div>'+
  '<div class="booking-grid"><section class="card map-card">'+mapMarkup("booking-map")+'<div class="map-caption"><h2>MRANTI Park Map</h2><p id="map-trip"></p><p class="sub">Park wayfinding preview. The buggy follows its assigned route.</p></div></section>'+
  '<section class="card card-pad" id="ride-plan"><div class="card-head"><div><h2>Plan your ride</h2><p class="sub">On-demand rides</p></div>'+pill(bookingsPaused() ? "Bookings paused" : "Bookings open",bookingsPaused() ? "warn":"good")+'</div>'+
  ((bookingsPaused()) ? '<p class="banner">New bookings are temporarily unavailable.</p>' : '')+
  '<div class="fields"><label>Pickup (boarding stop)<select id="origin">'+options(origin, "Choose a pickup")+'</select></label><label>Drop-off (destination)<select id="destination">'+options(destination, "Choose a drop-off")+'</select></label></div>'+
  '<p id="route-status" class="sub route-status" role="status">Choose a drop-off to preview your route.</p>'+
  '<h3 class="section-label">Buggy availability</h3>'+
  (!available.length && !bookingsPaused() ? '<p class="banner" role="status">All buggies are busy right now.</p>' : '')+
  '<div class="slots">'+fleet.map(vehicle => '<button type="button" class="slot" data-action="select-vehicle" data-id="'+vehicle+'" aria-pressed="'+(selectedVehicle===vehicle)+'" '+(!vehicleAvailable(vehicle) || state.paused ? "disabled" : "")+'><strong>'+vehicle+'</strong><small>'+(state.paused && vehicleAvailable(vehicle) ? "Bookings paused" : vehicleStatus(vehicle))+'</small></button>').join("")+'</div>'+
  '<div class="booking-bottom"><div class="space-between"><strong>Passengers</strong><div class="counter">'+button("−","less",{variant:"small",disabled:seats<=1})+'<strong>'+seats+'</strong>'+button("+","more",{variant:"small",disabled:seats>=vehicleCapacity})+'</div></div>'+
  (origin===destination ? '<p class="sub">Choose a different destination from your boarding stop.</p>' : '')+
  '<div class="space-between"><span class="sub">'+(state.paid ? money(state.fare)+' per seat' : "Complimentary ride")+'</span><strong>'+money(seats*(state.paid ? state.fare : 0))+'</strong></div>'+button("Review booking","review",{variant:"primary full",disabled:!canBookRide()})+'</div></section></div>'+
  '<section class="divider" id="tickets" tabindex="-1"><h2>My bookings</h2>'+(tickets ? '<div class="tickets">'+tickets+'</div>' : '<p class="empty">Your booking and check-in code will appear here.</p>')+'</section>';
}

const rideTimeOptions = {
  day: "numeric", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Kuala_Lumpur"
};
const rideTimeFormat = new Intl.DateTimeFormat("en-MY", rideTimeOptions);
const recordRideTimeFormat = new Intl.DateTimeFormat("en-MY", { ...rideTimeOptions, second: "2-digit" });
const rideTimeHeaders = '<th class="nowrap">Time booked</th><th class="nowrap">Time start</th><th class="nowrap">Time end</th>';

function rideTimeCell(value, formatter = rideTimeFormat) {
  return '<td class="nowrap">'+(value
    ? '<time datetime="'+safe(value)+'">'+safe(formatter.format(new Date(value)))+'</time>'
    : '—')+'</td>';
}

function rideTimeCells(booking) {
  return [booking.bookedAt, booking.startedAt, booking.endedAt].map(value => rideTimeCell(value, recordRideTimeFormat)).join("");
}

function formatRideDuration(start, end) {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes + "m " + String(seconds % 60).padStart(2, "0") + "s";
}

function rideDurationCell(start, end, running, now) {
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : running ? now : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return '<td class="nowrap">—</td>';
  const timer = running && !end ? ' data-ride-timer="'+from+'"' : '';
  return '<td class="nowrap"'+timer+'>'+formatRideDuration(from, to)+'</td>';
}

function rideTable() {
  const rides = state.bookings.filter(activeRide);
  const now = Date.now();
  const rows = rides.map(booking => '<tr><td class="ticket-code">'+safe(booking.code)+'</td><td>'+safe(booking.vehicle)+'</td><td>'+bookingStop(booking.origin)+' → '+bookingStop(booking.destination)+'</td><td>'+booking.seats+'</td>'+
    rideTimeCell(booking.bookedAt)+
    rideDurationCell(booking.bookedAt, booking.startedAt, booking.status === "Booked", now)+
    rideDurationCell(booking.startedAt, booking.endedAt, booking.status === "Checked in", now)+
    '<td>'+pill(booking.status,"good")+'</td><td><div class="actions">'+
    button("Contact driver","contact-ride-driver",{id:booking.code,variant:"small nowrap"})+
    (booking.status === "Checked in" ? button("Complete ride","complete-ride",{id:booking.code,variant:"small nowrap"}) : '')+'</div></td></tr>').join("");
  return '<section class="card table-card"><div class="card-head"><h2>Active rides</h2></div>'+
    (rows ? '<div class="table-scroll"><table><thead><tr><th>Booking</th><th>Vehicle</th><th>Route</th><th>Passengers</th><th class="nowrap">Time booked</th><th class="nowrap">Wait time</th><th class="nowrap">Trip time</th><th>Status</th><th>Action</th></tr></thead><tbody>'+rows+'</tbody></table></div>' : '<p class="empty">No active rides.</p>')+'</section>';
}

function renderOverview() {
  const booked = state.bookings.filter(activeRide).reduce((sum, booking) => sum + booking.seats, 0);
  const alerts = state.incidents.filter(item=>item.state !== "Resolved").length;
  const stat = (label,value,note) => '<section class="card stat"><span class="sub">'+label+'</span><b>'+value+'</b><span class="sub">'+note+'</span></section>';
  const readyCount = fleet.filter(vehicleReady).length;
  return '<div class="stats">'+stat("Fleet", fleet.length + " buggies", readyCount + " ready · HelloWorld Robotics")+stat("Available now",state.paused ? 0 : fleet.filter(vehicleAvailable).length,"Ready for on-demand rides")+stat("Seats reserved",booked,"Active rides")+stat("Open incidents",alerts,"MRANTI response")+'</div>'+
  '<div class="ops-grid"><section class="card map-card"><div class="card-head map-head"><div><h2>Route monitor</h2><p class="sub">Routes by booking · Simulated positions</p></div>'+pill(readyCount ? "Telemetry online" : "Out of service",readyCount ? "good" : "warn")+'</div>'+mapMarkup("fleet-map")+'</section>'+
  '<section class="card card-pad"><div class="card-head"><div><h2>Vehicles and alerts</h2><p class="sub">UiTM operations</p></div></div><ul class="fleet-list">'+fleet.map((vehicle, index) => '<li class="space-between"><div><strong class="fleet-code" style="color:'+fleetColors[index]+'">'+
    vehicleStatusDot(vehicle)+vehicle+'</strong><p class="sub">'+vehicleRouteLabel(vehicle)+'</p></div><div class="metric-line">'+pill(vehicleStatus(vehicle), vehicleAvailable(vehicle) ? "good" : "warn")+pill("Battery " + fleetBatteryLevels[index] + "%")+(state.assignedDrivers[vehicle] ? pill("Driver: " + state.assignedDrivers[vehicle]) : '')+'</div></li>').join("")+'</ul>'+
  '<div class="divider"><h3>Incidents</h3>'+state.incidents.map(item=>'<div class="incident-row"><div class="space-between"><strong>'+safe(item.title)+'</strong>'+pill(item.state,item.state==="Resolved"?"good":"warn")+'</div><p class="sub">'+safe(item.detail)+'</p>'+(item.state==="Resolved" ? '' :
    '<div class="actions incident-actions">'+
    button("Contact Response Team","contact-response",{id:item.id,variant:"small"})+
    button(item.state==="Open" ? "Acknowledge" : "Resolve","incident",{id:item.id,variant:"small incident-status-action"})+'</div>')+'</div>').join("")+'</div></section></div>'+rideTable();
}

function renderAdmin() {
  return '<div class="stack"><section class="card card-pad stack"><h2>Service settings</h2><form id="fare-form" class="stack"><div class="fields"><label>Booking mode<select name="mode"><option value="paid" '+(state.paid?"selected":"")+'>Paid simulation</option><option value="free" '+(!state.paid?"selected":"")+'>Complimentary</option></select></label><label>Fare per seat (RM)<input name="fare" type="number" min="0" max="999" step=".01" required value="'+state.fare.toFixed(2)+'"></label></div><div><button class="btn primary" type="submit">Save settings</button></div></form><div class="divider space-between"><div><h3>Online bookings</h3><p class="sub">Applies to new reservations in CUBE.</p></div>'+button(state.paused?"Resume bookings":"Pause bookings","pause",{variant:"small"})+'</div><div class="divider"><h3>Vehicle readiness</h3><ul class="fleet-list">'+fleet.map((vehicle, index) => '<li class="space-between vehicle-settings"><div><strong>'+vehicle+'</strong><p class="sub">Battery '+fleetBatteryLevels[index]+'%</p></div>'+safetyDriverSelect(vehicle)+'<div class="actions vehicle-actions">'+button("Alert Driver to Charge/Swap Battery", "battery-alert", {id:vehicle,variant:"small"})+button(vehicleReady(vehicle) ? "Lock out" : "Mark ready", "readiness", {id:vehicle,variant:"small"})+'</div></li>').join("")+'</ul></div></section>'+
  '<section class="card card-pad stack"><h2>Safety driver</h2>'+
    '<form id="safety-driver-form" class="stack"><div class="fields">'+
      '<label>Name<input name="name" autocomplete="off" maxlength="80" required></label>'+
      '<label>Contact<input name="contact" autocomplete="off" maxlength="120" required></label>'+
    '</div><div><button class="btn primary" type="submit">Add driver</button></div></form>'+
    '<ul class="fleet-list">'+state.safetyDrivers.map(({name, contact}) =>
      '<li class="space-between"><strong>'+safe(name)+'</strong><span class="sub">'+safe(contact || "—")+'</span></li>'
    ).join("")+'</ul></section>'+
  '<section class="card card-pad stack"><h2>Demo state</h2><p class="sub">Restore the default settings and clear the demo rides.</p><div>'+button("Reset demo","reset",{variant:"small danger"})+'</div></section></div>';
}

function renderEntrance() {
  return '<section class="card card-pad stack"><div><h2>Buggy entrance</h2><p class="sub">Simulate a decoded QR scan using the ticket’s booking code.</p></div><form id="entrance-form" class="stack"><div class="fields"><label>Booking code<input name="code" placeholder="CUBE-101" required></label><label>Passengers at entrance<input name="headcount" type="number" min="1" step="1" value="1" required></label></div><button class="btn primary" type="submit">Simulate scan</button><p role="status" class="sub" id="entrance-result"></p></form></section>';
}

function operationLogTime(item) {
  if (!/^\d{2}:\d{2}$/.test(item.time)) return item.time;
  const event = item.description.match(/^(Booking confirmed|QR check-in accepted|Ride completed) · (CUBE-\d+)(?: · \d+ passengers?)?$/);
  if (!event) return item.time;
  const [, action, code] = event;
  const booking = state.bookings.find(item => item.code === code);
  const field = { "Booking confirmed": "bookedAt", "QR check-in accepted": "startedAt", "Ride completed": "endedAt" }[action];
  const timestamp = Date.parse(booking?.[field]);
  if (!Number.isFinite(timestamp)) return item.time;
  const time = operationTimeFormat.format(timestamp);
  return time.startsWith(item.time + ":") ? time : item.time;
}

function renderRecords() {
  return '<div class="stack"><section class="card table-card"><div class="card-head"><div><h2>Trips Booked</h2><p class="sub">Reservations created in this simulation</p></div></div>'+
  (state.bookings.length ? '<div class="table-scroll"><table><thead><tr><th>Reference</th><th>Vehicle</th><th>Seats</th>'+rideTimeHeaders+'<th>Status</th></tr></thead><tbody>'+
    state.bookings.map(item=>'<tr><td class="ticket-code">'+safe(item.code)+'</td><td>'+safe(item.vehicle)+'</td><td>'+item.seats+'</td>'+
      rideTimeCells(item)+'<td>'+pill(item.status,item.status==="Cancelled"?"neutral":"good")+'</td></tr>').join("")+
    '</tbody></table></div>' : '<p class="empty">Book a ride in CUBE to populate the manifest.</p>')+
  '</section><section class="card table-card"><div class="card-head"><div><h2>Operations log</h2><p class="sub">Simulated records for the MRANTI data pipeline</p></div></div>'+state.activity.slice(0,15).map(item=>'<div class="incident-row"><div class="space-between"><span>'+safe(item.description)+'</span><time class="sub nowrap">'+safe(operationLogTime(item))+'</time></div></div>').join("")+'</section></div>';
}

function renderCommand() {
  return '<div class="intro compact"><div><p class="eyebrow">CUBE · MRANTI Park Operations</p><h1>Command Centre</h1><p class="muted">Fleet monitoring, incident response and service administration.</p></div>'+pill(bookingsPaused() ? "Bookings paused" : "Service open",bookingsPaused() ? "warn" : "good")+'</div>'+
  '<div class="tabs" aria-label="Command centre sections">'+["Overview","Admin","Entrance","Records"].map(tab=>'<button data-action="tab" data-id="'+tab+'" aria-pressed="'+(tab===opsTab)+'">'+tab+'</button>').join("")+'</div>'+
  '<div id="command-overview"'+(opsTab === "Overview" ? "" : " hidden")+'>'+renderOverview()+'</div>'+
  '<div id="command-tab">'+(opsTab === "Overview" ? "" : ({Admin:renderAdmin,Entrance:renderEntrance,Records:renderRecords}[opsTab])())+'</div>';
}

function renderStakeholders() {
  return '<div class="intro compact"><div><p class="eyebrow">CUBE · Project Scope</p><h1>Stakeholders</h1><p class="muted">Service responsibilities and the Kommu platform scope.</p></div></div><section class="card table-card stakeholders"><div class="table-scroll"><table><thead><tr><th>Stakeholder</th><th>Role in the service</th><th>Platform scope</th></tr></thead><tbody>'+stakeholders.map(row=>'<tr>'+row.map((cell,i)=>'<td>'+(i===0?'<strong>':'')+safe(cell)+(i===0?'</strong>':'')+'</td>').join("")+'</tr>').join("")+'</tbody></table></div></section>';
}

function render() {
  const view=location.hash.slice(1);
  const active=["command","stakeholders"].includes(view)?view:"booking";
  document.title = "CUBE - " + {booking:"Buggy Booking", command:"Command Centre", stakeholders:"Stakeholders"}[active];
  for (const link of document.querySelectorAll("[data-view]")) {
    if (link.dataset.view===active) link.setAttribute("aria-current","page");
    else link.removeAttribute("aria-current");
  }
  const markup = ({booking:renderBooking,command:renderCommand,stakeholders:renderStakeholders}[active])();
  const keepMap = active === "booking" && app.querySelector("#booking-map");
  const overview = active === "command" && app.querySelector("#command-overview");
  if (keepMap || overview) {
    // Replace dashboard content without detaching either map iframe.
    const next = document.createElement("template");
    next.innerHTML = markup;
    let selectors;
    if (keepMap) {
      next.content.querySelector("#route-status").textContent =
        app.querySelector("#route-status").textContent;
      selectors = [".intro", "#ride-plan", "#tickets"];
    } else {
      overview.hidden = opsTab !== "Overview";
      selectors = [".intro", ".tabs", "#command-tab", "#command-overview > .stats",
        "#command-overview > .table-card", ".ops-grid .map-head", ".ops-grid > .card-pad"];
    }
    for (const selector of selectors) {
      app.querySelector(selector).replaceWith(next.content.querySelector(selector));
    }
  } else {
    resetRouteRequest();
    clearTimeout(mapLoadTimer);
    mapReady = false;
    app.innerHTML = markup;
  }
  if (active === "booking") {
    syncRoutePreview();
    if (!keepMap) {
      const frame = app.querySelector("#booking-map");
      if (new URL(frame.src).origin !== mapOrigin) {
        mapLoadTimer = setTimeout(() => useHostedMap(frame), 12000);
      }
      if (destination >= 0) previewRoute();
    }
  }
  if (active === "command") sendFleetRoutes(app.querySelector("#fleet-map"));
}
function confirmAction(title, message, label, action, id) {
  dialog.innerHTML='<div class="stack"><h2 id="dialog-title">'+safe(title)+'</h2><p class="muted">'+safe(message)+'</p><div class="actions">'+button("Back","dismiss")+button(label,action,{variant:"primary",id})+'</div></div>';
  dialog.showModal();
}

function contactSafetyDriver(vehicle, reference) {
  const driver = state.assignedDrivers[vehicle];
  if (!driver) {
    announce("Assign a safety driver in Admin before contacting them.");
    return;
  }
  update("Simulated contact with " + driver + " · " + vehicle + " · " + reference);
}

document.addEventListener("click", event => {
  const target=event.target.closest("[data-action]");
  if (!target) return;
  const {action,id}=target.dataset;
  const booking=state.bookings.find(item=>item.code===id);
  switch (action) {
    case "tickets":
      event.preventDefault();
      document.querySelector("#tickets").scrollIntoView({behavior:"smooth"});
      document.querySelector("#tickets").focus({preventScroll:true});
      break;
    case "select-vehicle": if (!state.paused && vehicleAvailable(id)) { selectedVehicle=id; render(); } break;
    case "less": seats--; render(); break;
    case "more": if (seats < vehicleCapacity) { seats++; render(); } break;
    case "review":
      if (!canBookRide()) break;
      confirmAction("Review your ride", stops[origin]+" to "+stops[destination]+" · "+selectedVehicle+" · Ride now · "+seats+" seat"+(seats>1?"s":"")+". "+(state.paid?"Simulated total "+money(seats*state.fare)+". No payment is collected.":"Complimentary ride."), "Confirm reservation", "book", selectedVehicle);
      break;
    case "book": {
      dialog.close();
      if (id !== selectedVehicle || !canBookRide()) { announce("That buggy is unavailable."); break; }
      const code="CUBE-"+state.nextCode++;
      state.bookings.unshift({code,vehicle:id,origin:stops[origin],destination:stops[destination],seats,total:state.paid ? seats*state.fare : 0,status:"Booked",bookedAt:new Date().toISOString()});
      seats=1;
      update("Booking confirmed · "+code);
      document.querySelector("#tickets").scrollIntoView({behavior:"smooth"});
      break;
    }
    case "cancel":
      if (booking?.status==="Booked") confirmAction("Cancel booking", "Release your reservation for "+booking.vehicle+"?", "Cancel booking", "confirm-cancel", id);
      break;
    case "confirm-cancel":
      dialog.close();
      if (booking?.status==="Booked") { booking.status="Cancelled"; update("Booking cancelled · "+id); }
      break;
    case "tab": opsTab=id; render(); break;
    case "contact-ride-driver":
      if (booking && activeRide(booking)) contactSafetyDriver(booking.vehicle, booking.code);
      break;
    case "complete-ride":
      if (booking?.status === "Checked in") {
        booking.status = "Completed";
        booking.endedAt = new Date().toISOString();
        update("Ride completed · " + booking.code);
      }
      break;
    case "contact-response":
    case "incident": {
      const incident=state.incidents.find(item=>String(item.id)===id);
      if (!incident || incident.state==="Resolved") break;
      if (action === "contact-response") {
        update("Simulated contact with the response team · " + incident.title);
        break;
      }
      incident.state=incident.state==="Open"?"Acknowledged":"Resolved";
      update(incident.title+" · "+incident.state.toLowerCase());
      break;
    }
    case "pause": state.paused=!state.paused; update(state.paused?"New bookings paused":"Bookings resumed"); break;
    case "battery-alert": {
      if (!fleet.includes(id)) break;
      const driver = state.assignedDrivers[id];
      if (!driver) {
        announce("Assign a safety driver to " + id + " before sending a battery alert.");
        break;
      }
      update("Simulated battery alert to " + driver + " · " + id + " · Charge or swap battery");
      break;
    }
    case "readiness":
      if (!fleet.includes(id)) break;
      if (vehicleReady(id)) {
        state.lockedVehicles.push(id);
        update(id + " placed in maintenance lockout");
      } else {
        state.lockedVehicles = state.lockedVehicles.filter(vehicle => vehicle !== id);
        update(id + " marked ready");
      }
      break;
    case "reset": confirmAction("Reset demonstration", "Restore the original settings and clear the demo bookings?", "Reset demo", "confirm-reset"); break;
    case "confirm-reset":
      dialog.close(); state=structuredClone(defaults); selectedVehicle=undefined; seats=1; origin=defaultPickup; destination=-1; save(); render(); announce("Demo reset");
      break;
    case "dismiss": dialog.close(); break;
  }
});
document.addEventListener("change", event => {
  const { id, value, dataset } = event.target;
  const vehicle = dataset.driverVehicle;
  if (fleet.includes(vehicle)) {
    if (state.safetyDrivers.some(driver => driver.name === value)) {
      state.assignedDrivers[vehicle] = value;
      update(vehicle + " safety driver assigned · " + value);
    } else if (value === "") {
      delete state.assignedDrivers[vehicle];
      update(vehicle + " safety driver unassigned");
    }
    document.querySelector('[data-driver-vehicle="'+vehicle+'"]')?.focus();
    return;
  }
  if (id !== "origin" && id !== "destination") return;
  if (id === "origin") origin = Number(value);
  else destination = Number(value);
  render();
  document.getElementById(id).focus({ preventScroll: true });
  previewRoute();
});
document.addEventListener("submit", event => {
  const form=event.target;
  const values=new FormData(form);
  event.preventDefault();
  if (form.id === "entrance-form") {
    const code = String(values.get("code")).trim().toUpperCase();
    const headcount = Number(values.get("headcount"));
    const booking = state.bookings.find(item => item.code === code);
    const result = document.querySelector("#entrance-result");
    if (!booking || booking.status !== "Booked") {
      result.textContent = "This booking code is missing, cancelled or already checked in.";
      return;
    }
    if (!vehicleReady(booking.vehicle) || vehicleBooking(booking.vehicle) !== booking) {
      result.textContent = "Boarding is on hold for this buggy.";
      return;
    }
    if (headcount !== booking.seats) {
      result.textContent = headcount > booking.seats
        ? boardingWarning
        : "The passenger count must match the booking before check-in.";
      return;
    }
    booking.status = "Checked in";
    booking.startedAt = new Date().toISOString();
    update("QR check-in accepted · " + booking.code + " · " + headcount + " passengers");
    document.querySelector("#entrance-result").textContent = "Boarding check-in accepted for " + booking.code + ".";
    return;
  }
  if (form.id==="fare-form") {
    state.fare=Number(values.get("fare"));
    state.paid=values.get("mode")==="paid";
    update("Service settings saved");
  }
  if (form.id === "safety-driver-form") {
    const name = String(values.get("name") ?? "").trim();
    const contact = String(values.get("contact") ?? "").trim();
    if (!name || !contact || name.length > 80 || contact.length > 120) {
      announce("Enter a name and contact for the safety driver.");
      return;
    }
    if (state.safetyDrivers.some(driver => driver.name.toLowerCase() === name.toLowerCase())) {
      announce("A safety driver with that name already exists.");
      return;
    }
    state.safetyDrivers.push({name, contact});
    update("Safety driver added · " + name);
    document.querySelector('#safety-driver-form [name="name"]')?.focus();
  }

});
window.addEventListener("hashchange",()=>{ render(); window.scrollTo(0,0); });
render();
setInterval(() => {
  if (location.hash !== "#command" || opsTab !== "Overview") return;
  const now = Date.now();
  for (const cell of app.querySelectorAll("[data-ride-timer]")) {
    cell.textContent = formatRideDuration(Number(cell.dataset.rideTimer), now);
  }
}, 1000);
