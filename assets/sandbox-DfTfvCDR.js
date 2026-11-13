import"./modulepreload-polyfill-P2Xu9kJm.js";import{t as e}from"./highlight-bPnov08D.js";import{t}from"./engine-B9R-7j5h.js";import{V as n}from"./pattern-DZPZqFub.js";import{i as r,n as i,r as a,t as o}from"./samples-DTSZEcO3.js";var s=e=>({key:e.key,duration:e.duration??0,slices:[...e.slices]}),c=e=>typeof e==`object`&&!!e&&!Array.isArray(e);function l(e,t){let r=e.engine,i=new Set,a=new Map,o=new Set,l=!1,u=!1,d=[],f=!1,p=!1,m=e=>{l||t.send(e)},h=e=>{m({type:`error`,error:{code:e.code,message:e.message,...e.nodeId===void 0?{}:{nodeId:e.nodeId}}})},g=()=>({bpm:r.transport.bpm,swing:r.transport.swing,timeSignature:[...r.transport.timeSignature],stepLength:r.transport.stepLength,state:r.transport.state}),_=()=>{p||(p=!0,queueMicrotask(()=>{p=!1,f?m({type:`snapshot`,snapshot:e.snapshot()}):d.length>0&&m({type:`params`,changes:d}),f=!1,d=[]}))},v=()=>m({type:`transport`,transport:g()}),y=[e.on(`error`,e=>{u&&h(e)}),e.on(`param:changed`,e=>{u||(d.push({node:e.param.node.id,param:e.param.name,value:e.value}),_())}),e.on(`node:added`,()=>{u||(f=!0,_())}),e.on(`node:removed`,()=>{u||(f=!0,_())}),r.transport.on(`tempo`,v),r.transport.on(`start`,v),r.transport.on(`stop`,v),r.buffers.on(`ready`,e=>m({type:`buffer`,...s(e)}))],b=t=>{let n=[],r=t.scope.owner,i=null;for(;r;)n.unshift(r.id),i=r,r=r.parent;return i!==null&&i.scope===e?n:null},x=e=>{if(!c(e)||typeof e.type!=`string`||!c(e.params))throw TypeError(`A macro definition needs a type and params.`);let t=e.type;if(r.registry.has(t)&&!o.has(t))throw TypeError(`"${t}" is already a node type and cannot be redefined by a script.`);let i={};for(let[t,n]of Object.entries(e.params)){if(!c(n))throw TypeError(`Parameter "${t}" is not an object.`);let e=Array.isArray(n.drives)?n.drives:[];i[t]={...n,drives:e.filter(c).map(e=>{let t=c(e.scale)?e.scale:null;return{select:String(e.select),param:String(e.param),...t?{scale:{multiply:Number(t.multiply??1),add:Number(t.add??0)}}:{}}})}}let a=Array.isArray(e.methods)?e.methods.filter(e=>typeof e==`string`):[],s=(e,t,n,r)=>{let i=b(e);i&&m({type:`call`,path:i,method:t,args:c(n)?n:{},at:r})},l={};for(let e of a)e!==`trigger`&&e!==`release`&&(l[e]=(t,n,r)=>s(t,e,n,r));let u=n({type:t,...typeof e.category==`string`?{category:e.category}:{},...typeof e.description==`string`?{description:e.description}:{},...typeof e.shorthand==`string`?{shorthand:e.shorthand}:{},...c(e.options)?{options:e.options}:{},...c(e.triggerOptions)?{triggerOptions:e.triggerOptions}:{},params:i,build(t,n){let r=c(n.remote)?n.remote.graph:void 0,i=c(r)?r:e.graph;t.scope.dispatch([{op:`apply`,graph:i}])},...a.includes(`trigger`)?{trigger(e,{at:t,...n},r){s(e,`trigger`,n,t??r.time)}}:{},...a.includes(`release`)?{release(e,{at:t,...n},r){s(e,`release`,n,t??r.time)}}:{},methods:l});r.registry.register(u),o.add(t)},S=e=>e instanceof Error?e.message:String(e),C=e=>e.op===`inside`&&Array.isArray(e.commands)?{...e,commands:e.commands.filter(c).map(e=>C(e))}:`at`in e&&typeof e.at==`number`&&e.at<=0?{...e,at:r.context.currentTime}:e,w=(e,t)=>({name:e,time:t.time,duration:0,beat:t.beat,bar:t.bar,index:0,value:1,cycle:0}),T=(t,n)=>{if(typeof t!=`string`||t===``)throw TypeError(`A remote sequence needs a name.`);e.transport.sequence(t,n,e=>{m({type:`event`,event:{name:t,time:e.time,duration:e.duration,beat:e.beat,bar:e.bar,index:e.index,value:e.value,cycle:e.cycle},steps:[...e.steps]})}),i.add(t)},E=n=>{if(typeof n!=`object`||!n){h({code:`invalid-command`,message:`A command must be an object.`});return}if(t.allow&&!t.allow(n))return;let r=C(n);if(r.op===`sequence`||r.op===`once`)try{if(r.op===`sequence`)T(r.name,r.options);else{let t=r.name;if(typeof t!=`string`||t===``)throw TypeError(`A callback needs a name.`);a.get(t)?.(),a.set(t,e.transport.at(r.position,e=>{a.delete(t),m({type:`event`,event:w(t,e),steps:[1]})}))}}catch(e){h({code:`invalid-command`,message:S(e)})}else{if(r.op===`clearSequence`){i.delete(r.name);let e=a.get(r.name);if(e){e(),a.delete(r.name);return}}e.dispatch([r])}};return{receive(e){if(!l&&typeof e==`object`&&e){if(e.type===`define`)try{x(e.macro)}catch(e){h({code:`unknown-type`,message:S(e)})}else if(e.type!==`commands`||!Array.isArray(e.commands))h({code:`invalid-command`,message:`Unknown message from the remote.`});else{u=!0;try{for(let t of e.commands)E(t)}finally{u=!1}}}},state(){return{snapshot:e.snapshot(),transport:g(),types:r.registry.list(),buffers:r.buffers.list().filter(e=>e.state===`ready`).map(s)}},dispose(){if(l)return;l=!0;for(let e of y)e();for(let t of i)e.transport.clear(t);i.clear();for(let e of a.values())e();a.clear();let t=r.registry;for(let e of o)t.remove?.(e);o.clear()}}}var u=`// This code runs in a sandboxed frame, not in the page.
// It has no audio and cannot reach the page: it sends commands.

__.transport.bpm = 110;

__().sampler({ id: 'kick', buffer: 'kick' }).to('main');
__().sampler({ id: 'hat', buffer: 'hat' }).highpass(6000).gain(0.35).to('main');

__().saw({ id: 'bass', gate: 'closed' })
  .lowpass({ id: 'filter', frequency: 500, q: 6 })
  .gain(0.25)
  .to('main');

// The callbacks run in the frame, a little ahead of time.
__.transport.sequence('kick', { steps: 'x..x..x...x..x..' }, (ev) => {
  if (ev.value) __('#kick').trigger();
});

__.transport.sequence('hat', { steps: euclid(5, 8), step: '1/8' }, (ev) => {
  if (ev.value) __('#hat').trigger({ speed: 1 + ev.index * 0.04 });
});

__.transport.sequence('bass', { steps: [55, 0, 55, 82.4, 0, 65.4, 0, 110], step: '1/8' }, (ev) => {
  if (ev.value) {
    __('#bass').set({ frequency: ev.value }).trigger({ duration: ev.duration * 0.6 });
  }
});

// A node type of your own, defined right here in the sandbox. Its inner graph is sent to the
// page as data; its trigger() runs here each time the page asks.
define({
  type: 'blip',
  params: {
    pitch: { default: 660, min: 50, max: 4000, drives: [{ select: '#tone', param: 'frequency' }] },
  },
  build(__) {
    __().sine({ id: 'tone', gate: 'closed' }).gain(0.15).to('out');
  },
  trigger(__, options) {
    __('#tone').trigger({ duration: options.duration ?? 0.05 });
  },
});
__().blip({ id: 'blip' }).to('main');

__.transport.every('1/4', (ev) => {
  __('#blip').set({ pitch: ev.beat % 4 === 0 ? 1320 : 660 }).trigger();
}, { offset: '1/8' });

// Things a script might try. Each fails or finds nothing:
// document.cookie; localStorage.getItem('x'); parent.document.title;
`,d=document.querySelector(`#editor`),f=document.querySelector(`#toggle`),p=document.querySelector(`#status`),m=document.querySelector(`#message`),h=document.querySelector(`#timing`),g=document.querySelector(`#frame`),_=null,v=null,y=null,b=null,x={text:``,isError:!1},S=``;function C(e,t){x={text:e,isError:t},m.textContent=[x.text,S].filter(Boolean).join(`
`),m.classList.toggle(`error`,t)}var w=new Map,T=[],E=0;function D(e){for(let t of new Set(e)){let e=w.get(t);e!==void 0&&(w.delete(t),T.push(performance.now()-e),T.length>200&&T.shift(),_&&t<_.context.currentTime&&E++)}}function O(){if(T.length===0||!_)return;let e=[...T].sort((e,t)=>e-t),t=[`mean ${(T.reduce((e,t)=>e+t,0)/T.length).toFixed(2)} ms`,`worst ${e[e.length-1].toFixed(2)} ms (last ${T.length} steps)`,`look-ahead ${(_.transport.lookahead*1e3).toFixed(0)} ms`,`commands that came back too late: ${E}`];h.replaceChildren(...t.map(e=>Object.assign(document.createElement(`li`),{textContent:e})))}var k=new Promise(e=>{window.addEventListener(`message`,t=>{if(t.source!==g.contentWindow)return;let n=t.data;n.kind===`ready`?e():n.kind===`remote`?(n.message.type===`commands`&&D(n.message.commands.flatMap(e=>`at`in e&&e.at>0?[e.at]:[])),v?.receive(n.message)):n.kind===`result`&&C(n.error??`Running in the sandbox. ${n.nodes} node${n.nodes===1?``:`s`}.`,n.error!==null)})});g.src=`./sandbox-frame.html`;var A=e=>g.contentWindow?.postMessage(e,`*`);function j(){v&&d.value!==b&&(b=d.value,A({kind:`run`,code:b}))}function M(){let e=_?.context.state===`running`;p.textContent=e?`${_.transport.bpm} bpm`:`Audio is off.`,p.classList.toggle(`running`,e),f.textContent=e?`Stop audio`:`Start audio`}function N(){return y??=(async()=>{let e=await t({context:new AudioContext});e.bus(`main`).gain.set(.6),e.on(`error`,e=>C(e.message,!0)),e.on(`state`,M),e.transport.on(`tempo`,M),o(e),r(e,e=>{S=e,C(x.text,x.isError)}),await k,v=l(e.scope(`sandboxed`),{send:e=>{e.type===`event`&&w.set(e.event.time,performance.now()),A({kind:`host`,message:e})},allow:e=>e.op!==`loadBuffer`}),A({kind:`init`,state:v.state()}),_=e,Object.assign(window,{engine:e}),setInterval(O,500)})(),y}async function P(){await N(),await _.resume(),_.transport.start(),M(),j()}d.value=u,e(d,document.querySelector(`#highlight`));var F=document.querySelector(`#break-credit`);F.href=i.page,F.textContent=a,d.addEventListener(`keyup`,()=>{_?j():P()}),f.addEventListener(`click`,()=>{_?.context.state===`running`?_.context.suspend().then(M):P()}),M();