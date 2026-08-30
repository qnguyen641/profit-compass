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
  else if(key==='plan-match') askBackend('Which project landed closest to its planned margin, and which missed its plan by the most?');
  else if(key==='prj1-profit') askBackend('How profitable is the Orchard Road Christmas project?', { after:()=>{ state.chatFollowupReady = true; renderChatTab(); } });
  else if(key==='this-project') askBackend('How did ' + project(state.selectedProject).name + ' do?');
  else if(key==='forecast-why') askBackend('What is the forecast final margin for ' + project(state.selectedProject).name + ', and what is driving it?');
  else if(key==='follow-why'){ state.chatFollowupReady = false; askBackend('Why is the forecast margin lower than target?'); }
  else if(key==='quote-ref-labour') askBackend('Compare what labour actually cost on Orchard Road Christmas 2025 and Gardens by the Bay Festive 2025, and why it overran on both.');
  else if(key==='quote-why-cont') askBackend('Why does the CNY 2027 quote carry labour and subcontractor contingencies, and how large are they?');
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
  "searchTimers.push(setTimeout(()=>{ state.quoteSearched = true; quoteRunning = false; render(); }, rows.length*RUN + 340));");
mustReplace(
  "if(reduce){ rows.forEach(r=>r.classList.add('done')); wrap.classList.add('revealed'); state.quoteSearched = true; return; }",
  "if(reduce){ state.quoteSearched = true; quoteRunning = false; render(); return; }");
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
  // the quote's core output is what the tool actually knows: the COST.
  // price options come below, anchored to history, not from a free lever.
  const headline =
    '<div style="margin-bottom:13px;padding-bottom:12px;border-bottom:1px solid var(--border)">'
    + '<div class="num" id="quoteHeadVal" style="font-family:var(--font-display);font-size:27px;font-weight:700;letter-spacing:-.01em">${fmtSGD(costBaseForMargin())}</div>'
    + '<div class="mono" style="font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--text-faint);margin-top:2px">Estimated cost to deliver · contingencies included · from ${QUOTE_REQUEST.reference_project_ids.length} delivered jobs</div>'
    + '</div>\n        ';
  const placeholder =
    '<div class="empty-note" style="padding:30px 16px;text-align:center;line-height:1.6">'
    + '${quoteRunning ? `Searching delivered jobs…` : `No quote yet.<br/>Press <b>Generate quote</b> — '
    + 'the estimate is built category by category from the actuals of your delivered jobs.`}'
    + '</div>';
  html = html.slice(0, cs) + '${done ? `' + headline + content + '` : `' + placeholder + '`}' + html.slice(ce);
}
// (setMargin stays as dead code — the margin inputs it served are gone)

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

/* ---- 2f5. margin as anchored pricing options + a real draft action ------ */
// The quote's core output is the COST estimate (that's what the tool knows).
// The margin lever and the cut-plan mode are gone: margin is chosen from a
// ladder of price points anchored to what this company planned and actually
// delivered, and the approve button performs a REAL write — a draft
// quotation into the B1 pipeline (POST api/quotes), revisioned and shown.
mustReplace(
  'let quoteMarginPct = QUOTE_REQUEST.target_margin_pct_default;',
  `let quoteMarginPct = QUOTE_REQUEST.target_margin_pct_default;
let quoteRunning = false;
const QUOTE_DRAFTS = (__DATA__.QUOTE_DRAFTS || []);
const MARGIN_ANCHORS = [
  { m:30, note:'the plan on both reference jobs — neither delivered it' },
  { m:28, note:'the reference failure patterns are already priced into the cost as contingency', rec:true },
  { m:26, note:'best margin actually delivered (Gardens by the Bay Festive 2025)' },
  { m:24, note:'worst delivered (Orchard Road Christmas 2025)' },
];
function quotePrice(m){ return Math.round(costBaseForMargin()/(1-m/100)); }
function renderMarginLadder(){
  const base = costBaseForMargin();
  const anchors = MARGIN_ANCHORS.map(a=>{
    const price = quotePrice(a.m);
    const sel = Math.abs(quoteMarginPct-a.m)<0.001;
    return \`<button class="ml-row" data-margin="\${a.m}" style="display:grid;grid-template-columns:56px 1fr;gap:2px 12px;width:100%;text-align:left;padding:8px 10px;border:1px solid \${sel?'var(--brand)':'var(--border)'};background:\${sel?'var(--brand-bg)':'var(--surface)'};border-radius:3px;cursor:pointer;margin-bottom:6px;font-family:inherit;color:inherit">
      <span class="num" style="font-weight:700;font-size:15px;\${sel?'color:var(--brand-ink)':''}">\${a.m}%</span>
      <span style="display:flex;justify-content:space-between;gap:10px;align-items:baseline"><span class="num" style="font-weight:600;font-size:13px">\${fmtSGD(price)}</span><span class="num" style="font-size:11px;color:var(--text-muted)">profit \${fmtSGD(price-base)}</span></span>
      <span></span><span style="font-size:10.5px;color:var(--text-muted)">\${a.note}\${a.rec?' · <b>recommended</b>':''}</span>
    </button>\`;
  }).join('');
  const isCustom = !MARGIN_ANCHORS.some(a=>Math.abs(a.m-quoteMarginPct)<0.001);
  return anchors + \`<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px dashed \${isCustom?'var(--brand)':'var(--border)'};border-radius:3px;\${isCustom?'background:var(--brand-bg);':''}">
      <span class="mono" style="font-size:9px;letter-spacing:.08em;color:var(--text-faint)">CUSTOM</span>
      <input type="number" id="customMarginInput" min="5" max="60" step="0.5" value="\${isCustom?quoteMarginPct:''}" placeholder="—" style="width:64px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface);color:var(--text);font-family:var(--font-mono);font-size:12px;text-align:right"/>
      <span style="font-size:11px;color:var(--text-muted)">%</span>
      <span class="num" id="customMarginOut" style="font-size:11.5px;margin-left:auto">\${isCustom?fmtSGD(quotePrice(quoteMarginPct)):''}</span>
    </div>\`;
}`);
// form: the margin inputs leave the request card — pricing lives in the quote
mustReplace(
  `        <div class="field">
          <label>Target margin</label>
          <div class="margin-input">
            <input type="number" id="marginInput" value="\${quoteMarginPct}" min="5" max="60" step="0.5" />
            <span class="mi-unit">%</span>
          </div>
          <input type="range" min="10" max="45" step="0.5" value="\${quoteMarginPct}" id="marginSlider" style="width:100%;margin-top:10px;accent-color:var(--brand)"/>
          <div class="mi-scale"><span>10%</span><span>45%</span></div>
        </div>
`, '');
// the formula box becomes the pricing ladder + the arithmetic of the selection
mustReplace(
  `        <div class="formula-box">
          cost base ÷ (1 − target margin)<br/>
          = \${fmtSGD(costBase)} ÷ (1 − <span id="marginEcho">\${quoteMarginPct}</span>%)
          <div class="f-result num" id="contractValOut">\${fmtSGD(contractVal)}</div>
        </div>`,
  `        <div class="section-label" style="margin-top:14px">Pricing — margin anchored to your history</div>
        \${renderMarginLadder()}
        <div class="formula-box" style="margin-top:10px">
          price = cost \${fmtSGD(costBase)} ÷ (1 − <span id="marginEcho">\${quoteMarginPct}</span>%)
          <div class="f-result num" id="contractValOut">\${fmtSGD(quotePrice(quoteMarginPct))}</div>
        </div>`);
// the static "send to Sales" button becomes a real write: draft into B1
mustReplace(
  `        <button class="btn primary" style="width:100%;justify-content:center;margin-top:14px" id="approveQuoteBtn">Approve &amp; send to Sales</button>
        <div class="footer-note">Drafted from historical evidence. Review before sending.</div>`,
  `        \${(()=>{ const price = quotePrice(quoteMarginPct);
          const last = QUOTE_DRAFTS.length ? QUOTE_DRAFTS[QUOTE_DRAFTS.length-1] : null;
          return \`
        <button class="btn primary" style="width:100%;justify-content:center;margin-top:14px" id="approveQuoteBtn">\${iconFile()} Create draft quotation in B1 — \${fmtSGD(price)} at \${quoteMarginPct}%\${last?\` (rev \${last.rev+1})\`:''}</button>
        \${last?\`<div class="mono" style="font-size:9.5px;color:var(--good);margin-top:8px;display:flex;gap:6px;align-items:center;letter-spacing:.04em"><span style="width:13px;height:13px;display:inline-flex;flex-shrink:0">\${iconCheck()}</span>DRAFT \${last.qr_id} REV \${last.rev} IN PIPELINE · \${fmtSGD(last.contract_value)} AT \${last.margin_pct}% · \${timeAgo(new Date(last.created_at).getTime())}</div>\`:''}
        <div class="footer-note">Writes a <b>draft</b> quotation into the SAP B1 pipeline — the one write this workspace performs, only on this click. Approving and sending it stays with a person in B1.</div>\`;})()}`);
// bindings: ladder rows, custom margin, and the real draft POST
mustReplace(
  `  if(mInput){
    mInput.addEventListener('input', e=>setMargin(e.target.value,'input'));
    mInput.addEventListener('blur',  e=>setMargin(e.target.value,'blur'));
  }`,
  `  document.querySelectorAll('.ml-row').forEach(el=>el.addEventListener('click', ()=>{
    quoteMarginPct = parseFloat(el.dataset.margin); render();
  }));
  const cmi = document.getElementById('customMarginInput');
  if(cmi){
    cmi.addEventListener('input', e=>{
      const n = parseFloat(e.target.value);
      const out = document.getElementById('customMarginOut');
      if(out) out.textContent = (!isNaN(n) && n>=5 && n<=60) ? fmtSGD(quotePrice(n)) : '';
    });
    cmi.addEventListener('change', e=>{
      const n = parseFloat(e.target.value);
      if(!isNaN(n) && n>=5 && n<=60){ quoteMarginPct = n; render(); }
    });
  }`);
mustReplace(
  `  const appr = document.getElementById('approveQuoteBtn');
  if(appr) appr.addEventListener('click', ()=>{
    toast('Prototype — nothing was sent. Creating a draft quotation is the one thing this workspace writes to SAP Business One, and only a person can trigger it.', { icon: iconCompass('currentColor') });
    logActivity(\`Draft quote for <b>Gardens by the Bay CNY 2027</b> approved at \${quoteMarginPct}% target margin (S$\${Math.round(suggestedContractValue(quoteMarginPct)).toLocaleString()}) — sent for human review.\`, iconFile());
  });`,
  `  const appr = document.getElementById('approveQuoteBtn');
  if(appr) appr.addEventListener('click', async ()=>{
    appr.disabled = true;
    try{
      const price = quotePrice(quoteMarginPct);
      const r = await fetch('api/quotes', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ margin_pct: quoteMarginPct, contract_value: price, cost_base: costBaseForMargin() }) });
      if(!r.ok) throw new Error('HTTP '+r.status);
      const d = await r.json();
      QUOTE_DRAFTS.push(d);
      logActivity(\`Draft quotation <b>\${d.qr_id} rev \${d.rev}</b> created in the B1 pipeline — \${fmtSGD(d.contract_value)} at \${d.margin_pct}% margin.\`, iconFile());
      toast(\`Draft \${d.qr_id} rev \${d.rev} written to the SAP B1 pipeline (simulated). A person approves and sends it from B1.\`, { icon: iconCheck() });
      render();
    }catch(e){
      toast('Could not reach the backend — no draft was created.', { icon: iconAlert() });
      appr.disabled = false;
    }
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
  `const OPEN_COMMITMENTS = __DATA__.OPEN_COMMITMENTS || [];
function openCommitmentsFor(pid){ return OPEN_COMMITMENTS.filter(c=>c.project_id===pid); }
function forecastOf(pid){
  const actualBase = {};
  const itemised = openCommitmentsFor(pid);
  if(itemised.length){
    // itemised: each commitment lands in its own category — no pro-rata
    const out = {};
    CATS.forEach(c=>out[c]=actualOf(pid,c));
    itemised.forEach(r=>{ out[r.category] += r.amount; });
    return out;
  }
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

/* ---- 2i. final flow polish: evidence appears AFTER the run -------------- */
// (a) right column is empty until Generate is pressed: the scan rows render
//     only while running or done, and the evidence cards only when done
mustReplace(
  `          <ul class="scan-list" id="scanList">\${scanRows}</ul>
          <div class="scan-result" id="scanResult">
            Matched <b>\${QUOTE_REQUEST.reference_project_ids.length} of \${cands.length}</b> past jobs on project type and scope. Their overrun patterns are priced into the quote on the left.
          </div>
        </section>
        <div class="qresult">
          <div class="section-label">Evidence — the jobs this price is built on</div>
          <div class="ref-grid">\${refCards}</div>
        </div>`,
  `          \${(done||quoteRunning)?\`<ul class="scan-list" id="scanList">\${scanRows}</ul>
          <div class="scan-result" id="scanResult">
            Matched <b>\${QUOTE_REQUEST.reference_project_ids.length} of \${cands.length}</b> past jobs on project type and scope. Their overrun patterns are priced into the quote on the left.
          </div>\`:\`<div class="empty-note" style="padding:16px 12px">Nothing searched yet. Press <b>Generate quote</b> — the pipeline scans your delivered jobs and its evidence appears here.</div>\`}
        </section>
        \${done?\`<div class="qresult">
          <div class="section-label">Evidence — the jobs this price is built on</div>
          <div class="ref-grid">\${refCards}</div>
        </div>\`:''}`);
// (b) Generate first re-renders into the running state, then plays the scan
mustReplace(
  "  const runSearch = document.getElementById('runSearchBtn');\n  if(runSearch) runSearch.addEventListener('click', ()=>{ state.quoteSearched=false; playQuoteSearch(); });",
  "  const runSearch = document.getElementById('runSearchBtn');\n  if(runSearch) runSearch.addEventListener('click', ()=>{ state.quoteSearched=false; quoteRunning=true; render(); setTimeout(playQuoteSearch, 60); });");
// (c) hide the 'New Quote' card — the quoting job in the pipeline (PRJ-005)
//     is the entry point; creating brand-new quotes isn't designed yet
mustReplace('${(state.portfolioFilter===\'all\'&&!q)?newQuoteCard:\'\'}', '');
// (d) chat during quoting: the history is exactly what's worth asking about
mustReplace(
  `  if(state.screen==='D'){
    body.innerHTML = \`<div class="empty-note">This quote isn't contracted yet, so there are no actuals to ask about. Approve it to start tracking.</div>\`;
    suggest.innerHTML = ''; return;
  }`,
  `  if(state.screen==='D' && !state.chatLog.length){
    body.innerHTML = \`
      <div class="chat-intro">
        <div class="ci-mark">\${aiMark()}<span>Synthesis</span></div>
        <p>This quote isn't contracted yet — but the history behind it is. Ask what <b>the reference jobs</b> spent on any category, transaction by transaction, or why this draft carries the contingencies it does.</p>
        <div class="ci-sources">
          <span><span class="sc-dot" style="background:var(--brand)"></span>SAP Business One</span>
          <span><span class="sc-dot" style="background:var(--cat-labour)"></span>Time &amp; Attendance</span>
        </div>
      </div>\`;
    suggest.innerHTML = \`<button class="chat-chip" data-suggest="quote-ref-labour">What did labour really cost on the reference jobs?</button>\`
      + \`<button class="chat-chip" data-suggest="quote-why-cont">Why the contingencies in this quote?</button>\`;
    return;
  }`);
// (e) per-screen suggested questions match the agreed scopes
mustReplace(
  `    suggest.innerHTML = (state.screen==='B' && hasAnalytics(state.selectedProject)
        ? (state.selectedProject==='PRJ-001'
            ? \`<button class="chat-chip" data-suggest="prj1-profit">How profitable is this project?</button>\`
            : \`<button class="chat-chip" data-suggest="this-project">How did this project do?</button>\`)
        : \`<button class="chat-chip" data-suggest="portfolio-risk">Which project is most at risk?</button>\`)
      + \`<button class="chat-chip" data-suggest="best-ever">Best margin we've ever made?</button>\`;`,
  `    suggest.innerHTML = (state.screen==='B' && hasAnalytics(state.selectedProject)
        ? (state.selectedProject==='PRJ-001'
            ? \`<button class="chat-chip" data-suggest="prj1-profit">How profitable is this project?</button>\`
            : \`<button class="chat-chip" data-suggest="this-project">How did this project do?</button>\`)
          + (!SNAPSHOTS[state.selectedProject].final ? \`<button class="chat-chip" data-suggest="forecast-why">What's the forecast, and why?</button>\` : '')
        : \`<button class="chat-chip" data-suggest="portfolio-risk">Which project is most at risk?</button>\`
          + \`<button class="chat-chip" data-suggest="plan-match">Who landed closest to plan?</button>\`)
      + \`<button class="chat-chip" data-suggest="best-ever">Best margin we've ever made?</button>\`;`);

/* ---- 2j. diagnosis knows a front-loaded job from an overrun ------------- */
// PRJ-004 read "101% spent against 45% delivered" while wearing a HEALTHY
// badge — because burn-vs-progress assumes spend tracks delivery linearly.
// When the gap is wide but the forecast holds within 2.5pts of plan and no
// high alert is open, the verdict now tells the true story: cost committed
// up front, judged against forecast final cost, with the remaining spend
// named as the thing to hold.
mustReplace(
  `  } else {
    verdict = \`<b>\${worst.label}</b> is the largest leak at \${fmtSGD(worst.impact)}\`
      + (b.commit>0 ? \`, and a further \${fmtSGD(b.commit)} is committed but not yet billed\` : '')
      + \`. Budget is \${burnPct}% spent against \${donePct}% delivered.\`;
  }`,
  `  } else {
    const fcCost = snap.forecast_final_cost != null ? snap.forecast_final_cost
      : (snap.forecast_final_margin_pct != null ? Math.round(snap.revenue*(1-snap.forecast_final_margin_pct/100)) : null);
    const fBurn = fcCost ? Math.round(snap.actual_cost/fcCost*100) : null;
    const highAlert = RISK_ALERTS.some(r=>r.project_id===pid && r.status==='open' && r.severity==='high');
    if(burnPct - donePct > 25 && marginDrop <= 2.5 && !highAlert){
      verdict = \`Front-loaded, not overrun: \${fBurn??burnPct}% of the forecast final cost is already committed at \${donePct}% delivered — this job buys its materials and subcontracts up front. Forecast margin \${pct(finalPct)} against a \${pct(snap.budget_margin_pct)} plan\${worst?\`; <b>\${worst.label}</b> is the only tracked pressure at \${fmtSGD(worst.impact)}\`:''}.\`;
    } else {
      verdict = \`<b>\${worst.label}</b> is the largest leak at \${fmtSGD(worst.impact)}\`
        + (b.commit>0 ? \`, and a further \${fmtSGD(b.commit)} is committed but not yet billed\` : '')
        + \`. Budget is \${burnPct}% spent against \${donePct}% delivered.\`;
    }
  }`);

/* ---- 2k. phase-spend chart for every project with a ledger -------------- */
// The mock hard-gated the lifecycle bar chart to PRJ-001 (only it had rows
// then). Every project now carries a full ledger, so the chart renders for
// all of them — completed jobs show all phases as delivered.
mustReplace(
  `  let phaseBlock = '';
  if(pid==='PRJ-001'){
    const phases = LIFECYCLE_STAGES;
    const maxPhase = Math.max(...phases.map(ph=>SPEND_BY_PHASE[ph]||0));
    const curIdx = phases.indexOf(p.lifecycle_stage);`,
  `  let phaseBlock = '';
  const phaseSpend = (()=>{ const o={}; LIFECYCLE_STAGES.forEach(x=>o[x]=0);
    TRANSACTIONS.filter(t=>t.project_id===pid||t.resolved_project_id===pid)
      .forEach(t=>{ o[t.phase]=(o[t.phase]||0)+t.amount; }); return o; })();
  if(LIFECYCLE_STAGES.some(x=>phaseSpend[x]>0)){
    const phases = LIFECYCLE_STAGES;
    const maxPhase = Math.max(...phases.map(ph=>phaseSpend[ph]||0));
    const curIdx = d.isFinal ? phases.length : phases.indexOf(p.lifecycle_stage);`);
mustReplace(
  `        const amt = SPEND_BY_PHASE[ph]||0;`,
  `        const amt = phaseSpend[ph]||0;`);
mustReplace(
  `      <div class="phase-legend"><span class="pl-cur"></span>Current phase · bar height = spend recorded in that phase</div>`,
  `      <div class="phase-legend">\${d.isFinal?'All phases delivered · bar height = spend recorded in that phase':'<span class="pl-cur"></span>Current phase · bar height = spend recorded in that phase'}</div>`);
// burn rows name their denominator: 101% is of the PLANNED cost, and the
// note also states how much of the FORECAST final cost is already in
mustReplace('<span class="burn-k">Budget spent</span>', '<span class="burn-k">Planned cost spent</span>');
mustReplace(
  "    : `\${fmtSGD(snap.actual_cost)} of \${fmtSGD(budgetCost)} planned cost is committed with \${100-d.donePct}% of the job still to deliver.`;",
  `    : (()=>{ const fcCost = snap.forecast_final_cost != null ? snap.forecast_final_cost
        : (snap.forecast_final_margin_pct != null ? Math.round(snap.revenue*(1-snap.forecast_final_margin_pct/100)) : null);
      const fb = fcCost ? Math.round(snap.actual_cost/fcCost*100) : null;
      return \`\${fmtSGD(snap.actual_cost)} of \${fmtSGD(budgetCost)} planned cost is committed with \${100-d.donePct}% of the job still to deliver\`
        + (fcCost ? \` — and \${fb}% of the \${fmtSGD(fcCost)} forecast final cost.\` : '.'); })();`);

/* ---- 2l. the plan in dollars is first-class; stage is a progress bar ---- */
// (a) the KPI strip carried the plan only as a margin footnote — the planned
//     cost (S$285,600 for PRJ-004) never appeared anywhere as money. Now
//     Actual cost and Profit each show their planned value, so the chain
//     plan -> actual -> forecast is complete on the strip itself.
mustReplace(
  `<div class="kpi"><div class="lbl">\${isFinal?'Final cost':'Actual cost'}</div><div class="val num">\${fmtSGD(snap.actual_cost)}</div><div class="sub">\${txnCount?txnCount+' txns + payroll':'ledger total'}</div></div>
      <div class="kpi"><div class="lbl">Profit</div><div class="val num">\${fmtSGD(snap.profit)}</div><div class="sub">revenue − cost</div></div>`,
  `<div class="kpi"><div class="lbl">\${isFinal?'Final cost':'Actual cost'}</div><div class="val num">\${fmtSGD(snap.actual_cost)}</div><div class="sub">plan \${fmtSGD(budgetTotalCost(pid))} · \${txnCount?txnCount+' txns + payroll':'ledger'}</div></div>
      <div class="kpi"><div class="lbl">Profit</div><div class="val num">\${fmtSGD(snap.profit)}</div><div class="sub">plan \${fmtSGD(snap.revenue - budgetTotalCost(pid))} · revenue − cost</div></div>`);
// (b) lifecycle stage as a segmented progress bar at the top of the
//     Progress panel: past stages filled, current highlighted, future empty;
//     a delivered job shows every segment filled
mustReplace(
  `      <div class="section-label">\${d.isFinal?'Delivered against plan':'Progress against burn'}</div>
      <div class="burn">`,
  `      <div class="section-label">\${d.isFinal?'Delivered against plan':'Progress against burn'}</div>
      <div style="display:flex;gap:3px;margin-bottom:14px">\${LIFECYCLE_STAGES.map((ph,i)=>{
        const cur = d.isFinal ? LIFECYCLE_STAGES.length : LIFECYCLE_STAGES.indexOf(p.lifecycle_stage);
        const st = i<cur ? 'past' : i===cur ? 'current' : 'future';
        const bar = st==='past' ? 'background:var(--brand);opacity:.35' : st==='current' ? 'background:var(--brand)' : 'background:var(--surface-2);border:1px solid var(--border)';
        const lbl = st==='current' ? 'color:var(--brand-ink);font-weight:700' : st==='past' ? 'color:var(--text-muted)' : 'color:var(--text-faint)';
        return \`<div style="flex:1;min-width:0" title="\${catLabel(ph)}\${st==='current'?' — current stage':st==='past'?' — done':''}">
          <div style="height:6px;border-radius:2px;\${bar}"></div>
          <div class="mono" style="font-size:8.5px;letter-spacing:.04em;text-transform:uppercase;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\${lbl}">\${ph}</div>
        </div>\`;
      }).join('')}</div>
      <div class="burn">`);

/* ---- 2m. "Committed, not yet billed" is inspectable --------------------- */
// The one bar with no drill-down becomes clickable: a drawer lists every
// commitment (open POs, bookings, approved crew rosters) with vendor,
// category, due date and amount. openCommitment prefers the itemised sum.
mustReplace(
  `function openCommitment(pid){
  if(pid==='PRJ-001') return OPEN_PO_TOTAL;
  const s = SNAPSHOTS[pid];
  if(s.final || s.forecast_final_margin_pct===undefined) return 0;
  return Math.max(0, Math.round(s.revenue*(1 - s.forecast_final_margin_pct/100)) - s.actual_cost);
}`,
  `function openCommitment(pid){
  const itemised = OPEN_COMMITMENTS.filter(c=>c.project_id===pid);
  if(itemised.length) return itemised.reduce((s,r)=>s+r.amount,0);
  const s = SNAPSHOTS[pid];
  if(s.final || s.forecast_final_margin_pct===undefined) return 0;
  return Math.max(0, Math.round(s.revenue*(1 - s.forecast_final_margin_pct/100)) - s.actual_cost);
}`);
mustReplace(
  '    return `<div class="br-row${s.cat?\' clickable\':\'\'}" ${s.cat?`data-drill-category="${s.cat}"`:\'\'}>',
  '    return `<div class="br-row${(s.cat||s.key===\'open_po\')?\' clickable\':\'\'}" ${s.cat?`data-drill-category="${s.cat}"`:\'\'}${s.key===\'open_po\'?` data-open-commitments="${pid}" title="Inspect the open commitments"`:\'\'}>');
mustReplace(
  "  document.querySelectorAll('[data-drill-category]').forEach(el=>el.addEventListener('click', ()=> openDrilldown(el.dataset.drillCategory)));",
  "  document.querySelectorAll('[data-drill-category]').forEach(el=>el.addEventListener('click', ()=> openDrilldown(el.dataset.drillCategory)));\n"
  + "  document.querySelectorAll('[data-open-commitments]').forEach(el=>el.addEventListener('click', ()=> openCommitmentsDrawer(el.dataset.openCommitments)));");
{
  const drawerFn = `
/* COMMITMENTS DRAWER — the money that is coming but not yet invoiced. */
function openCommitmentsDrawer(pid){
  const rows = openCommitmentsFor(pid);
  const total = rows.length ? rows.reduce((s,r)=>s+r.amount,0) : openCommitment(pid);
  const KIND_LBL = { open_po:'Open PO', booking:'Booking', crew_roster:'Crew roster' };
  state.alertOpen = 'commit:'+pid;
  const dr = document.getElementById('alertDrawer');
  dr.innerHTML = \`
    <div class="ad-head">
      <button class="icon-btn" id="adClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button>
      <span class="a-sev" style="color:var(--warn-ink);background:var(--warn-bg);border-color:var(--warn)">Committed</span>
      <span class="ad-id">\${pid}</span>
    </div>
    <div class="ad-body">
      <h2 class="ad-title">Committed, not yet billed</h2>
      <div class="ad-impact"><span class="adi-v num">\${fmtSGD(total)}</span><span class="adi-k">will land on cost — no invoice posted yet</span></div>
      <section class="ad-sec">
        <div class="section-label">What sits in this bucket</div>
        <p class="ad-p">Money the project is already contractually holding: purchase orders placed but not yet received or invoiced, bookings signed for later phases, and crew rosters approved in Time &amp; Attendance but not yet worked. None of it is in actuals; all of it is coming — the forecast counts it as spent, because avoiding it would mean cancelling orders.</p>
      </section>
      \${rows.length?\`<section class="ad-sec">
        <div class="section-label">The \${rows.length} commitments</div>
        <div class="doc-list">
        \${rows.map(r=>\`<div class="doc-row">
          <span class="doc-type">\${KIND_LBL[r.kind]||r.kind}</span>
          <span class="doc-ref">\${r.doc_ref}</span>
          <span class="doc-note"><b>\${r.vendor}</b> — \${r.description}<br/><span class="mono" style="font-size:9px;letter-spacing:.05em;color:var(--text-faint)"><span class="cat-tick" style="background:\${catColorVar(r.category)};width:6px;height:6px;display:inline-block;margin-right:4px"></span>\${catLabel(r.category).toUpperCase()} · DUE \${r.due_date} · <b class="num" style="color:var(--text)">\${fmtSGD(r.amount)}</b></span></span>
        </div>\`).join('')}
        </div>
        <p class="ad-fine">Each line is allocated to its own category in the forecast column — no pro-rata spreading. Read-only references; the documents live in SAP Business One and the T&amp;A roster.</p>
      </section>\`:\`<section class="ad-sec"><p class="ad-p">No itemised commitments on file for this project — the figure is derived from the forecast model (forecast final cost − actuals to date).</p></section>\`}
    </div>\`;
  document.getElementById('alertScrim').classList.add('open');
  dr.classList.add('open');
  document.getElementById('adClose').addEventListener('click', closeAlertDrawer);
}
`;
  const at = mustIndex(html, '/* =========================================================================\n   COST DRIVER DRAWER');
  html = html.slice(0, at) + drawerFn + '\n' + html.slice(at);
}

/* ---- 2n. bell removed (for now): issues live on their projects ---------- */
// Alerts already surface where they belong — each project's OPEN ISSUES band
// and its portfolio badge. The cross-portfolio bell is hidden, not deleted,
// so its plumbing stays intact if it earns its way back.
mustReplace('      <div class="notif-wrap">', '      <div class="notif-wrap" hidden style="display:none">');

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
