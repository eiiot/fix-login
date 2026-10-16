import { execFile, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, copyFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const output = path.resolve(import.meta.dirname, '../website/assets');
const extension = path.resolve(import.meta.dirname, '../extension');
const delay = Number(process.argv[2] ?? 100);
await mkdir(output, { recursive: true });

// This recording cursor follows real CDP input; it is not extension UI.
const cursor = `(() => {
  const pointer = document.createElement('div');
  pointer.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:30px;z-index:2147483647;pointer-events:none;display:none';
  pointer.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="30" viewBox="0 0 24 30"><path d="M3 2v22l6-6 5 10 4-2-5-10h9Z" fill="#111" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const attach = () => document.documentElement.append(pointer);
  if (document.documentElement) attach(); else document.addEventListener('DOMContentLoaded', attach, {once:true});
  const move = (x,y) => {
    pointer.style.display='block'; pointer.style.left=x+'px'; pointer.style.top=y+'px';
    sessionStorage.setItem('demo-cursor-position', JSON.stringify({x,y}));
  };
  const position = JSON.parse(sessionStorage.getItem('demo-cursor-position') || 'null');
  if (position) move(position.x,position.y);
  document.addEventListener('mousemove', event => move(event.clientX,event.clientY), true);
  document.addEventListener('mousedown', () => { pointer.style.transform='scale(.9)'; }, true);
  document.addEventListener('mouseup', () => { pointer.style.transform=''; }, true);
})()`;

async function record(name, enabled, duration) {
  const session = `stanford-video-${name}-${process.pid}`;
  const run = (...args) => execFileSync('agent-browser', ['--session',session,...args], {encoding:'utf8',timeout:40000}).trim();
  const directory = await mkdtemp(path.join(tmpdir(),'stanford-video-'));
  let socket;
  try {
    run('--headed','false','--args','--disable-gpu,--disable-features=PaintHolding',...(enabled ? ['--extension',extension] : []),'open','https://canvas.stanford.edu/login/1');
    run('wait','--fn','!!document.querySelector("#password") && document.readyState === "complete" && document.fonts.status === "loaded"');
    run('set','viewport','960','720');
    socket = new WebSocket(run('get','cdp-url'));
    await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{once:true}); socket.addEventListener('error',reject,{once:true}); });
    let id=0, targetSession, postCount=0;
    const pending=new Map();
    const send=(method,params={},sessionId=targetSession) => new Promise((resolve,reject) => {
      const requestId=++id;
      const timeout=setTimeout(() => {pending.delete(requestId);reject(new Error(method+' timed out'));},15000);
      pending.set(requestId,{resolve,reject,timeout});
      socket.send(JSON.stringify({id:requestId,method,params,...(sessionId ? {sessionId} : {})}));
    });
    socket.addEventListener('message',({data}) => {
      const m=JSON.parse(String(data));
      if (m.id) {
        const p=pending.get(m.id); if(!p) return;
        clearTimeout(p.timeout); pending.delete(m.id);
        if(m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
      } else if(m.sessionId===targetSession && m.method==='Network.requestWillBeSent' && m.params.type==='Document' && m.params.request.method==='POST') postCount++;
    });
    const evaluate=async expression => {
      const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      if(r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result.value;
    };
    const {targetInfos}=await send('Target.getTargets');
    const target=targetInfos.find(t=>t.type==='page' && t.url.startsWith('https://login.stanford.edu/'));
    if(!target) throw new Error('Expected Stanford login page');
    ({sessionId:targetSession}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true}));
    await send('Page.enable'); await send('Network.enable');
    // Apply the same realistic latency to both sessions to make the race stable.
    await send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:-1,uploadThroughput:-1});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:cursor}); await evaluate(cursor);
    const buttonPosition=() => evaluate(`(() => {
      if(document.querySelector('#username').value || document.querySelector('#password').value) throw new Error('Credentials must be empty');
      const r=document.querySelector('input[type=submit][name=_eventId_proceed]').getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    const button=await buttonPosition();
    const mouse=async (type,point,count) => send('Input.dispatchMouseEvent',{type,...point,...(count ? {button:'left',clickCount:count} : {})});
    const frames=[];
    const capture=async seconds => {
      const filename='frame-'+String(frames.length).padStart(3,'0')+'.png';
      await execFileAsync('agent-browser',['--session',session,'screenshot',path.join(directory,filename)],{encoding:'utf8',timeout:30000});
      frames.push({filename,seconds});
    };
    await mouse('mouseMoved',{x:button.x+130,y:button.y+80});
    await capture(1);
    // Capture actual cursor movement, then edit its timing for the short loop.
    for(let step=1;step<=10;step++) {
      await mouse('mouseMoved',{x:button.x+130*(1-step/10),y:button.y+80*(1-step/10)});
      await capture(.05);
    }
    await mouse('mousePressed',button,1); await capture(.1);
    // Do not interrupt the navigation race with screenshot requests.
    await mouse('mouseReleased',button,1);
    await new Promise(resolve=>setTimeout(resolve,delay));
    await mouse('mousePressed',button,2); await mouse('mouseReleased',button,2);
    await new Promise(resolve=>setTimeout(resolve,1800));
    const result=await evaluate('({title:document.title,hasLoginForm:!!document.querySelector("#password")})');
    const passed=enabled ? postCount===1 && result.hasLoginForm : postCount>=2 && result.title==='Stanford Login - Stale Request' && !result.hasLoginForm;
    if(!passed) throw new Error('Unexpected outcome: '+JSON.stringify({...result,postCount}));
    if(enabled) {
      const next=await buttonPosition();
      for(let step=1;step<=6;step++) {
        await mouse('mouseMoved',{x:button.x+(next.x-button.x)*step/6,y:button.y+(next.y-button.y)*step/6});
        await capture(.05);
      }
    }
    await capture(duration-frames.reduce((sum,frame)=>sum+frame.seconds,0));
    await copyFile(path.join(directory,frames.at(-1).filename),path.join(output,name+'.png'));
    const concat=frames.map(f=>`file '${f.filename}'\nduration ${f.seconds.toFixed(6)}\n`).join('')+`file '${frames.at(-1).filename}'\n`;
    await writeFile(path.join(directory,'frames.txt'),concat);
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',path.join(directory,'frames.txt'),'-vf','fps=30,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p','-c:v','libx264','-preset','slow','-crf','20','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-movflags','+faststart','-an','-t',String(duration),path.join(output,name+'.mp4')],{timeout:60000});
    const report={name,extensionEnabled:enabled,...result,postCount,duration,clickAt:1.5,latency:150,cursorPresent:true};
    await writeFile(path.resolve(import.meta.dirname,'../evidence',name+'-demo.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } finally {
    socket?.close();
    try{run('close');}catch{}
    await rm(directory,{recursive:true,force:true});
  }
}
await record('before',false,4);
await record('after',true,4);
