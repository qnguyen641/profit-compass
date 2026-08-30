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
  html = html.replace(needle, replacement);
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
  '<div class="legend"><span><i style="color:var(--text-faint)"></i>Dashed mark = cost before contingency</span></div>\n'
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
