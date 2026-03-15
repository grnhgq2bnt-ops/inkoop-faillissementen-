/* global L */
const LEAFLET = window.L;
if (!LEAFLET) throw new Error("Leaflet niet gevonden.");
const DEFAULT_CENTER = [50.8503, 4.3517];
const DEFAULT_ZOOM = 8;
function $(s){const el=document.querySelector(s);if(!el)throw new Error(`Element niet gevonden: ${s}`);return el}
function normalizeText(input){return String(input||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ")}
function parseISODate(value){const s=String(value||"").slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const t=Date.parse(`${s}T00:00:00Z`);if(Number.isNaN(t))return null;return s}
function isoToTs(iso){return Date.parse(`${iso}T00:00:00Z`)}
async function tryFetchJson(paths){for(const path of paths){try{const res=await fetch(path,{cache:"no-store"});if(!res.ok)continue;return await res.json()}catch{}}throw new Error(`Kon geen JSON laden: ${paths.join(", ")}`)}
function computeDateExtent(records){let min=null,max=null;for(const r of records){const d=parseISODate(r.date);if(!d)continue;if(!min||d<min)min=d;if(!max||d>max)max=d}return{min,max}}
function clampDateRange({min,max}){if(!min||!max)return{from:"",to:""};const to=max;const toTs=isoToTs(to);const fromTs=toTs-90*24*60*60*1000;const fromDate=new Date(fromTs);const from=fromDate.toISOString().slice(0,10);return{from:from<min?min:from,to}}
function scaleColor(count,max){if(!max||count<=0)return"rgba(232,238,252,0.22)";const t=Math.min(1,count/max);const hue=38-Math.round(t*38);return`hsla(${hue},92%,56%,${0.22+t*0.65})`}
function radiusFromCount(count){if(count<=0)return 0;return Math.min(34,6+Math.sqrt(count)*4.6)}
function downloadText(filename,text,mime="text/plain"){const blob=new Blob([text],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
function toCsvRow(values){return values.map(v=>{const s=String(v??"");if(/[",\n]/.test(s))return`"${s.replace(/"/g,'""')}"`;return s}).join(",")}
function bankruptciesToCsv(rows){const header=["date","municipality","province","company_name","enterprise_number","street","postal_code","court","source_ref","source_url"];const lines=[toCsvRow(header)];for(const r of rows){lines.push(toCsvRow([r.date||"",r.municipality||"",r.province||"",r.company_name||r.company?.name||"",r.enterprise_number||r.company?.enterprise_number||"",r.street||r.address?.street||"",r.postal_code||r.address?.postal_code||"",r.court||"",r.source_ref||r.source?.reference||"",r.source_url||r.source?.url||""]))}return lines.join("\n")}
function tryJsonParse(text){try{return JSON.parse(text)}catch{return null}}
function detectDelimiter(line){const semi=(line.match(/;/g)||[]).length;const comma=(line.match(/,/g)||[]).length;return semi>comma?";":","}
function parseCsv(text){const lines=text.split(/\r?\n/).filter(l=>l.trim().length>0);if(lines.length===0)return[];const delim=detectDelimiter(lines[0]);const headers=lines[0].split(delim).map(h=>h.trim().toLowerCase());const out=[];for(const line of lines.slice(1)){const cells=line.split(delim);const row={};headers.forEach((h,i)=>{row[h]=(cells[i]||"").trim()});out.push(row)}return out}
function normalizeCsvRow(row){const date=parseISODate(row.date||row.datum||row.publicatiedatum||row.publicationdate)||"";const muni=row.municipality||row.gemeente||row.locality||"";const province=row.province||"";const company=row.company_name||row.bedrijfsnaam||row.denomination||row.name||"";const enterprise_number=row.enterprise_number||row.ondernemingsnummer||row.vat||row.btw||row.kbo||"";const street=row.street||row.straat||"";const postal=row.postal_code||row.postcode||row.zip||"";const court=row.court||"";const source_ref=row.source_ref||row.source||"";const source_url=row.source_url||"";return{id:`${date||"unknown"}-${enterprise_number||muni||company||Math.random().toString(36).slice(2,7)}`,date,municipality:muni,province,company_name:company||enterprise_number||"Onbekend",enterprise_number,street,postal_code:postal,court,source_ref,source_url}}
function parseUploadedFile(text,filename){const isJson=filename.toLowerCase().endsWith(".json");if(isJson){const json=tryJsonParse(text);if(!json||!Array.isArray(json))throw new Error("JSON moet een array zijn");return json}const rows=parseCsv(text);return rows.map(normalizeCsvRow)}
function renderTopList(container,items,onPick){container.innerHTML="";for(const it of items){const li=document.createElement("li");li.className="toplist__row";li.innerHTML=`<span class="toplist__name">${it.name}</span><span class="toplist__count">${it.count}</span>`;li.tabIndex=0;li.setAttribute("role","button");li.addEventListener("click",()=>onPick(it.id));li.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" ")onPick(it.id)});container.appendChild(li)}}
function renderProvinceList(container,items,onPick){container.innerHTML="";for(const it of items){const li=document.createElement("li");li.className="toplist__row";li.innerHTML=`<span class="toplist__name">${it.name}</span><span class="toplist__count">${it.count}</span>`;li.setAttribute("role","button");li.tabIndex=0;li.addEventListener("click",()=>onPick(it.name));li.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" ")onPick(it.name)});container.appendChild(li)}}
function renderDetail(container,muni,rows,extent){if(!muni){container.classList.add("detail--empty");container.innerHTML=`<div class="detail__empty">Klik op een gemeente-cirkel op de kaart.</div>`;return}container.classList.remove("detail--empty");const dateText=extent?.from&&extent?.to?`${extent.from} → ${extent.to}`:"–";const header=document.createElement("div");header.className="detail__header";header.innerHTML=`<div><div class="detail__title">${muni.name}</div><div class="detail__sub">${muni.province||""} ${muni.region?`· ${muni.region}`:""}</div></div><div class="badge">${rows.length} hits</div>`;const meta=document.createElement("div");meta.className="detail__sub";meta.textContent=`Periode: ${dateText}`;const list=document.createElement("div");list.className="detail__list";if(rows.length===0){const empty=document.createElement("div");empty.className="detail__empty";empty.textContent="Geen resultaten met huidige filters.";container.innerHTML="";container.appendChild(header);container.appendChild(meta);container.appendChild(empty);return}const sorted=[...rows].sort((a,b)=>(a.date<b.date?1:a.date>b.date?-1:0));for(const r of sorted.slice(0,200)){const item=document.createElement("div");item.className="item";const name=r.company_name||r.company?.name||"Onbekend";const date=r.date||"";const addr=[r.street||r.address?.street||"",r.postal_code||r.address?.postal_code||""].filter(Boolean).join(", ");const en=r.enterprise_number||r.company?.enterprise_number||"";const court=r.court||"";item.innerHTML=`<div class="item__top"><div class="item__name">${name}</div><div class="item__date">${date}</div></div><div class="item__meta">${addr?`<span>${addr}</span>`:""} ${en?`<span class="badge">${en}</span>`:""} ${court?`<span>${court}</span>`:""}</div>`;list.appendChild(item)}container.innerHTML="";container.appendChild(header);container.appendChild(meta);container.appendChild(list)}
function setSelectOptions(select,values,placeholderLabel){const current=select.value;select.innerHTML="";const opt0=document.createElement("option");opt0.value="";opt0.textContent=placeholderLabel;select.appendChild(opt0);for(const v of values){const opt=document.createElement("option");opt.value=v;opt.textContent=v;select.appendChild(opt)}if([...select.options].some(o=>o.value===current))select.value=current}
function buildIndex(municipalities){const byId=new Map();const byName=new Map();for(const m of municipalities){byId.set(m.id,m);const n=normalizeText(m.name);if(n)byName.set(n,m);if(Array.isArray(m.aliases)){for(const a of m.aliases){const na=normalizeText(a);if(na&&!byName.has(na))byName.set(na,m)}}}return{byId,byName}}
function mapRecordToMunicipality(record,muniIndex){const name=normalizeText(record.municipality||record.gemeente||"");if(name&&muniIndex.byName.has(name))return muniIndex.byName.get(name);return null}
function filterBankruptcies(records,state,muniIndex){const q=normalizeText(state.q);const from=state.from?isoToTs(state.from):null;const to=state.to?isoToTs(state.to):null;const province=state.province||"";const rows=[];for(const r of records){const date=parseISODate(r.date);if(!date)continue;const ts=isoToTs(date);if(from&&ts<from)continue;if(to&&ts>to)continue;const muni=mapRecordToMunicipality(r,muniIndex);const muniProvince=r.province||muni?.province||"";if(province&&normalizeText(muniProvince)!==normalizeText(province))continue;if(q){const hay=normalizeText([r.company_name||r.company?.name||"",r.street||r.address?.street||"",r.postal_code||r.address?.postal_code||"",r.municipality||"",muniProvince||""].join(" "));if(!hay.includes(q))continue}rows.push({...r,date,municipality:r.municipality||muni?.name||r.municipality})}return rows}
function aggregateByMunicipality(rows,municipalities,muniIndex){const counts=new Map();const bucket=new Map();for(const r of rows){const muni=mapRecordToMunicipality(r,muniIndex);if(!muni)continue;counts.set(muni.id,(counts.get(muni.id)||0)+1);if(!bucket.has(muni.id))bucket.set(muni.id,[]);bucket.get(muni.id).push(r)}let max=0;for(const c of counts.values())max=Math.max(max,c);const list=municipalities.map(m=>({id:m.id,name:m.name,count:counts.get(m.id)||0}));list.sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));return{counts,bucket,max,list}}
function aggregateByProvince(rows){const counts=new Map();for(const r of rows){const prov=(r.province||"").trim();if(!prov)continue;counts.set(prov,(counts.get(prov)||0)+1)}const list=[...counts.entries()].map(([name,count])=>({name,count}));list.sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));return list}
function boundsFromMarkers(markers){const latLngs=[];for(const m of markers){if(typeof m.getLatLng==="function")latLngs.push(m.getLatLng())}if(latLngs.length===0)return null;return LEAFLET.latLngBounds(latLngs)}
function createCircleMarker(muni,count,max){const radius=radiusFromCount(count);const color=scaleColor(count,max);return LEAFLET.circleMarker([muni.lat,muni.lng],{radius,color:"rgba(255,255,255,0.18)",weight:1,fillColor:color,fillOpacity:1})}
function buildPopupHtml(muni,count){const province=muni.province?`<span class="badge">${muni.province}</span>`:"";return`<div class="popup"><div class="popup__title">${muni.name}</div><p class="popup__meta">${count} faillissementen ${province}</p></div>`}
async function registerServiceWorker(){if(!("serviceWorker"in navigator))return;try{await navigator.serviceWorker.register("./service-worker.js")}catch{}}
function setupInstallPrompt(button){let deferred=null;window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferred=e;button.hidden=false});button.addEventListener("click",async()=>{if(!deferred)return;deferred.prompt();try{await deferred.userChoice}finally{deferred=null;button.hidden=true}})}
async function main(){
  await registerServiceWorker();
  setupInstallPrompt($("#btn-install"));
  const municipalities=await tryFetchJson(["./data/municipalities.json","./data/municipalities.sample.json"]);
  let bankruptcies=await tryFetchJson(["./data/faillissementen.json","./data/faillissementen.sample.json"]);
  const muniIndex=buildIndex(municipalities);
  let extent=computeDateExtent(bankruptcies);
  const defaults=clampDateRange(extent);
  const state={from:defaults.from,to:defaults.to,q:"",province:"",onlyWith:true,selectedMuniId:null};
  const dateFrom=$("#date-from"),dateTo=$("#date-to"),q=$("#q"),province=$("#province"),onlyWith=$("#only-with"),btnReset=$("#btn-reset"),btnFit=$("#btn-fit"),topList=$("#top-list"),detail=$("#detail"),statTotal=$("#stat-total"),statMuni=$("#stat-muni"),statMax=$("#stat-max"),provinceList=$("#province-list"),btnExport=$("#btn-export"),btnUpload=$("#btn-upload"),fileInput=$("#file-input");
  dateFrom.value=state.from;dateTo.value=state.to;
  const provinces=[...new Set(municipalities.map(m=>m.province).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  setSelectOptions(province,provinces,"Alle provincies");
  const map=LEAFLET.map("map",{zoomControl:true}).setView(DEFAULT_CENTER,DEFAULT_ZOOM);
  LEAFLET.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  const layerGroup=LEAFLET.layerGroup().addTo(map);
  let markerByMuniId=new Map();
  function refresh(){
    state.from=dateFrom.value;state.to=dateTo.value;state.q=q.value;state.province=province.value;state.onlyWith=!!onlyWith.checked;
    const filtered=filterBankruptcies(bankruptcies,state,muniIndex);
    const agg=aggregateByMunicipality(filtered,municipalities,muniIndex);
    const provAgg=aggregateByProvince(filtered);
    statTotal.textContent=String(filtered.length);
    const muniWithHits=agg.list.filter(x=>x.count>0).length;
    statMuni.textContent=String(muniWithHits);
    statMax.textContent=String(agg.max||0);
    renderProvinceList(provinceList,provAgg,provName=>{province.value=provName;state.province=provName;refresh()});
    const top=agg.list.filter(x=>x.count>0).slice(0,12);
    renderTopList(topList,top,muniId=>{state.selectedMuniId=muniId;const mk=markerByMuniId.get(muniId);if(mk){map.panTo(mk.getLatLng(),{animate:true,duration:0.25});mk.openPopup()}const muni=muniIndex.byId.get(muniId);renderDetail(detail,muni,agg.bucket.get(muniId)||[],{from:state.from,to:state.to})});
    layerGroup.clearLayers();markerByMuniId=new Map();
    for(const muni of municipalities){const count=agg.counts.get(muni.id)||0;if(state.onlyWith&&count===0)continue;if(typeof muni.lat!=="number"||typeof muni.lng!=="number")continue;const mk=createCircleMarker(muni,count,agg.max);mk.bindPopup(buildPopupHtml(muni,count),{closeButton:false,offset:[0,-2]});mk.on("click",()=>{state.selectedMuniId=muni.id;renderDetail(detail,muni,agg.bucket.get(muni.id)||[],{from:state.from,to:state.to})});mk.addTo(layerGroup);markerByMuniId.set(muni.id,mk)}
    if(state.selectedMuniId){const muni=muniIndex.byId.get(state.selectedMuniId);const rows=agg.bucket.get(state.selectedMuniId)||[];renderDetail(detail,muni,rows,{from:state.from,to:state.to})}else{renderDetail(detail,null,[],{from:state.from,to:state.to})}
    btnExport.onclick=()=>{const csv=bankruptciesToCsv(filtered);const stamp=new Date().toISOString().slice(0,10);downloadText(`faillissementen-filter-${stamp}.csv`,csv,"text/csv;charset=utf-8")};
    btnFit.onclick=()=>{const markers=[...markerByMuniId.values()];const b=boundsFromMarkers(markers);if(b)map.fitBounds(b.pad(0.18))};
  }
  const onChange=()=>refresh();
  dateFrom.addEventListener("change",onChange);dateTo.addEventListener("change",onChange);
  q.addEventListener("input",()=>{window.clearTimeout(q._t);q._t=window.setTimeout(onChange,120)});
  province.addEventListener("change",onChange);onlyWith.addEventListener("change",onChange);
  btnReset.addEventListener("click",()=>{const reset=clampDateRange(extent);dateFrom.value=reset.from;dateTo.value=reset.to;q.value="";province.value="";onlyWith.checked=true;state.selectedMuniId=null;refresh();map.setView(DEFAULT_CENTER,DEFAULT_ZOOM)});
  btnUpload.addEventListener("click",()=>fileInput.click());
  fileInput.addEventListener("change",async event=>{const file=event.target.files?.[0];if(!file)return;try{const text=await file.text();bankruptcies=parseUploadedFile(text,file.name);extent=computeDateExtent(bankruptcies);const def=clampDateRange(extent);dateFrom.value=def.from;dateTo.value=def.to;state.selectedMuniId=null;refresh();alert(`Data geladen uit ${file.name} (${bankruptcies.length} records).`)}catch(err){alert(`Kon bestand niet laden: ${err.message||err}`)}finally{fileInput.value=""}});
  refresh();
}
main().catch(err=>{console.error(err);const msg=document.createElement("div");msg.style.padding="14px";msg.style.fontFamily="var(--mono)";msg.style.color="rgba(255,255,255,0.85)";msg.textContent=`Fout: ${err.message}`;document.body.prepend(msg)});
