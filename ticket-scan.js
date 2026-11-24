/* Ticket photos are processed locally. Details and played marks are saved only after confirmation. */
function parseTicketLines(text) {
  return text.split(/\r?\n/).map(line => {
    const cleaned = line.trim().replace(/^[A-Z][.):\s]+/i, '').replace(/\s+(?:LP|QP)\s*$/i, '');
    if (!/^\d{1,2}(?:[\s,;\-]+\d{1,2}){5}$/.test(cleaned)) return null;
    const numbers = cleaned.split(/[\s,;\-]+/).map(Number);
    return new Set(numbers).size === 6 && numbers.every(n => n >= 1 && n <= 58) ? numbers : null;
  }).filter(Boolean);
}
function ticketDates(text) {
  const dates = new Set();
  function add(y,m,d) {
    y=Number(y);m=Number(m);d=Number(d);if(y<100)y+=2000;
    const date=new Date(Date.UTC(y,m-1,d));
    if(y>=2000&&y<=2099&&date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d) dates.add(y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'));
  }
  for(const match of text.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g))add(match[1],match[2],match[3]);
  for(const match of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/g)) {
    const a=Number(match[1]),b=Number(match[2]);
    // Month-first numeric tickets; unambiguous day-first dates also accepted.
    add(match[3],a>12?b:a,a>12?a:b);
  }
  const months='JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
  for(const match of text.toUpperCase().matchAll(/\b(\d{1,2})[\s\-/]+([A-Z]{3,9})[\s,\-/]+(20\d{2}|\d{2})\b/g))add(match[3],months.indexOf(match[2].slice(0,3))+1,match[1]);
  for(const match of text.toUpperCase().matchAll(/\b([A-Z]{3,9})[\s\-/]+(\d{1,2})[\s,\-/]+(20\d{2}|\d{2})\b/g))add(match[3],months.indexOf(match[1].slice(0,3))+1,match[2]);
  return [...dates];
}
function parseTicketMetadata(text) {
  // The game is above the lettered pick rows in the upper ticket header.
  const header=text.split(/^\s*[A-Z]\s*[:.)]\s*\d/m)[0];
  const games=new Set([...header.matchAll(/\b6\s*[/\-]\s*(42|45|49|55|58)\b/g)].map(m=>m[1]));
  const names={ULTRA:'58',GRAND:'55',SUPER:'49',MEGA:'45'};
  for(const [name,max] of Object.entries(names))if(new RegExp('\\b'+name+'\\s+LOTTO\\b','i').test(header))games.add(max);
  const dates=[...new Set(text.split(/\r?\n/).filter(line=>/^\s*DRAW\b/i.test(line)).flatMap(ticketDates))];
  return {game:games.size===1?[...games][0]:'',date:dates.length===1?dates[0]:'',multipleDates:dates.length>1};
}
function parseLabelledPicks(text) {
  return text.split(/\r?\n/).flatMap(line=>{
    const m=/^\s*([A-Z])\s*[:.)]\s*(.*)$/i.exec(line);
    if(!m)return [];
    const parsed=parseTicketLines(m[2]);
    return parsed.length?[{label:m[1].toUpperCase(),numbers:parsed[0]}]:[];
  });
}
function decodeScannedTicket(key) {
  const m=/^pcso-ticket:v1:(\d{4}-\d{2}-\d{2}):(42|45|49|55|58):(.+)$/.exec(key);
  if(!m||ticketDates(m[1])[0]!==m[1])return null;
  const rows=m[3].split('_');if(rows.length>26)return null;
  const labels=new Set(),picks=[];
  for(const row of rows){const p=/^([A-Z])=(\d+(?:-\d+){5})$/.exec(row);if(!p||labels.has(p[1]))return null;
    const numbers=p[2].split('-').map(Number);if(new Set(numbers).size!==6||numbers.some(n=>n<1||n>Number(m[2])))return null;
    labels.add(p[1]);picks.push({label:p[1],numbers});}
  return {date:m[1],maximum:Number(m[2]),picks};
}
function scannedTickets() {
  const records=[];try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key.startsWith('pcso-ticket:v1:')||localStorage.getItem(key)!=='1')continue;const ticket=decodeScannedTicket(key);if(ticket)records.push(ticket);}}catch{}
  return records.sort((a,b)=>b.date.localeCompare(a.date)||b.maximum-a.maximum);
}
function isScannedMark(key){return scannedTickets().some(t=>t.picks.some(p=>playedKey(t.date,t.maximum,p.numbers)===key));}
function assessScanQuality(text, confidence, maximum, words=[]) {
  const rows=text.split(/\r?\n/).filter(line=>/^\s*[A-Z]\s*[:.)]/i.test(line));
  const picks=parseLabelledPicks(text),labels=rows.map(line=>/^\s*([A-Z])/i.exec(line)[1].toUpperCase());
  const problems=[];
  const metadata=parseTicketMetadata(text);
  if(!metadata.game)problems.push('Game not detected');
  if(!metadata.date)problems.push('DRAW date not detected or ambiguous');
  if(!picks.length)problems.push('No complete number rows detected');
  if(rows.length!==picks.length)problems.push('One or more rows have unreadable, missing or repeated numbers');
  if(new Set(labels).size!==labels.length)problems.push('Repeated row letters detected');
  const sorted=[...new Set(labels)].sort();
  if(sorted.some((label,i)=>label!==String.fromCharCode(65+i)))problems.push('A row may be missing');
  if(maximum&&picks.some(p=>p.numbers.some(n=>n>maximum)))problems.push('A number is outside the game range');
  const numericWords=words.filter(w=>/^\d{1,2}$/.test(w.text||''));
  if(!Number.isFinite(confidence)||confidence<80||numericWords.some(w=>Number(w.confidence)<75))problems.push('Some text or numbers may be unclear');
  return {clear:!problems.length,rows:picks.length,message:problems.length?problems.join('. ')+'. Retake, edit, or save details.':picks.length+' complete row(s) detected with good text confidence. Check every number and make sure no rows were missed.'};
}
function scanRetakeAdvice(text, technical=false){
  if(technical)return 'The photo could not be processed. Check your internet connection, then retake or upload a JPG or PNG photo.';
  const metadata=parseTicketMetadata(text),rows=parseLabelledPicks(text),tips=[];
  if(!rows.length)tips.push('Numbers were not detected. Move closer while keeping every A:, B:, C: row visible.');
  else tips.push('Some details need correction. Keep all number rows inside the photo.');
  if(!metadata.game)tips.push('Include the game name and 6/number logo at the top.');
  if(!metadata.date)tips.push('Include the full line labeled DRAW.');
  tips.push('Tap the ticket on your phone camera to focus. Hold steady, use good light and avoid glare. If the letters look blurred, adjust the distance before taking the photo.');
  return tips.join(' ');
}
function decodeScanDraft(key){
  if(!key.startsWith('pcso-draft:v1:')||key.length>12000)return null;
  try{const d=JSON.parse(decodeURIComponent(key.slice(14)));if(!d||typeof d.game!=='string'||!['','42','45','49','55','58'].includes(d.game)||typeof d.date!=='string'||(d.date!==''&&ticketDates(d.date)[0]!==d.date)||typeof d.numbers!=='string'||d.numbers.length>5000)return null;return d;}catch{return null;}
}
function scanDrafts(){const drafts=[];try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(localStorage.getItem(key)!=='1')continue;const d=decodeScanDraft(key);if(d)drafts.push({key,...d});}}catch{}return drafts;}
let scanToastTimer;
function scanNotice(message){
  const toast=document.getElementById('scan-toast');toast.textContent=message;toast.hidden=false;
  clearTimeout(scanToastTimer);scanToastTimer=setTimeout(()=>{toast.hidden=true;},4000);
}
function savedMatchText(numbers,maximum,date){
  if(numbers.length!==6||new Set(numbers).size!==6||numbers.some(n=>!Number.isInteger(n)||n<1||n>maximum))return 'Enter 6 valid numbers to check';
  const result=data.draws.find(d=>d[0]===date&&d[1]===Number(maximum));
  if(!result)return 'Awaiting official result';
  const matches=numbers.filter(n=>result[2].includes(n));
  return matches.length?matches.map(pad).join(' '):'None';
}
function scannedHasNoMatches(rows,maximum,date){
  return rows.length>0&&rows.every(numbers=>savedMatchText(numbers,Number(maximum),date)==='None');
}
function appendScanWinning(card,date,maximum){
  const result=data.draws.find(d=>d[0]===date&&d[1]===Number(maximum));
  const row=document.createElement('div');row.className='played-number-row';
  const label=document.createElement('span');label.textContent='Winning';const balls=document.createElement('div');
  if(result)result[2].forEach(n=>{const ball=document.createElement('span');ball.className='history-number';ball.textContent=pad(n);balls.append(ball);});
  else balls.textContent=date&&maximum?'Awaiting result':'Correct game and draw date to check results';
  row.append(label,balls);card.append(row);
}
function renderScannedHistory(){
  const records=scannedTickets(),container=document.getElementById('scanned-history');container.replaceChildren();
  const drafts=scanDrafts();document.getElementById('scanned-count').textContent='('+(records.length+drafts.length)+')';
  drafts.forEach(d=>{const card=document.createElement('article');card.className='played-record';const title=document.createElement('strong');title.textContent=(gameNames.get(Number(d.game))||'Game not entered')+' · '+(d.date||'Date not entered')+(scannedHasNoMatches(d.numbers.split(/\r?\n/).filter(line=>line.trim()).map(line=>parseTicketLines(line)[0]||[]),d.game,d.date)?' · No matches':'');const numbers=document.createElement('p');numbers.style.whiteSpace='pre-wrap';const result=data.draws.find(r=>r[0]===d.date&&r[1]===Number(d.game));
    (d.numbers||'Numbers not detected').split(/\r?\n/).forEach((line,i)=>{const parsed=parseTicketLines(line)[0];const row=document.createElement('div');row.className='played-number-row';
      if(parsed&&parsed.every(n=>n<=Number(d.game))){const label=document.createElement('span');label.textContent=(/^\s*([A-Z])\s*[:.)]/i.exec(line)?.[1]||String.fromCharCode(65+i))+':';const balls=document.createElement('div');parsed.forEach(n=>{const b=document.createElement('span');b.textContent=pad(n);b.className='history-number'+(result?.[2].includes(n)?' history-match':'');balls.append(b);});row.append(label,balls);}else row.textContent=line; numbers.append(row);});const button=document.createElement('button');button.type='button';button.textContent='Edit details';button.dataset.draftKey=d.key;card.append(title,numbers);appendScanWinning(card,d.date,d.game);card.append(button);container.append(card);});
  if(!records.length&&!drafts.length){container.textContent='No scanned tickets yet.';return;}
  records.forEach(t=>{const card=document.createElement('article');card.className='played-record';
    const title=document.createElement('strong');title.textContent=gameNames.get(t.maximum)+' · '+t.date+(scannedHasNoMatches(t.picks.map(p=>p.numbers),t.maximum,t.date)?' · No matches':'');card.append(title);
    t.picks.forEach(p=>{const row=document.createElement('div');row.className='played-number-row';const label=document.createElement('span');label.textContent=p.label+':';const balls=document.createElement('div');
      const result=data.draws.find(d=>d[0]===t.date&&d[1]===t.maximum);
      p.numbers.forEach(n=>{const b=document.createElement('span');b.textContent=pad(n);b.className='history-number'+(result?.[2].includes(n)?' history-match':'');balls.append(b);});row.append(label,balls);card.append(row);});appendScanWinning(card,t.date,t.maximum);container.append(card);});
}
function saveScannedTicket(ticket){
  const ticketKey='pcso-ticket:v1:'+ticket.date+':'+ticket.maximum+':'+ticket.picks.map(p=>p.label+'='+[...p.numbers].sort((a,b)=>a-b).join('-')).join('_');
  if(!decodeScannedTicket(ticketKey))throw new Error('Review the game, date and all numbers before saving.');
  const keys=[ticketKey,...ticket.picks.flatMap(p=>{const key=playedKey(ticket.date,ticket.maximum,p.numbers);return [key,key.replace('pcso-played:','pcso-custom:')];})];
  const duplicate=localStorage.getItem(ticketKey)==='1';
  const previous=keys.map(k=>[k,localStorage.getItem(k)]);
  try{keys.forEach(k=>localStorage.setItem(k,'1'));}catch(error){previous.forEach(([k,v])=>{if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);});throw new Error('Could not save. Check browser storage and try again.');}
  return {duplicate};
}

function checkTicketPick(numbers, maximum, date, draws) {
  if (numbers.length !== 6 || new Set(numbers).size !== 6 || numbers.some(n => !Number.isInteger(n) || n < 1 || n > maximum)) throw new Error('Each pick must contain 6 different numbers from 1 to ' + maximum + '.');
  const draw = draws.find(d => d[0] === date && d[1] === maximum);
  return draw ? {draw, matches: numbers.filter(n => draw[2].includes(n))} : null;
}
(() => {
  const el = id => document.getElementById(id);
  let photoUrl, lastPhoto, busy = false, libraryPromise, pendingTicket=null, editingDraft=null;
  data.games.forEach(g => {const option = document.createElement('option');option.value=g.max;option.textContent=g.name+' 6/'+g.max;el('scan-game').append(option);});
  function loadScanner() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!libraryPromise) libraryPromise = new Promise((resolve,reject) => {
      const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      script.onload=()=>resolve(window.Tesseract);script.onerror=()=>{script.remove();libraryPromise=null;reject(new Error('Scanner download failed'));};document.head.append(script);
    });
    return libraryPromise;
  }
  function showRetakeHelp(text, technical=false){el('scan-help').hidden=false;el('scan-help-text').textContent=scanRetakeAdvice(text,technical);}
  async function scan(file) {
    if (!file || busy) return;
    el('scan-take').textContent='RETAKE';
    el('scan-help').hidden=true;el('scan-review').hidden=true;pendingTicket=null;el('scan-form').hidden=false;
    el('scan-results').replaceChildren();el('scan-picks').value='';el('scan-date').value='';el('scan-game').value='';
    if (!file.type.startsWith('image/') || file.size > 20*1024*1024) {el('scan-status').textContent='Choose an image under 20 MB.';el('scan-help').hidden=false;el('scan-help-text').textContent='Choose a photo under 20 MB or tap RETAKE to take a new photo.';return;}
    editingDraft=null;el('scan-quality').hidden=true;lastPhoto=file;pendingTicket=null;el('scan-review').hidden=true;el('scan-form').hidden=false;
    busy=true;el('scan-upload').disabled=el('scan-take').disabled=true;
    let worker;
    try {
      if(photoUrl) URL.revokeObjectURL(photoUrl);photoUrl=URL.createObjectURL(file);
      const preview=el('scan-preview');preview.src=photoUrl;preview.hidden=false;
      el('scan-status').textContent='Loading scanner… The first scan can take a little longer.';
      const engine=await loadScanner();
      worker=await engine.createWorker('eng',1,{logger:m=>{if(m.status==='recognizing text')el('scan-status').textContent='Reading ticket… '+Math.round(m.progress*100)+'%';}});
      const result=await worker.recognize(file);
      const text=result.data.text;
      const lines=parseLabelledPicks(text);
      el('scan-picks').value=text.split(/\r?\n/).filter(line=>/^\s*[A-Z]\s*[:.)]/i.test(line)).join('\n');
      const detected=parseTicketMetadata(text);
      const quality=assessScanQuality(text,result.data.confidence,Number(detected.game),result.data.words||[]);
      el('scan-quality').hidden=false;el('scan-quality').className=quality.clear?'scan-readable':'scan-needs-review';el('scan-quality').textContent=(quality.clear?'Photo is good. ':'Needs correction. ')+quality.message;
      if(!quality.clear)showRetakeHelp(text);
      el('scan-game').value=detected.game;
      el('scan-date').value=detected.date;
      const missing=[];
      if(!detected.game)missing.push('game');
      if(!detected.date)missing.push('draw date');
      if(!lines.length)missing.push('ticket numbers');
      el('scan-status').textContent='Scan complete. '+(missing.length?'Please correct: '+missing.join(', ')+'. ':'Review every detail before saving. ')+(detected.multipleDates?'Choose one DRAW date to check. ':'');
      showReview();
    } catch(error) {showRetakeHelp('',true);el('scan-quality').hidden=false;el('scan-quality').className='scan-needs-review';el('scan-quality').textContent='Needs correction. Photo could not be read. Enter details manually or upload another photo.';el('scan-status').textContent='Could not read this photo. Try a clear JPG or PNG with an internet connection, or enter the ticket numbers below.';}
    finally {if(worker)await worker.terminate().catch(()=>{});busy=false;el('scan-upload').disabled=el('scan-take').disabled=false;}
  }
  installTicketCamera({scan,loadScanner,isBusy:()=>busy});
  el('scan-take-file').onchange=event=>{scan(event.target.files[0]);event.target.value='';};
  el('scan-upload').onclick=()=>el('scan-upload-file').click();
  el('scan-upload-file').onchange=event=>{scan(event.target.files[0]);event.target.value='';};
  el('scan-draft').onclick=()=>{
    if(busy)return;
    try{const draft={game:el('scan-game').value,date:el('scan-date').value,numbers:el('scan-picks').value};const key='pcso-draft:v1:'+encodeURIComponent(JSON.stringify(draft));if(!decodeScanDraft(key))throw new Error('Too much text to save. Shorten the number rows and try again.');const duplicate=localStorage.getItem(key)==='1';localStorage.setItem(key,'1');if(editingDraft&&editingDraft!==key)localStorage.removeItem(editingDraft);editingDraft=key;renderScannedHistory();scanNotice(duplicate?'Already saved':'Saved!');el('scan-status').textContent='Saved.';}catch(error){el('scan-status').textContent=error.message||'Could not save. Check browser storage.';scanNotice(el('scan-status').textContent);}
  };
  el('scanned-history').addEventListener('click',event=>{const key=event.target.dataset.draftKey;if(!key)return;const d=decodeScanDraft(key);if(!d)return;editingDraft=key;el('scan-help').hidden=true;el('ticket-scanner').open=true;el('scan-game').value=d.game;el('scan-date').value=d.date;el('scan-picks').value=d.numbers;el('scan-review').hidden=true;el('scan-form').hidden=false;el('scan-results').replaceChildren();el('scan-quality').hidden=true;el('scan-preview').hidden=true;el('scan-status').textContent='Correct the saved details, then review and confirm.';el('scan-form').scrollIntoView({behavior:'smooth',block:'center'});});
  ['scan-game','scan-date','scan-picks'].forEach(id=>el(id).addEventListener('input',()=>el('scan-results').replaceChildren()));
  function readTicket(){
    const maximum=Number(el('scan-game').value),date=el('scan-date').value;
    if(!data.games.some(g=>g.max===maximum)||ticketDates(date)[0]!==date)throw new Error('Choose the game and the date beside DRAW.');
    const lines=el('scan-picks').value.trim().split(/\r?\n/).filter(l=>l.trim());
    if(!lines.length||lines.length>26)throw new Error('Enter 1 to 26 picks.');
    const picks=lines.map((line,i)=>{const label=/^\s*([A-Z])\s*[:.)]/i.exec(line)?.[1].toUpperCase()||String.fromCharCode(65+i);const parsed=parseTicketLines(line);if(parsed.length!==1)throw new Error('Each row must contain 6 different numbers.');checkTicketPick(parsed[0],maximum,date,[]);return {label,numbers:parsed[0]};});
    if(new Set(picks.map(p=>p.label)).size!==picks.length)throw new Error('Each pick needs a different row letter.');
    return {maximum,date,picks};
  }
  function showReview(){
    pendingTicket=null;el('scan-summary').replaceChildren();el('scan-review').hidden=false;el('scan-form').hidden=true;
    const add=(label,value)=>{const p=document.createElement('p');const b=document.createElement('strong');b.textContent=label+': ';p.append(b,document.createTextNode(value));el('scan-summary').append(p);};
    add('Game',gameNames.get(Number(el('scan-game').value))||'Not detected');
    const raw=el('scan-picks').value.trim();raw.split(/\r?\n/).filter(Boolean).forEach((line,i)=>{const m=/^\s*([A-Z])\s*[:.)]\s*(.*)/i.exec(line);add(m?m[1]:String.fromCharCode(65+i),m?m[2]:line);});
    if(!raw)add('Numbers','Not detected');
    add('DRAW date',el('scan-date').value?new Date(el('scan-date').value+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'Not detected');
    try{pendingTicket=readTicket();el('scan-confirm').disabled=false;}catch(error){el('scan-confirm').disabled=true;el('scan-status').textContent=error.message+' Rescan or edit manually.';}
  }
  el('scan-form').addEventListener('submit',event=>{event.preventDefault();showReview();});
  el('scan-edit').onclick=()=>{pendingTicket=null;el('scan-review').hidden=true;el('scan-form').hidden=false;el('scan-game').focus();};
  el('scan-confirm').onclick=()=>{
    if(!pendingTicket||busy)return;
    try{
      const ticket=readTicket();const saved=saveScannedTicket(ticket);scanNotice(saved.duplicate?'Already saved':'Saved!');if(editingDraft){localStorage.removeItem(editingDraft);editingDraft=null;}pendingTicket=null;el('scan-review').hidden=true;
      renderPlayedHistory();renderScannedHistory();renderHistory();renderedDay=undefined;renderPicks();
      el('scan-status').textContent='Saved.';
      el('scan-results').replaceChildren();
      ticket.picks.forEach(p=>{const result=checkTicketPick(p.numbers,ticket.maximum,ticket.date,data.draws);const card=document.createElement('article'),title=document.createElement('strong');title.textContent=p.label+': '+(result?result.matches.length+'/6 matching numbers':'Result unavailable');card.append(title);
        const balls=document.createElement('p');p.numbers.forEach(n=>{const ball=document.createElement('span');ball.className='history-number'+(result?.matches.includes(n)?' history-match':'');ball.textContent=pad(n);balls.append(ball);});card.append(balls);
        const note=document.createElement('p');note.textContent=result?'Official combination: '+result.draw[2].map(pad).join(' ')+'. Confirm any prize with PCSO.':'No verified result is saved for this game and date. This is not a losing-ticket result.';card.append(note);el('scan-results').append(card);});
    }catch(error){el('scan-status').textContent=error.message;}
  };
  window.addEventListener('storage',()=>{renderScannedHistory();renderPlayedHistory();});
  renderScannedHistory();renderPlayedHistory();
})();
