const PORT=9222, BASE=`http://127.0.0.1:${PORT}`;
let n=0;
class S{constructor(ws){this.ws=ws;this.pending=new Map()}
 static async open(u){const ws=new WebSocket(u);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',()=>j(new Error('ws')),{once:true})});const s=new S(ws);ws.addEventListener('message',e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.id!=null&&s.pending.has(m.id)){const p=s.pending.get(m.id);s.pending.delete(m.id);m.error?p.rej(new Error(m.error.message)):p.res(m.result)}});return s}
 send(m,p={}){const id=++n;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:m,params:p}));setTimeout(()=>{if(this.pending.delete(id))rej(new Error('timeout '+m))},30000)})}}
const list=await (await fetch(`${BASE}/json/list`)).json();
const page=list.find(t=>t.type==='page');
const s=await S.open(page.webSocketDebuggerUrl);
const ev=async x=>{const r=await s.send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value};
const P=`(() => {
  const out={};
  out.e2e=[...new Set([...document.querySelectorAll('[data-e2e]')].map(e=>e.getAttribute('data-e2e')))];
  out.awemeIds=[...new Set([...document.querySelectorAll('[data-aweme-id]')].map(e=>e.getAttribute('data-aweme-id')))].slice(0,5);
  const li=[...document.querySelectorAll('li')].filter(e=>(e.innerText||'').includes('@'));
  out.liCount=li.length;
  out.liSample=li.slice(0,2).map(e=>({cls:String(e.className).slice(0,40),text:(e.innerText||'').replace(/\\s+/g,' ').slice(0,140)}));
  const idEl=document.querySelector('[data-aweme-id]');
  out.idElHtml=idEl?idEl.outerHTML.slice(0,700):null;
  return out;
})()`;
console.log(JSON.stringify(await ev(P),null,2));
s.ws.close();process.exit(0);
