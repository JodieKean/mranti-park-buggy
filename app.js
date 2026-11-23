"use strict";

const app = document.querySelector("#app");
const dialog = document.querySelector("#dialog");
const toast = document.querySelector("#toast");
const key = "mranti-buggy-demo-v1";
const legacyStops = ["CUBE Plaza", "HIVE 5", "Innovation Hub"];
const stops = [
  "Parking MLP 2", "JOM! Technoflex", "Common Area", "HIVE 2", "HIVE 3 & 4",
  "HIVE 6", "ZUS Coffee", "Exzellent Profis Sdn Bhd", "Magna Mission Sdn Bhd",
  "IMU University – Technology Park Campus", "Bridge Data Centres Malaysia II Sdn. Bhd."
];
const parkMap = "https://app.mappedin.com/map/686e226a0c030e000b832a48";
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
const defaults = {
  paused: false, fare: 3, paid: true, ready: true, nextCode: 101,
  departures: [
    {time:"10:30", capacity:4, occupied:2, status:"Open"},
    {time:"10:45", capacity:4, occupied:0, status:"Open"},
    {time:"11:00", capacity:4, occupied:1, status:"Open"},
    {time:"11:15", capacity:4, occupied:4, status:"Open"},
    {time:"11:30", capacity:4, occupied:0, status:"Open"},
    {time:"11:45", capacity:4, occupied:0, status:"Open"}
  ],
  bookings: [],
  incidents: [{id:1, title:"Temporary obstruction", detail:"HIVE 5 approach · Clearance requested", state:"Open"}],
  activity: [{time:"10:18", description:"Temporary obstruction logged"}, {time:"10:12", description:"BGY-01 began the previous departure"}]
};
let state = structuredClone(defaults);
try { state = JSON.parse(localStorage.getItem(key)) || state; } catch {}
let selectedTime = state.departures.find(slot => slot.status === "Open" && remaining(slot) > 0)?.time;
let origin = 0;
let destination = 2;
let seats = 1;
let opsTab = "Overview";
let toastTimer;

function save() {
  try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
}
function record(description) {
  const time = new Intl.DateTimeFormat("en-MY", {hour:"2-digit", minute:"2-digit", hourCycle:"h23", timeZone:"Asia/Kuala_Lumpur"}).format(new Date());
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
function tally(time) {
  return state.bookings.filter(booking => booking.time === time && booking.status !== "Cancelled").reduce((sum, booking) => sum + booking.seats, 0);
}
function remaining(slot) { return slot.capacity - slot.occupied - tally(slot.time); }
function pill(text, style = "neutral") { return '<span class="pill ' + style + '">' + safe(text) + '</span>'; }
function button(text, action, options = {}) {
  const {id, variant = "", disabled = false, pressed} = options;
  return '<button type="button" class="btn '+ variant +'" data-action="' + action + '"' + (id === undefined ? "" : ' data-id="' + safe(id) + '"') + (disabled ? " disabled" : "") + (pressed === undefined ? "" : ' aria-pressed="'+pressed+'"') + '>' + safe(text) + '</button>';
}
function mapMarkup() {
  return '<div class="map"><iframe title="MRANTI Park interactive map" src="' + parkMap + '?embedded=true" allow="clipboard-write; web-share" allowfullscreen></iframe></div>';
}

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
  const options = index => stops.map((stop, i) => '<option value="'+i+'"'+(i === index ? " selected" : "")+'>'+safe(stop)+'</option>').join("");
  const slot = state.departures.find(item => item.time === selectedTime);
  const valid = slot && slot.status === "Open" && remaining(slot) >= seats && origin !== destination && !state.paused && state.ready;
  const tickets = state.bookings.map(booking => {
    const posted = booking.status === "Booked";
    return '<article class="card card-pad stack"><div class="space-between"><span class="ticket-code">'+safe(booking.code)+'</span>'+pill(booking.status,posted ? "good" : "neutral")+'</div><h3>'+safe(booking.time)+' · '+bookingStop(booking.origin)+' to '+bookingStop(booking.destination)+'</h3><p class="sub">'+booking.seats+' seat'+(booking.seats>1?"s":"")+' · '+(booking.total ? money(booking.total) : "Complimentary")+'</p>'+(posted ? '<div class="boarding-pass">'+ticketQr(booking.code)+'<div><h3>Scan at the buggy entrance</h3><p class="sub">Show this QR code to the boarding team.</p></div></div><p class="banner">'+boardingWarning+'</p><div class="actions">'+button("Cancel booking","cancel",{id:booking.code,variant:"small danger"})+'</div>' : '')+(booking.status==="Cancelled" && booking.total ? '<p class="sub">Simulated refund · '+money(booking.total)+'</p>' : '')+'</article>';
  }).join("");
  return '<div class="intro"><div><p class="eyebrow">CUBE Services · Navigation</p><h1>Book a Buggy</h1><p class="muted">Get around MRANTI Park with CUBE. Choose your stops and reserve a seat.</p></div><a href="#tickets" class="btn" data-action="tickets">My bookings'+(state.bookings.length ? ' ('+state.bookings.length+')' : '')+'</a></div>'+
  '<div class="booking-grid"><section class="card map-card">'+mapMarkup()+'<div class="map-caption space-between"><div><h2>MRANTI Park Map</h2><p class="sub">Boarding locations are for demonstration.</p></div><a class="btn small" href="'+parkMap+'" target="_blank" rel="noopener">Open map</a></div></section>'+
  '<section class="card card-pad"><div class="card-head"><div><h2>Plan your ride</h2><p class="sub">Demo timetable · 23 Nov 2026 · MYT</p></div>'+pill(state.paused || !state.ready ? "Bookings paused" : "Bookings open",state.paused || !state.ready ? "warn":"good")+'</div>'+
  ((state.paused || !state.ready) ? '<p class="banner">New bookings are temporarily unavailable.</p>' : '')+
  '<div class="fields"><label>Boarding stop<select id="origin">'+options(origin)+'</select></label><label>Destination<select id="destination">'+options(destination)+'</select></label></div>'+
  '<span class="section-label">Departure time</span><div class="slots">'+state.departures.map(item=>'<button type="button" class="slot" data-action="slot" data-id="'+safe(item.time)+'" aria-pressed="'+(selectedTime===item.time)+'" '+(item.status!=="Open" || remaining(item)<1 || state.paused || !state.ready ? "disabled" : "")+'><strong>'+safe(item.time)+'</strong><small>'+(item.status!=="Open" ? item.status : remaining(item) ? remaining(item)+' seats left' : 'Full')+'</small></button>').join("")+'</div>'+
  '<div class="booking-bottom"><div class="space-between"><strong>Passengers</strong><div class="counter">'+button("−","less",{variant:"small",disabled:seats<=1})+'<strong>'+seats+'</strong>'+button("+","more",{variant:"small",disabled:seats>=Math.max(1,slot ? remaining(slot) : 1)})+'</div></div>'+
  (origin===destination ? '<p class="sub">Choose a different destination from your boarding stop.</p>' : '')+
  '<div class="space-between"><span class="sub">'+(state.paid ? money(state.fare)+' per seat' : "Complimentary ride")+'</span><strong>'+money(seats*(state.paid ? state.fare : 0))+'</strong></div>'+button("Review booking","review",{variant:"primary full",disabled:!valid})+'</div></section></div>'+
  '<section class="divider" id="tickets" tabindex="-1"><h2>My bookings</h2>'+(tickets ? '<div class="tickets">'+tickets+'</div>' : '<p class="empty">Your booking and check-in code will appear here.</p>')+'</section>';
}

function departureTable(admin = false) {
  return '<section class="card table-card"><div class="card-head"><div><h2>Departure schedule</h2><p class="sub">MRANTI Park Loop · 23 Nov · MYT</p></div></div><div class="table-scroll"><table><thead><tr><th>Departure</th><th>Vehicle</th><th>Seats booked</th><th>Status</th><th>Action</th></tr></thead><tbody>'+
  state.departures.map(slot=>'<tr><td><strong>'+safe(slot.time)+'</strong></td><td>BGY-01</td><td>'+(slot.occupied+tally(slot.time))+' / '+slot.capacity+'</td><td>'+pill(slot.status === "Open" && !remaining(slot) ? "Full" : slot.status,slot.status === "Open" ? "good" : "warn")+'</td><td><div class="actions">'+button(slot.status==="Held"?"Release":"Hold", "hold", {id:slot.time,variant:"small",disabled:slot.status==="Cancelled"})+
  (admin ? button("Cancel", "cancel-slot",{id:slot.time,variant:"small danger",disabled:slot.status==="Cancelled"}) : '')+'</div></td></tr>').join("")+'</tbody></table></div></section>';
}

function renderOverview() {
  const booked = state.departures.reduce((sum, slot) => slot.status === "Cancelled" ? sum : sum + slot.occupied + tally(slot.time), 0);
  const alerts = state.incidents.filter(item=>item.state !== "Resolved").length;
  const stat = (label,value,note) => '<section class="card stat"><span class="sub">'+label+'</span><b>'+value+'</b><span class="sub">'+note+'</span></section>';
  return '<div class="stats">'+stat("Fleet", "1 buggy", "BGY-01 · HelloWorld Robotics")+stat("Upcoming departures",state.departures.filter(slot=>slot.status==="Open").length,"Open slots")+stat("Seats reserved",booked,"Demo timetable")+stat("Open incidents",alerts,"MRANTI response")+'</div>'+
  '<div class="ops-grid"><section class="card map-card"><div class="card-head map-head"><div><h2>Route monitor</h2><p class="sub">MRANTI Park Loop</p></div>'+pill(state.ready?"Telemetry online":"Out of service",state.ready?"good":"warn")+'</div>'+mapMarkup()+'</section>'+
  '<section class="card card-pad"><div class="card-head"><div><h2>Vehicle and alerts</h2><p class="sub">BGY-01 · UiTM operations</p></div></div><div class="metric-line">'+pill(state.ready?"Ready":"Maintenance lockout",state.ready?"good":"warn")+pill("Battery 78%")+pill("Safety driver assigned")+'</div>'+
  '<div class="divider"><h3>Incidents</h3>'+state.incidents.map(item=>'<div class="incident-row"><div class="space-between"><strong>'+safe(item.title)+'</strong>'+pill(item.state,item.state==="Resolved"?"good":"warn")+'</div><p class="sub">'+safe(item.detail)+'</p><div class="actions">'+(item.state==="Resolved"?"":button(item.state==="Open"?"Acknowledge":"Resolve","incident",{id:item.id,variant:"small"}))+'</div></div>').join("")+'</div></section></div>'+departureTable();
}

function renderAdmin() {
  return '<div class="admin-grid"><section class="card card-pad stack"><h2>Service settings</h2><form id="fare-form" class="stack"><div class="fields"><label>Booking mode<select name="mode"><option value="paid" '+(state.paid?"selected":"")+'>Paid simulation</option><option value="free" '+(!state.paid?"selected":"")+'>Complimentary</option></select></label><label>Fare per seat (RM)<input name="fare" type="number" min="0" max="999" step=".01" required value="'+state.fare.toFixed(2)+'"></label></div><div><button class="btn primary" type="submit">Save settings</button></div></form><div class="divider space-between"><div><h3>Online bookings</h3><p class="sub">Applies to new reservations in CUBE.</p></div>'+button(state.paused?"Resume bookings":"Pause bookings","pause",{variant:"small"})+'</div><div class="space-between"><div><h3>Vehicle readiness</h3><p class="sub">Simulate UiTM maintenance status.</p></div>'+button(state.ready?"Lock out buggy":"Mark ready","readiness",{variant:"small"})+'</div></section>'+
  '<section class="card card-pad stack"><h2>Add a departure</h2><p class="sub">MRANTI Park Loop · 23 Nov · MYT</p><form id="departure-form" class="stack"><div class="fields"><label>Departure time<input type="time" name="time" required></label><label>Sellable seats<input type="number" name="capacity" min="1" max="6" value="4" required></label></div><div><button class="btn primary" type="submit">Add departure</button></div></form><div class="divider space-between"><div><h3>Demo state</h3><p class="sub">Restore the original schedule and records.</p></div>'+button("Reset demo","reset",{variant:"small danger"})+'</div></section></div>'+departureTable(true);
}

function renderEntrance() {
  return '<section class="card card-pad stack"><div><h2>Buggy entrance</h2><p class="sub">Simulate a decoded QR scan using the ticket’s booking code.</p></div><form id="entrance-form" class="stack"><div class="fields"><label>Booking code<input name="code" placeholder="CUBE-101" required></label><label>Passengers at entrance<input name="headcount" type="number" min="1" step="1" value="1" required></label></div><button class="btn primary" type="submit">Simulate scan</button><p role="status" class="sub" id="entrance-result"></p></form></section>';
}

function renderRecords() {
  return '<div class="admin-grid"><section class="card table-card"><div class="card-head"><div><h2>Passenger manifest</h2><p class="sub">Reservations created in this simulation</p></div></div>'+
  (state.bookings.length ? '<div class="table-scroll"><table style="min-width:420px"><thead><tr><th>Reference</th><th>Departure</th><th>Seats</th><th>Status</th></tr></thead><tbody>'+state.bookings.map(item=>'<tr><td class="ticket-code">'+safe(item.code)+'</td><td>'+safe(item.time)+'</td><td>'+item.seats+'</td><td>'+pill(item.status,item.status==="Cancelled"?"neutral":"good")+'</td></tr>').join("")+'</tbody></table></div>' : '<p class="empty">Book a ride in CUBE to populate the manifest.</p>')+
  '</section><section class="card table-card"><div class="card-head"><div><h2>Operations log</h2><p class="sub">Simulated records for the MRANTI data pipeline</p></div></div>'+state.activity.slice(0,15).map(item=>'<div class="incident-row"><div class="space-between"><span>'+safe(item.description)+'</span><time class="sub">'+safe(item.time)+'</time></div></div>').join("")+'</section></div>';
}

function renderCommand() {
  return '<div class="intro compact"><div><p class="eyebrow">CUBE · MRANTI Park Operations</p><h1>Command Centre</h1><p class="muted">Fleet monitoring, incident response and service administration.</p></div>'+pill(state.paused || !state.ready ? "Bookings paused" : "Service open",state.paused || !state.ready ? "warn" : "good")+'</div>'+
  '<div class="tabs" aria-label="Command centre sections">'+["Overview","Admin","Entrance","Records"].map(tab=>'<button data-action="tab" data-id="'+tab+'" aria-pressed="'+(tab===opsTab)+'">'+tab+'</button>').join("")+'</div>'+
  ({Overview:renderOverview,Admin:renderAdmin,Entrance:renderEntrance,Records:renderRecords}[opsTab])();
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
  app.innerHTML=({booking:renderBooking,command:renderCommand,stakeholders:renderStakeholders}[active])();
}
function confirmAction(title, message, label, action, id) {
  dialog.innerHTML='<div class="stack"><h2 id="dialog-title">'+safe(title)+'</h2><p class="muted">'+safe(message)+'</p><div class="actions">'+button("Back","dismiss")+button(label,action,{variant:"primary",id})+'</div></div>';
  dialog.showModal();
}

document.addEventListener("click", event => {
  const target=event.target.closest("[data-action]");
  if (!target) return;
  const {action,id}=target.dataset;
  const slot=state.departures.find(item=>item.time===id);
  const booking=state.bookings.find(item=>item.code===id);
  switch (action) {
    case "tickets":
      event.preventDefault();
      document.querySelector("#tickets").scrollIntoView({behavior:"smooth"});
      document.querySelector("#tickets").focus({preventScroll:true});
      break;
    case "slot": selectedTime=id; seats=Math.min(seats,remaining(slot)); render(); break;
    case "less": seats--; render(); break;
    case "more": seats++; render(); break;
    case "review":
      confirmAction("Review your ride", stops[origin]+" to "+stops[destination]+" · "+selectedTime+" MYT · "+seats+" seat"+(seats>1?"s":"")+". "+(state.paid?"Simulated total "+money(seats*state.fare)+". No payment is collected.":"Complimentary ride."), "Confirm reservation", "book");
      break;
    case "book": {
      const selected=state.departures.find(item=>item.time===selectedTime);
      dialog.close();
      if (!selected || selected.status!=="Open" || remaining(selected)<seats || origin===destination || state.paused || !state.ready) { announce("That departure is unavailable."); break; }
      const code="CUBE-"+state.nextCode++;
      state.bookings.unshift({code,time:selectedTime,origin:stops[origin],destination:stops[destination],seats,total:state.paid ? seats*state.fare : 0,status:"Booked"});
      if (remaining(selected)<seats) seats=1;
      update("Booking confirmed · "+code);
      document.querySelector("#tickets").scrollIntoView({behavior:"smooth"});
      break;
    }
    case "cancel":
      if (booking?.status==="Booked") confirmAction("Cancel booking", "Release your reserved seats for "+booking.time+"?", "Cancel booking", "confirm-cancel", id);
      break;
    case "confirm-cancel":
      dialog.close();
      if (booking?.status==="Booked") { booking.status="Cancelled"; update("Booking cancelled · "+id); }
      break;
    case "tab": opsTab=id; render(); break;
    case "hold":
      if (!slot || slot.status==="Cancelled") break;
      slot.status=slot.status==="Held"?"Open":"Held";
      update(slot.time+" departure "+(slot.status==="Held"?"held":"released"));
      break;
    case "cancel-slot":
      if (slot) confirmAction("Cancel departure", "Cancel the "+slot.time+" departure and all its active reservations?", "Cancel departure", "confirm-slot", id);
      break;
    case "confirm-slot":
      dialog.close();
      if (!slot || slot.status==="Cancelled") break;
      slot.status="Cancelled";
      state.bookings.filter(item=>item.time===id).forEach(item=>{ item.status="Cancelled"; });
      update(id+" departure cancelled");
      break;
    case "incident": {
      const incident=state.incidents.find(item=>String(item.id)===id);
      if (!incident || incident.state==="Resolved") break;
      incident.state=incident.state==="Open"?"Acknowledged":"Resolved";
      update(incident.title+" · "+incident.state.toLowerCase());
      break;
    }
    case "pause": state.paused=!state.paused; update(state.paused?"New bookings paused":"Bookings resumed"); break;
    case "readiness": state.ready=!state.ready; update(state.ready?"Buggy marked ready":"Buggy placed in maintenance lockout"); break;
    case "reset": confirmAction("Reset demonstration", "Restore the original settings and clear the demo bookings?", "Reset demo", "confirm-reset"); break;
    case "confirm-reset":
      dialog.close(); state=structuredClone(defaults); selectedTime=defaults.departures[0].time; seats=1; origin=0; destination=2; save(); render(); announce("Demo reset");
      break;
    case "dismiss": dialog.close(); break;
  }
});
document.addEventListener("change", event => {
  if (event.target.id==="origin") { origin=Number(event.target.value); render(); }
  if (event.target.id==="destination") { destination=Number(event.target.value); render(); }
});
document.addEventListener("submit", event => {
  const form=event.target;
  const values=new FormData(form);
  event.preventDefault();
  if (form.id === "entrance-form") {
    const code = String(values.get("code")).trim().toUpperCase();
    const headcount = Number(values.get("headcount"));
    const booking = state.bookings.find(item => item.code === code);
    const departure = booking && state.departures.find(slot => slot.time === booking.time);
    const result = document.querySelector("#entrance-result");
    if (!booking || booking.status !== "Booked") {
      result.textContent = "This booking code is missing, cancelled or already checked in.";
      return;
    }
    if (!state.ready || departure?.status !== "Open") {
      result.textContent = "Boarding is on hold for this departure.";
      return;
    }
    if (headcount !== booking.seats) {
      result.textContent = headcount > booking.seats
        ? boardingWarning
        : "The passenger count must match the booking before check-in.";
      return;
    }
    booking.status = "Checked in";
    update("QR check-in accepted · " + booking.code + " · " + headcount + " passengers");
    document.querySelector("#entrance-result").textContent = "Boarding check-in accepted for " + booking.code + ".";
    return;
  }
  if (form.id==="fare-form") {
    state.fare=Number(values.get("fare"));
    state.paid=values.get("mode")==="paid";
    update("Service settings saved");
  }
  if (form.id==="departure-form") {
    const time=String(values.get("time"));
    if (state.departures.some(item=>item.time===time)) { announce("A departure at "+time+" already exists."); return; }
    state.departures.push({time,capacity:Number(values.get("capacity")),occupied:0,status:"Open"});
    state.departures.sort((first,second)=>first.time.localeCompare(second.time));
    update(time+" departure added");
  }
});
window.addEventListener("hashchange",()=>{ render(); window.scrollTo(0,0); });
render();
