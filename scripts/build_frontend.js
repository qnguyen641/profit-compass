/* Builds frontend/index.html from the original mock:
   1. wraps it in a proper HTML5 document skeleton
   2. loads all data from the backend (api/bootstrap.js -> window.__DATA__)
      instead of hard-coded constants
   3. rewires the AI chat panel to the real backend (POST api/chat),
      keeping the original scripted engine as an offline fallback.       */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3] || path.join(__dirname, '..', 'frontend', 'index.html');
let html = fs.readFileSync(SRC, 'utf8');

function mustIndex(s, needle, from = 0) {
  const i = s.indexOf(needle, from);
  if (i < 0) throw new Error('marker not found: ' + needle.slice(0, 60));
  return i;
}

/* ---- 1. replace data constants with __DATA__ references ---------------- */
const DATA_CONSTS = ['PROJECTS','SNAPSHOTS','BUDGET_BY_CATEGORY','ACTUAL_BY_CATEGORY',
  'OPEN_PO_TOTAL','CATEGORY_DATA','DRIVER_NOTES','PROJECT_LESSON','TRANSACTIONS',
  'INCIDENTS','LABOUR_BY_PROJECT','RISK_ALERTS','REFERENCE_FACTS','QUOTE_REQUEST'];

for (const name of DATA_CONSTS) {
  const declStart = mustIndex(html, `const ${name} = `);
  const lineEnd = html.indexOf('\n', declStart);
  const firstLine = html.slice(declStart, lineEnd);
  let end;
  if (/;\s*$/.test(firstLine)) {
    end = lineEnd; // single-line const
  } else {
    // multi-line literal: ends at the first line that is exactly ]; or };
    const closer = firstLine.includes('= [') ? '\n];' : '\n};';
    end = mustIndex(html, closer, declStart) + closer.length;
  }
  html = html.slice(0, declStart) + `const ${name} = __DATA__.${name};` + html.slice(end);
}

/* ---- 2. rewire chat to the backend ------------------------------------- */
const helper = `
/* ---- real AI backend (Claude tool-use over the workspace DB) ----
   Falls back to the local scripted engine if the API is unreachable. */
function chatContextPid(){ return state.screen==='B' ? state.selectedProject : null; }
async function askBackend(questionText, opts={}){
  if(state.chatBusy) return;
  state.chatBusy = true;
  state.chatLog.push({ role:'user', text: questionText });
  state.chatLog.push({ role:'typing' });
  renderChatTab();
  let res = null;
  try{
    const r = await fetch('api/chat', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ question: questionText, project_id: chatContextPid(),
        history: state.chatLog.filter(t=>t.role==='user'||t.role==='ai').slice(0,-2).slice(-10)
                  .map(t=>({role:t.role, text:t.text})) }) });
    if(r.ok) res = await r.json();
  }catch(e){ /* offline / backend down -> scripted fallback below */ }
  const ti = state.chatLog.findIndex(t=>t.role==='typing');
  if(ti>=0) state.chatLog.splice(ti,1);
  state.chatBusy = false;
  if(res && res.text){
    const turn = { role:'ai', text: res.text };
    if(res.chips && res.chips.length) turn.chips = res.chips;
    if(res.open_project) turn.openProject = res.open_project;
    state.chatLog.push(turn);
    if(opts.after) opts.after(res);
    renderChatTab();
  } else {
    answerTyped(questionText);
    renderChatTab();
  }
}
`;

const rscStart = mustIndex(html, 'function runSuggestedChat(key){');
const rscEnd = mustIndex(html, '/* The typed-question router');
html = html.slice(0, rscStart) + helper + `
function runSuggestedChat(key){
  if(key==='portfolio-risk') askBackend('Which project is most at risk?');
  else if(key==='best-ever') askBackend('Which project made the best margin?');
  else if(key==='prj1-profit') askBackend('How profitable is the Orchard Road Christmas project?', { after:()=>{ state.chatFollowupReady = true; renderChatTab(); } });
  else if(key==='this-project') askBackend('How did ' + project(state.selectedProject).name + ' do?');
  else if(key==='follow-why'){ state.chatFollowupReady = false; askBackend('Why is the forecast margin lower than target?'); }
}

` + html.slice(rscEnd);

const aacStart = mustIndex(html, 'function askAiAboutCategory(cat){');
const aacEnd = mustIndex(html, 'function pushTyping');
html = html.slice(0, aacStart) + `function askAiAboutCategory(cat){
  const pid = state.screen==='B' ? state.selectedProject : 'PRJ-001';
  const ins = insightsFor(pid).find(i=>i.category===cat);
  renderAiPanel();
  const over = ins.deltaAmt >= 0;
  askBackend('Why is ' + catLabel(cat).toLowerCase() + ' ' + (over?'over':'under') + ' budget on ' + project(pid).name + '?');
}

` + html.slice(aacEnd);

const scStart = mustIndex(html, 'function sendChat(){');
const scEnd = mustIndex(html, "document.getElementById('aiSendBtn')");
html = html.slice(0, scStart) + `function sendChat(){
    const text = aiInput.value.trim();
    if(!text || state.chatBusy) return;
    aiInput.value = '';
    askBackend(text);
  }
  ` + html.slice(scEnd);

/* answerTyped is now the offline fallback: it must not double-push the user turn
   (askBackend already did) — it only pushes the AI turn, which it already does. */

/* ---- 2a. retire the AI auto-attribution storyline ----------------------- */
// The three formerly-untagged rows are now ordinary tagged ledger lines
// (seed change), so the two insight texts that referenced the attribution
// mechanism are rewritten to match the data.
function mustReplace(needle, replacement) {
  if (!html.includes(needle)) throw new Error('replace target not found: ' + needle.slice(0, 60));
  // function form: keeps $-sequences in the replacement text literal
  html = html.replace(needle, () => replacement);
}
mustReplace(
  'detail:()=>`Healthy even after one unreferenced ${fmtSGD(12000)} freight charge that is still awaiting attribution — if that lands here, the saving narrows.`',
  'detail:()=>`Storage, haulage, crane and final-phase freight all sat under a single SwiftHaul agreement — one vendor to negotiate with, one rate card to hold.`');
mustReplace(
  'headline:()=>`Close to plan. One ${fmtSGD(8500)} line is still a <b>suggested</b> match, not a confirmed saving.`',
  'headline:()=>`Close to plan across permits, insurance, cleaning and site sundries.`');
mustReplace(
  'detail:()=>`Permits, insurance and site cleaning all tracked to budget. Confirm the suggested attribution before treating the underspend as real.`',
  'detail:()=>`Permits, insurance and site cleaning all tracked to budget, with a small underspend on the allowance.`');

/* ---- 2f. quote screen: the QUOTE is the main event ---------------------- */
// Reorder the three columns: request form | GENERATED QUOTE (center, primary)
// | evidence (right, supporting). Button becomes "Generate quote".
{
  const mStart = mustIndex(html, '      <div>\n        <section class="qsearch');
  const rStart = mustIndex(html, '      <div class="card pad">\n        <div class="section-label">Suggested draft</div>');
  const rEnd = mustIndex(html, '\n    </div>\n  `;\n}\n\n/* The search run.');
  const middle = html.slice(mStart, rStart);
  const right = html.slice(rStart, rEnd);
  html = html.slice(0, mStart) + right + '\n\n' + middle.replace(/\s+$/, '\n') + html.slice(rEnd);
}
mustReplace(
  "${iconCompass('currentColor')} ${done?'Search again':'Find comparable jobs'}",
  "${iconCompass('currentColor')} ${done?'Regenerate quote':'Generate quote'}");
mustReplace('<div class="section-label">Suggested draft</div>',
            '<div class="section-label">Generated quote</div>');
mustReplace('Matched <b>${QUOTE_REQUEST.reference_project_ids.length} of ${cands.length}</b> past jobs on project type and scope. Extracted overrun patterns are priced into the draft.',
            'Matched <b>${QUOTE_REQUEST.reference_project_ids.length} of ${cands.length}</b> past jobs on project type and scope. Their overrun patterns are priced into the quote on the left.');

/* ---- 2f2. generate-quote flow: nothing until you press the button ------- */
// (a) no autoplay on entering the screen — the scan runs only when asked
mustReplace("  if(document.getElementById('qsearch') && !state.quoteSearched) setTimeout(playQuoteSearch, 140);\n", '');
// (b) when the run finishes, re-render: the quote reveals, the button flips
//     to Regenerate, and a run-complete line appears
mustReplace(
  "searchTimers.push(setTimeout(()=>{ wrap.classList.add('revealed'); state.quoteSearched = true; }, rows.length*RUN + 340));",
  "searchTimers.push(setTimeout(()=>{ state.quoteSearched = true; render(); }, rows.length*RUN + 340));");
mustReplace(
  "if(reduce){ rows.forEach(r=>r.classList.add('done')); wrap.classList.add('revealed'); state.quoteSearched = true; return; }",
  "if(reduce){ state.quoteSearched = true; render(); return; }");
// (c) run-complete indicator under the button
mustReplace(
  '<button class="btn primary" id="runSearchBtn" style="width:100%;justify-content:center">${iconCompass(\'currentColor\')} ${done?\'Regenerate quote\':\'Generate quote\'}</button>',
  '<button class="btn primary" id="runSearchBtn" style="width:100%;justify-content:center">${iconCompass(\'currentColor\')} ${done?\'Regenerate quote\':\'Generate quote\'}</button>\n'
  + '        ${done?`<div class="mono" style="display:flex;align-items:center;gap:6px;font-size:9.5px;letter-spacing:.06em;color:var(--good);margin-top:9px;text-transform:uppercase"><span style="width:13px;height:13px;display:inline-flex">${iconCheck()}</span>Run complete · built from ${QUOTE_REQUEST.reference_project_ids.length} delivered jobs</div>`:\'\'}');
// (d) the quote card is empty until generated; once generated it leads with
//     the contract value as the headline
{
  const csM = '<div style="display:flex;flex-direction:column;gap:9px;margin-bottom:10px">${suggestBars}</div>';
  const ceM = '<div class="footer-note">Drafted from historical evidence. Review before sending.</div>';
  const cs = mustIndex(html, csM);
  const ce = mustIndex(html, ceM) + ceM.length;
  const content = html.slice(cs, ce);
  const headline =
    "${quoteMode==='target' ? `"
    + '<div style="margin-bottom:13px;padding-bottom:12px;border-bottom:1px solid var(--border)">'
    + '<div class="num" id="quoteHeadVal" style="font-family:var(--font-display);font-size:27px;font-weight:700;letter-spacing:-.01em">${fmtSGD(targetPlan(quoteTargetValue,quoteMarginPct).allowed)}</div>'
    + '<div class="mono" style="font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--text-faint);margin-top:2px">Allowed cost budget · S$<span id="tvEcho">${quoteTargetValue.toLocaleString(\'en-SG\')}</span> × (1 − <span id="quoteHeadMargin">${quoteMarginPct}</span>%)</div>'
    + '<div class="mono" style="font-size:10.5px;margin-top:7px">Reference cost of this work: ${fmtSGD(costBaseForMargin())} · gap <span id="targetGapVal" class="num" style="font-weight:700;color:${targetPlan(quoteTargetValue,quoteMarginPct).gap>0?\'var(--critical)\':\'var(--good)\'}">${(targetPlan(quoteTargetValue,quoteMarginPct).gap>0?\'−\':\'+\')+fmtSGD(Math.abs(targetPlan(quoteTargetValue,quoteMarginPct).gap)).replace(\'S\',\'S\')}</span></div>'
    + '</div><div id="cutPlanWrap">${renderTargetPlan()}</div>'
    + '` : `'
    + '<div style="margin-bottom:13px;padding-bottom:12px;border-bottom:1px solid var(--border)">'
    + '<div class="num" id="quoteHeadVal" style="font-family:var(--font-display);font-size:27px;font-weight:700;letter-spacing:-.01em">${fmtSGD(contractVal)}</div>'
    + '<div class="mono" style="font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--text-faint);margin-top:2px">Suggested contract value · <span id="quoteHeadMargin">${quoteMarginPct}</span>% target margin</div>'
    + '</div>'
    + '`}\n        ';
  const placeholder =
    '<div class="empty-note" style="padding:30px 16px;text-align:center;line-height:1.6">'
    + 'No quote yet.<br/>Set the target margin, then press <b>Generate quote</b> — '
    + 'the draft is built category by category from the actuals of your delivered jobs.'
    + '</div>';
  html = html.slice(0, cs) + '${done ? `' + headline + content + '` : `' + placeholder + '`}' + html.slice(ce);
}
// (e) margin changes move the headline too, not just the small formula echo
mustReplace(
  "    const out = document.getElementById('contractValOut'); if(out) out.textContent = fmtSGD(suggestedContractValue(n));",
  "    const out = document.getElementById('contractValOut'); if(out) out.textContent = fmtSGD(suggestedContractValue(n));\n"
  + "    if(quoteMode==='margin'){ const hv = document.getElementById('quoteHeadVal'); if(hv) hv.textContent = fmtSGD(suggestedContractValue(n)); }\n"
  + "    const hm = document.getElementById('quoteHeadMargin'); if(hm) hm.textContent = n;\n"
  + "    if(typeof updateTargetOutputs==='function') updateTargetOutputs();");

/* ---- 2f3. quote bars that explain themselves ---------------------------- */
// The dimension-line rendering (hairline + floating "base" tick) read like a
// technical drawing. Replaced with two-segment bars: solid = cost scaled from
// delivered-job actuals, striped = contingency — with the arithmetic written
// under each bar that carries contingency.
mustReplace(
  `  const maxBar = Math.max(...CATS.map(c=>QUOTE_REQUEST.suggested_budget_by_category[c]));
  const suggestBars = CATS.map(c=>{
    const withCont = QUOTE_REQUEST.suggested_budget_by_category[c];
    const noCont = QUOTE_REQUEST.base_budget_by_category_no_contingency[c];
    const hasCont = withCont !== noCont;
    return \`<div class="barrow" style="grid-template-columns:104px 1fr 78px;gap:10px">
      <div class="cat-lbl" style="font-size:12px"><span class="cat-tick" style="background:\${catColorVar(c)}"></span>\${catLabel(c)}</div>
      <div class="track">
        <span class="dim" style="width:\${(withCont/maxBar*100).toFixed(1)}%;background:\${catColorVar(c)}"></span>
        \${hasCont?\`<span class="ref" style="left:\${(noCont/maxBar*100).toFixed(1)}%" data-lbl="base"></span>\`:''}
      </div>
      <div class="amt">\${fmtSGD(withCont)}</div>
    </div>\`;
  }).join('');`,
  `  const maxBar = Math.max(...CATS.map(c=>QUOTE_REQUEST.suggested_budget_by_category[c]));
  const qCostBase = CATS.reduce((s,c)=>s+QUOTE_REQUEST.suggested_budget_by_category[c],0);
  const CONT_STRIPE = 'repeating-linear-gradient(45deg,var(--warn),var(--warn) 3px,var(--warn-bg) 3px,var(--warn-bg) 6px)';
  const suggestBars = CATS.map(c=>{
    const withCont = QUOTE_REQUEST.suggested_budget_by_category[c];
    const noCont = QUOTE_REQUEST.base_budget_by_category_no_contingency[c];
    const cont = withCont - noCont;
    const share = Math.round(withCont/qCostBase*100);
    return \`<div style="display:grid;grid-template-columns:104px 1fr 92px;gap:10px;align-items:center">
      <div class="cat-lbl" style="font-size:12px"><span class="cat-tick" style="background:\${catColorVar(c)}"></span>\${catLabel(c)}</div>
      <div>
        <div style="display:flex;height:13px;border-radius:2px;overflow:hidden;background:var(--surface-2);border:1px solid var(--border)">
          <span style="width:\${(noCont/maxBar*100).toFixed(1)}%;background:\${catColorVar(c)}"></span>
          \${cont>0?\`<span style="width:\${(cont/maxBar*100).toFixed(1)}%;background:\${CONT_STRIPE}"></span>\`:''}
        </div>
        \${cont>0?\`<div class="mono" style="font-size:9px;color:var(--text-faint);margin-top:3px">\${fmtSGD(noCont)} from history + <span style="color:var(--warn-ink);font-weight:600">\${fmtSGD(cont)} contingency</span></div>\`:''}
      </div>
      <div style="text-align:right"><span class="num" style="font-weight:600;font-size:13px">\${fmtSGD(withCont)}</span><div class="mono" style="font-size:9px;color:var(--text-faint)">\${share}% of cost base</div></div>
    </div>\`;
  }).join('');`);

/* ---- 2f4. target-price mode: fit costs to a client budget --------------- */
// The reverse workflow: the client names the price, the margin is a floor,
// and the tool computes the allowed cost budget and how to close the gap —
// contingencies first (each cut carries its defensibility condition), scope
// last (flagged as a human decision, with the pro-rata arithmetic shown).
mustReplace(
  'let quoteMarginPct = QUOTE_REQUEST.target_margin_pct_default;',
  `let quoteMarginPct = QUOTE_REQUEST.target_margin_pct_default;
let quoteMode = 'margin';          // 'margin' = price from margin · 'target' = fit costs to client budget
let quoteTargetValue = 1150000;    // what the client says they can pay

function quoteContingency(cat){
  return QUOTE_REQUEST.suggested_budget_by_category[cat] - QUOTE_REQUEST.base_budget_by_category_no_contingency[cat];
}
function targetPlan(value, marginPct){
  const allowed = Math.round(value * (1 - marginPct/100));
  const ref = costBaseForMargin();
  const gap = ref - allowed;                       // >0 = must cut
  const steps = [];
  let remaining = gap;
  const subCont = quoteContingency('subcontractor');
  if(remaining > 0 && subCont > 0){
    const cut = Math.min(subCont, remaining);
    steps.push({ label:'Remove subcontractor contingency', amount:cut,
      cond:'Defensible only if rigging is committed on a firm quote before signing — the reference job that did held to +8%; the one that didn\\'t paid +19%.' });
    remaining -= cut;
  }
  const labCont = quoteContingency('labour');
  if(remaining > 0 && labCont > 0){
    const cut = Math.min(labCont, remaining);
    steps.push({ label:'Remove labour overtime contingency', amount:cut,
      cond:'Defensible only with a protected install window — delivery penalties on LED and fabric, no mid-build scope changes. That pattern drove the 18–22% OT overrun on both references.' });
    remaining -= cut;
  }
  let scope = null;
  if(remaining > 0){
    const baseTotal = CATS.reduce((s,c)=>s+QUOTE_REQUEST.base_budget_by_category_no_contingency[c],0);
    scope = { total: remaining, pct: remaining/baseTotal*100, byCat: {} };
    CATS.forEach(c=>{ scope.byCat[c] = Math.round(remaining * QUOTE_REQUEST.base_budget_by_category_no_contingency[c]/baseTotal); });
    scope.byCat.material += remaining - CATS.reduce((s,c)=>s+scope.byCat[c],0);
  }
  return { allowed, ref, gap, steps, scope };
}
function renderTargetPlan(){
  const p = targetPlan(quoteTargetValue, quoteMarginPct);
  if(p.gap <= 0){
    const refMargin = (100*(1 - p.ref/quoteTargetValue)).toFixed(1);
    return \`<div class="callout info" style="margin:0 0 14px"><span style="color:var(--good);width:16px;height:16px;display:inline-flex;flex-shrink:0">\${iconCheck()}</span><div><b>\${fmtSGD(-p.gap)} of headroom.</b> The reference cost base (\${fmtSGD(p.ref)}) already fits this budget at \${quoteMarginPct}% required margin. At reference cost the margin would be \${refMargin}%.</div></div>\`;
  }
  const rows = p.steps.map(s=>\`
    <div style="display:flex;gap:10px;align-items:baseline;padding:8px 0;border-bottom:1px dashed var(--border)">
      <span class="num" style="color:var(--warn-ink);font-weight:600;white-space:nowrap;min-width:78px">− \${fmtSGD(s.amount)}</span>
      <div style="flex:1;min-width:0"><b style="font-size:12px">\${s.label}</b><div class="muted" style="font-size:10.5px">\${s.cond}</div></div>
    </div>\`).join('');
  const scopeRow = p.scope ? \`
    <div style="display:flex;gap:10px;align-items:baseline;padding:8px 0">
      <span class="num" style="color:var(--critical);font-weight:600;white-space:nowrap;min-width:78px">− \${fmtSGD(p.scope.total)}</span>
      <div style="flex:1;min-width:0"><b style="font-size:12px">Cut scope — \${p.scope.pct.toFixed(1)}% off the historical cost of this work</b>
        <div class="muted" style="font-size:10.5px">Contingencies alone don't close the gap; the rest comes out of what gets built — a scope decision a person makes with the client. Spread pro-rata that means \${CATS.filter(c=>p.scope.byCat[c]>0).map(c=>\`\${catLabel(c)} −\${fmtSGD(p.scope.byCat[c])}\`).join(' · ')}.</div>
        \${p.scope.pct>20?\`<div class="mono" style="font-size:9.5px;color:var(--critical);margin-top:5px;letter-spacing:.05em">A CUT THIS DEEP IS A RENEGOTIATION OF PRICE OR SCOPE, NOT AN OPTIMISATION.</div>\`:''}
      </div>
    </div>\` : '';
  return \`<div style="margin-bottom:12px">
      <div class="section-label">How to close the gap</div>
      \${rows}\${scopeRow}
    </div>\`;
}
function updateTargetOutputs(){
  if(quoteMode!=='target') return;
  const p = targetPlan(quoteTargetValue, quoteMarginPct);
  const hv = document.getElementById('quoteHeadVal'); if(hv) hv.textContent = fmtSGD(p.allowed);
  const hm = document.getElementById('quoteHeadMargin'); if(hm) hm.textContent = quoteMarginPct;
  const te = document.getElementById('tvEcho'); if(te) te.textContent = quoteTargetValue.toLocaleString('en-SG');
  const gv = document.getElementById('targetGapVal');
  if(gv){ gv.textContent = (p.gap>0?'−':'+') + fmtSGD(Math.abs(p.gap)); gv.style.color = p.gap>0?'var(--critical)':'var(--good)'; }
  const out = document.getElementById('contractValOut'); if(out) out.textContent = fmtSGD(p.allowed);
  const cp = document.getElementById('cutPlanWrap'); if(cp) cp.innerHTML = renderTargetPlan();
}`);
// form: mode toggle + client-budget input; margin label adapts
mustReplace(
  `        <div class="field">
          <label>Target margin</label>`,
  `        <div class="field">
          <label>Quote mode</label>
          <div style="display:flex;border:1px solid var(--border);border-radius:3px;overflow:hidden">
            <button class="qmode-btn" data-qmode="margin" style="flex:1;padding:6px 4px;font-size:11px;font-weight:600;border:none;cursor:pointer;background:\${quoteMode==='margin'?'var(--brand)':'var(--surface)'};color:\${quoteMode==='margin'?'#fff':'var(--text-muted)'}">Price from margin</button>
            <button class="qmode-btn" data-qmode="target" style="flex:1;padding:6px 4px;font-size:11px;font-weight:600;border:none;cursor:pointer;background:\${quoteMode==='target'?'var(--brand)':'var(--surface)'};color:\${quoteMode==='target'?'#fff':'var(--text-muted)'}">Fit client budget</button>
          </div>
        </div>
        \${quoteMode==='target'?\`<div class="field">
          <label>Client budget (contract value)</label>
          <div class="margin-input"><span class="mi-unit">S$</span><input type="number" id="targetValueInput" value="\${quoteTargetValue}" min="100000" step="10000"/></div>
        </div>\`:''}
        <div class="field">
          <label>\${quoteMode==='target'?'Required margin':'Target margin'}</label>`);
// formula box adapts to the mode
mustReplace(
  `        <div class="formula-box">
          cost base ÷ (1 − target margin)<br/>
          = \${fmtSGD(costBase)} ÷ (1 − <span id="marginEcho">\${quoteMarginPct}</span>%)
          <div class="f-result num" id="contractValOut">\${fmtSGD(contractVal)}</div>
        </div>`,
  `        \${quoteMode==='margin'?\`<div class="formula-box">
          cost base ÷ (1 − target margin)<br/>
          = \${fmtSGD(costBase)} ÷ (1 − <span id="marginEcho">\${quoteMarginPct}</span>%)
          <div class="f-result num" id="contractValOut">\${fmtSGD(contractVal)}</div>
        </div>\`:\`<div class="formula-box">
          client budget × (1 − required margin)<br/>
          = \${fmtSGD(quoteTargetValue)} × (1 − <span id="marginEcho">\${quoteMarginPct}</span>%)
          <div class="f-result num" id="contractValOut">\${fmtSGD(targetPlan(quoteTargetValue,quoteMarginPct).allowed)}</div>
        </div>\`}`);
// bindings for the toggle and the budget input
mustReplace(
  `  if(mInput){
    mInput.addEventListener('input', e=>setMargin(e.target.value,'input'));
    mInput.addEventListener('blur',  e=>setMargin(e.target.value,'blur'));
  }`,
  `  if(mInput){
    mInput.addEventListener('input', e=>setMargin(e.target.value,'input'));
    mInput.addEventListener('blur',  e=>setMargin(e.target.value,'blur'));
  }
  document.querySelectorAll('.qmode-btn').forEach(el=>el.addEventListener('click', ()=>{
    if(quoteMode!==el.dataset.qmode){ quoteMode = el.dataset.qmode; render(); }
  }));
  const tvInput = document.getElementById('targetValueInput');
  if(tvInput) tvInput.addEventListener('input', e=>{
    const n = parseFloat(e.target.value);
    if(!isNaN(n) && n>0){ quoteTargetValue = n; updateTargetOutputs(); }
  });`);

/* ---- 2g. finished-job evidence drawer: facts only, no lecturing --------- */
mustReplace(`
        <p class="ad-p" style="margin-top:12px">\${PROJECT_LESSON[pid]||''}</p>`, '');
mustReplace(`
      <section class="ad-sec">
        <div class="section-label">What it priced into this quote</div>
        <div class="ad-rec">\${iconArrow()}<span>Subcontractor ran <b>+\${facts.subcontractor_overrun_pct}%</b> and installation overtime <b>+\${facts.labour_ot_overrun_pct}%</b> over budget here. Both are carried into the draft as contingency rather than assumed away.</span></div>
      </section>
`, '');
// screen-B retrospective label loses the preachy framing too
mustReplace("<span class=\"ls-k\">${d.isFinal?'What this teaches the next quote':'Read'}</span>",
            "<span class=\"ls-k\">${d.isFinal?'Retrospective':'Read'}</span>");

/* ---- 2g2. Attribution column becomes a SOURCE column -------------------- */
// With auto-attribution retired every row read "tagged" — informationless.
// The column now answers the real question: which system this record came
// from. Labour lines are computed from Time & Attendance (hours × rate);
// everything else is a posted SAP Business One document.
mustReplace('<th>Vendor</th><th>Description</th><th>Phase</th><th>Attribution</th>',
            '<th>Vendor</th><th>Description</th><th>Phase</th><th>Source</th>');
mustReplace(
  `            const flagged = isFlagged(t);
            let badge = \`<span class="tag-badge \${t.tag_status}">\${t.tag_status}</span>\`;
            if(t.tag_status==='inherited') badge = \`<span class="tag-badge inherited" title="\${t.inherit_via||''}">inherited · \${t.confidence}%</span>\`;
            if(t.tag_status==='suggested') badge = \`<span class="tag-badge suggested">suggested · \${t.confidence}%</span>\`;`,
  `            const flagged = isFlagged(t);
            const badge = t.category==='labour'
              ? \`<span class="tag-badge" style="color:var(--cat-labour)" title="Computed from Time & Attendance clock records — hours × hourly rate, allocated to this project">Time & Att.</span>\`
              : \`<span class="tag-badge" style="color:var(--brand)" title="Posted document in SAP Business One (PO / A/P invoice / subcontract)">SAP B1</span>\`;`);
/* ---- 2h. estimate vs firm quote: label the paper for what it was -------- */
// quoted_amount is the historical committed figure; when the driver says it
// was a budgetary estimate, calling it a "quote" contradicts the finding.
mustReplace(
  '${flagged&&t.quoted_amount?` <span class="over-quote">quoted ${fmtSGD(t.quoted_amount)} · +${Math.round((t.amount-t.quoted_amount)/t.quoted_amount*100)}%</span>`:\'\'}',
  '${flagged&&t.quoted_amount?` <span class="over-quote">${t.driver&&t.driver.cause===\'estimate_not_quote\'?\'estimated\':\'quoted\'} ${fmtSGD(t.quoted_amount)} · +${Math.round((t.amount-t.quoted_amount)/t.quoted_amount*100)}%</span>`:\'\'}');
mustReplace(
  '<span class="cause-meta">${ts.length} ${ts.length===1?\'line\':\'lines\'} · ${fmtSGD(total)}${overQ?` · ${fmtSGD(overQ)} above quote`:\'\'}</span>',
  '<span class="cause-meta">${ts.length} ${ts.length===1?\'line\':\'lines\'} · ${fmtSGD(total)}${overQ?` · ${fmtSGD(overQ)} above ${cause===\'estimate_not_quote\'?\'estimate\':\'quote\'}`:\'\'}</span>');
mustReplace(
  "${overQuote ? `${fmtSGD(overQuote)} above the S${'$'}${t.quoted_amount.toLocaleString()} quoted` : 'posted amount'}",
  "${overQuote ? `${fmtSGD(overQuote)} above the S${'$'}${t.quoted_amount.toLocaleString()} ${d.cause==='estimate_not_quote'?'budgetary estimate':'quoted'}` : 'posted amount'}");

/* ---- 2e. red means a stated reason, never a statistical hunch ----------- */
// The mock also flagged any row >60% away from the category average — a pure
// outlier heuristic that painted rows red with no reason shown and nothing to
// click. Retired: a row is red ONLY when it carries a named cost driver or
// sits >15% above its firm quote — both open the driver drawer with the
// arithmetic and the SAP B1 documents behind it.
mustReplace(
  `function isFlagged(t){
  if(t.quoted_amount){ return (t.amount-t.quoted_amount)/t.quoted_amount > 0.15; }
  const avg = txnAverage(t.category, t.project_id || t.resolved_project_id);
  return avg ? Math.abs(t.amount-avg)/avg > 0.6 : false;
}`,
  `function isFlagged(t){
  if(t.driver) return true;
  if(t.quoted_amount){ return (t.amount-t.quoted_amount)/t.quoted_amount > 0.15; }
  return false;
}`);
// the attribution mechanism is retired, so the read-only callout says what is
// actually true of the ledger now
mustReplace(
  `<div class="callout info" style="margin-top:4px">\${iconInfo()}<div><b>Attribution is read-only.</b> Tagged rows carry a project code from SAP B1. The rest are matched here for analysis only — <b>inherited</b> (vendor + date), <b>suggested</b> (keyword), <b>unallocated</b> (site match alone). This workspace cannot write a code back; correcting one is a change a person makes in B1.</div></div>`,
  `<div class="callout info" style="margin-top:4px">\${iconInfo()}<div><b>This ledger is read-only.</b> Cost documents come from <b>SAP Business One</b>; labour lines are computed from <b>Time &amp; Attendance</b> clock records (hours × rate) and allocated to the project. A <span style="color:var(--critical);font-weight:600">red row</span> has a stated reason — a named cost driver or a price above its firm quote — and clicking it opens the arithmetic and the B1 documents behind it. Correcting a posting is a change a person makes in B1.</div></div>`);

/* ---- 2d. bridge tie-out + exact rounding -------------------------------- */
// (1) largest-remainder allocation so the open commitment sums exactly
//     (kills the S$1,079,999 artifact — forecast now reads S$1,080,000);
mustReplace(
  `function forecastOf(pid){
  const commit = openCommitment(pid);
  const budgetSum = CATS.reduce((s,c)=>s+budgetOf(pid,c),0);
  const out = {};
  CATS.forEach(c=>{ out[c] = actualOf(pid,c) + Math.round(commit * (budgetOf(pid,c)/budgetSum)); });
  return out;
}`,
  `function forecastOf(pid){
  const commit = openCommitment(pid);
  const budgetSum = CATS.reduce((s,c)=>s+budgetOf(pid,c),0);
  // largest-remainder rounding: the allocation sums EXACTLY to the commitment
  const rows = CATS.map(c=>{ const x = commit * (budgetOf(pid,c)/budgetSum); return { c, v: Math.floor(x), rem: x - Math.floor(x) }; });
  let left = Math.round(commit - rows.reduce((s,r)=>s+r.v,0));
  rows.slice().sort((a,b)=>b.rem-a.rem).forEach(r=>{ if(left>0){ r.v++; left--; } });
  const out = {};
  rows.forEach(r=>{ out[r.c] = actualOf(pid,r.c) + r.v; });
  return out;
}`);
// (2) the bridge ends now reconcile to the KPI strip: tracked categories
//     + general overheads = the whole-project totals shown above
mustReplace(
  `      <div class="br-ends">
        <span><b class="num">\${fmtSGD(b.from)}</b><em>planned, \${CATS.length} categories</em></span>
        <span class="br-arrow">\${iconArrow()}</span>
        <span class="ra"><b class="num">\${fmtSGD(b.to)}</b><em>\${SNAPSHOTS[pid].final?'final':'forecast'}, \${CATS.length} categories</em></span>
      </div>`,
  `      <div class="br-ends">
        <span><b class="num">\${fmtSGD(b.from)}</b><em>planned, \${CATS.length} tracked categories</em><em style="display:block;margin-top:1px;color:var(--text-faint)">+ \${fmtSGD(tiePlanOH)} overheads = \${fmtSGD(tiePlanTotal)} total plan</em></span>
        <span class="br-arrow">\${iconArrow()}</span>
        <span class="ra"><b class="num">\${fmtSGD(b.to)}</b><em>\${SNAPSHOTS[pid].final?'final':'forecast'}, \${CATS.length} tracked categories</em><em style="display:block;margin-top:1px;color:var(--text-faint)">+ \${fmtSGD(tieRightOH)} overheads = \${fmtSGD(tieRightTotal)} \${SNAPSHOTS[pid].final?'final cost':'forecast final cost'}</em></span>
      </div>`);
mustReplace(
  'function renderBridge(b, pid){\n  const span = Math.max(...b.steps.map(s=>Math.abs(s.impact)), 1);',
  `function renderBridge(b, pid){
  const span = Math.max(...b.steps.map(s=>Math.abs(s.impact)), 1);
  const tieSnap = SNAPSHOTS[pid];
  const tiePlanTotal = budgetTotalCost(pid);
  const tiePlanOH = tiePlanTotal - b.from;
  const tieRightTotal = tieSnap.final ? tieSnap.actual_cost
    : (tieSnap.forecast_final_cost != null ? tieSnap.forecast_final_cost
       : b.to + (tieSnap.actual_cost - CATS.reduce((s,c)=>s+actualOf(pid,c),0)));
  const tieRightOH = tieRightTotal - b.to;`);
// (3) burn-gap gauge explains its own formula on hover
mustReplace(
  `<div class="dg-gauge \${d.gap>0?'over':'under'}"><span class="dg-gap">\${d.gap>0?'+':''}\${d.gap}</span><span class="dg-gap-lbl">pt burn<br/>gap</span></div>`,
  `<div class="dg-gauge \${d.gap>0?'over':'under'}" title="Budget \${d.burnPct}% spent − \${d.donePct}% delivered = \${d.gap>0?'+':''}\${d.gap} points"><span class="dg-gap">\${d.gap>0?'+':''}\${d.gap}</span><span class="dg-gap-lbl">pt burn<br/>gap</span><span class="mono" style="font-size:8.5px;color:var(--text-faint);margin-top:2px">\${d.burnPct}%−\${d.donePct}%</span></div>`);

/* ---- 2c. quote cost-base build-up: who gets paid, for what -------------- */
const buildupFn = `
/* Cost-base build-up — each suggested category amount decomposed into the
   payees behind it: mean of the two reference jobs' actuals scaled to the
   base budget, plus an explicit, reasoned contingency line. */
function renderQuoteBuildup(){
  if(!QUOTE_REQUEST.build_up) return '';
  return CATS.map(c=>{
    const lines = QUOTE_REQUEST.build_up[c]||[];
    const tot = QUOTE_REQUEST.suggested_budget_by_category[c];
    const hasCont = lines.some(l=>l.contingency);
    return \`<details class="qb" style="border:1px solid var(--border);border-radius:3px;margin-bottom:6px;background:var(--surface)">
      <summary style="display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;font-size:12px">
        <span class="cat-tick" style="background:\${catColorVar(c)}"></span>
        <span style="flex:1">\${catLabel(c)}<span class="muted" style="font-size:10.5px"> · \${lines.length} lines</span></span>
        <span class="num" style="font-weight:600">\${fmtSGD(tot)}</span>
      </summary>
      <div style="border-top:1px solid var(--border);padding:5px 10px 9px">
        \${lines.map(l=>\`<div style="display:flex;gap:10px;align-items:baseline;padding:4px 0;border-bottom:1px dashed var(--border);font-size:11.5px">
          <div style="flex:1;min-width:0"><b>\${l.vendor}</b><div class="muted" style="font-size:10.5px">\${l.description}\${l.reason?\` — \${l.reason}\`:''}</div></div>
          <div class="num" style="white-space:nowrap;\${l.contingency?'color:var(--warn);font-weight:600':''}">\${fmtSGD(l.amount)}</div>
        </div>\`).join('')}
        <div class="mono muted" style="font-size:9.5px;margin-top:6px;letter-spacing:.03em">MEAN OF PRJ-002 + PRJ-003 ACTUALS, SCALED TO BASE\${hasCont?' · + REASONED CONTINGENCY':''}</div>
      </div>
    </details>\`;
  }).join('');
}
`;
const dStart = mustIndex(html, 'function renderScreenD(){');
html = html.slice(0, dStart) + buildupFn + '\n' + html.slice(dStart);
mustReplace(
  '<div class="legend"><span><i style="color:var(--text-faint)"></i>Dashed mark = cost before contingency</span></div>',
  '<div class="legend" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">'
  + '<span style="display:inline-flex;align-items:center;gap:6px"><i style="width:15px;height:9px;background:var(--cat-material);border-radius:1px;display:inline-block"></i>Cost scaled from delivered-job actuals</span>'
  + '<span style="display:inline-flex;align-items:center;gap:6px"><i style="width:15px;height:9px;background:repeating-linear-gradient(45deg,var(--warn),var(--warn) 3px,var(--warn-bg) 3px,var(--warn-bg) 6px);border-radius:1px;display:inline-block"></i>Contingency for known overrun patterns</span>'
  + '</div>\n'
  + '        <div class="section-label" style="margin-top:14px">Where the money goes</div>\n'
  + '        ${renderQuoteBuildup()}');

/* ---- 2b. copy tweaks: the answers are no longer scripted ---------------- */
html = html.replace(/Prototype — answers come from a scripted set\.?/g,
  'AI answers are computed from the workspace database.');
html = html.replace('The reply set is scripted, so an unrecognised question says so plainly',
  'Questions go to the AI backend; the scripted engine remains as an offline fallback that says so plainly');

/* ---- 3. wrap in a proper document + load bootstrap data ----------------- */
const scriptTag = mustIndex(html, '<script>');
html = html.slice(0, scriptTag)
  + '<script src="api/bootstrap.js"></script>\n'
  + html.slice(scriptTag);

const styleEnd = mustIndex(html, '</style>') + '</style>'.length;
const favicon = '<link rel="icon" href="data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%231F3A5F" stroke-width="1.5"><circle cx="12" cy="12" r="8.5"/><path d="M14.6 9.4l-2.3 4.1-4.1 2.3 2.3-4.1 4.1-2.3z" fill="%231F3A5F" stroke="none"/></svg>'
).replace(/%25/g, '%') + '"/>';
html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8"/>\n'
  + '<meta name="viewport" content="width=device-width, initial-scale=1"/>\n'
  + favicon + '\n'
  + html.slice(0, styleEnd) + '\n</head>\n<body>'
  + html.slice(styleEnd)
  + '\n</body>\n</html>\n';

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
