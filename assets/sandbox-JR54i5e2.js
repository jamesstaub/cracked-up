import"./modulepreload-polyfill-P2Xu9kJm.js";/* empty css              */import{t as e}from"./engine-DH7QVy3a.js";import{V as t}from"./pattern-DZPZqFub.js";import{a as n,i as r,l as i,n as a,o,r as s,t as c,u as l}from"./catalog-Dx_bw0V0.js";import{t as u}from"./samples-CJX712Ib.js";var d=e=>({key:e.key,duration:e.duration??0,slices:[...e.slices]}),f=e=>typeof e==`object`&&!!e&&!Array.isArray(e);function p(e,n){let r=e.engine,i=new Set,a=new Map,o=new Set,s=!1,c=!1,l=[],u=!1,p=!1,m=e=>{s||n.send(e)},h=e=>{m({type:`error`,error:{code:e.code,message:e.message,...e.nodeId===void 0?{}:{nodeId:e.nodeId}}})},g=()=>({bpm:r.transport.bpm,swing:r.transport.swing,timeSignature:[...r.transport.timeSignature],stepLength:r.transport.stepLength,state:r.transport.state}),_=()=>{p||(p=!0,queueMicrotask(()=>{p=!1,u?m({type:`snapshot`,snapshot:e.snapshot()}):l.length>0&&m({type:`params`,changes:l}),u=!1,l=[]}))},v=()=>m({type:`transport`,transport:g()}),y=[e.on(`error`,e=>{c&&h(e)}),e.on(`param:changed`,e=>{c||(l.push({node:e.param.node.id,param:e.param.name,value:e.value}),_())}),e.on(`node:added`,()=>{c||(u=!0,_())}),e.on(`node:removed`,()=>{c||(u=!0,_())}),r.transport.on(`tempo`,v),r.transport.on(`start`,v),r.transport.on(`stop`,v),r.buffers.on(`ready`,e=>m({type:`buffer`,...d(e)}))],b=t=>{let n=[],r=t.scope.owner,i=null;for(;r;)n.unshift(r.id),i=r,r=r.parent;return i!==null&&i.scope===e?n:null},x=e=>{if(!f(e)||typeof e.type!=`string`||!f(e.params))throw TypeError(`A macro definition needs a type and params.`);let n=e.type;if(r.registry.has(n)&&!o.has(n))throw TypeError(`"${n}" is already a node type and cannot be redefined by a script.`);let i={};for(let[t,n]of Object.entries(e.params)){if(!f(n))throw TypeError(`Parameter "${t}" is not an object.`);let e=Array.isArray(n.drives)?n.drives:[];i[t]={...n,drives:e.filter(f).map(e=>{let t=f(e.scale)?e.scale:null;return{select:String(e.select),param:String(e.param),...t?{scale:{multiply:Number(t.multiply??1),add:Number(t.add??0)}}:{}}})}}let a=Array.isArray(e.methods)?e.methods.filter(e=>typeof e==`string`):[],s=(e,t,n,r)=>{let i=b(e);i&&m({type:`call`,path:i,method:t,args:f(n)?n:{},at:r})},c={};for(let e of a)e!==`trigger`&&e!==`release`&&(c[e]=(t,n,r)=>s(t,e,n,r));let l=t({type:n,...typeof e.category==`string`?{category:e.category}:{},...typeof e.description==`string`?{description:e.description}:{},...typeof e.shorthand==`string`?{shorthand:e.shorthand}:{},...f(e.options)?{options:e.options}:{},...f(e.triggerOptions)?{triggerOptions:e.triggerOptions}:{},params:i,build(t,n){let r=f(n.remote)?n.remote.graph:void 0,i=f(r)?r:e.graph;t.scope.dispatch([{op:`apply`,graph:i}])},...a.includes(`trigger`)?{trigger(e,{at:t,...n},r){s(e,`trigger`,n,t??r.time)}}:{},...a.includes(`release`)?{release(e,{at:t,...n},r){s(e,`release`,n,t??r.time)}}:{},methods:c});r.registry.register(l),o.add(n)},S=e=>e instanceof Error?e.message:String(e),C=e=>e.op===`inside`&&Array.isArray(e.commands)?{...e,commands:e.commands.filter(f).map(e=>C(e))}:`at`in e&&typeof e.at==`number`&&e.at<=0?{...e,at:r.context.currentTime}:e,w=(e,t)=>({name:e,time:t.time,duration:0,beat:t.beat,bar:t.bar,index:0,value:1,cycle:0}),T=(t,n)=>{if(typeof t!=`string`||t===``)throw TypeError(`A remote sequence needs a name.`);e.transport.sequence(t,n,e=>{m({type:`event`,event:{name:t,time:e.time,duration:e.duration,beat:e.beat,bar:e.bar,index:e.index,value:e.value,cycle:e.cycle},steps:[...e.steps]})}),i.add(t)},E=t=>{if(typeof t!=`object`||!t){h({code:`invalid-command`,message:`A command must be an object.`});return}if(n.allow&&!n.allow(t))return;let r=C(t);if(r.op===`sequence`||r.op===`once`)try{if(r.op===`sequence`)T(r.name,r.options);else{let t=r.name;if(typeof t!=`string`||t===``)throw TypeError(`A callback needs a name.`);a.get(t)?.(),a.set(t,e.transport.at(r.position,e=>{a.delete(t),m({type:`event`,event:w(t,e),steps:[1]})}))}}catch(e){h({code:`invalid-command`,message:S(e)})}else{if(r.op===`clearSequence`){i.delete(r.name);let e=a.get(r.name);if(e){e(),a.delete(r.name);return}}e.dispatch([r])}};return{receive(e){if(!s&&typeof e==`object`&&e){if(e.type===`define`)try{x(e.macro)}catch(e){h({code:`unknown-type`,message:S(e)})}else if(e.type!==`commands`||!Array.isArray(e.commands))h({code:`invalid-command`,message:`Unknown message from the remote.`});else{c=!0;try{for(let t of e.commands)E(t)}finally{c=!1}}}},state(){return{snapshot:e.snapshot(),transport:g(),types:r.registry.list(),buffers:r.buffers.list().filter(e=>e.state===`ready`).map(d)}},dispose(){if(s)return;s=!0;for(let e of y)e();for(let t of i)e.transport.clear(t);i.clear();for(let e of a.values())e();a.clear();let t=r.registry;for(let e of o)t.remove?.(e);o.clear()}}}var m=`// This code runs in a sandboxed frame, not in the page.
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
`,h=document.querySelector(`#toggle`),g=document.querySelector(`#status`),_=document.querySelector(`#message`),v=document.querySelector(`#timing`),y=document.querySelector(`#frame`),b=null,x=null,S=null,C=null,w={text:``,isError:!1},T=``;function E(e,t){w={text:e,isError:t},_.textContent=[w.text,T].filter(Boolean).join(`
`),_.classList.toggle(`error`,t)}var D={globals:[{name:`define`,signature:`define(definition)`,description:`Defines a node type in the sandbox: { type, params, build(__), trigger(__, options) }.`}]},O=l({buffers:c,...D});a().then(e=>{x||O.update({types:e})});function k(){if(!x)return;let e=i(x.state(),D),t=new Set((e.buffers??[]).map(e=>typeof e==`string`?e:e.key));O.set({...e,buffers:[...e.buffers??[],...c.filter(e=>!t.has(e.key))]})}var A=o({parent:document.querySelector(`#editor`),doc:m,catalog:O,errorPanel:!1,onChange:()=>{b?R():V()}});Object.assign(window,{editor:A});var j=new Map,M=[],N=0;function P(e){for(let t of new Set(e)){let e=j.get(t);e!==void 0&&(j.delete(t),M.push(performance.now()-e),M.length>200&&M.shift(),b&&t<b.context.currentTime&&N++)}}function F(){if(M.length===0||!b)return;let e=[...M].sort((e,t)=>e-t),t=[`mean ${(M.reduce((e,t)=>e+t,0)/M.length).toFixed(2)} ms`,`worst ${e[e.length-1].toFixed(2)} ms (last ${M.length} steps)`,`look-ahead ${(b.transport.lookahead*1e3).toFixed(0)} ms`,`commands that came back too late: ${N}`];v.replaceChildren(...t.map(e=>Object.assign(document.createElement(`li`),{textContent:e})))}var I=new Promise(e=>{window.addEventListener(`message`,t=>{if(t.source!==y.contentWindow)return;let n=t.data;n.kind===`ready`?e():n.kind===`remote`?(n.message.type===`commands`&&P(n.message.commands.flatMap(e=>`at`in e&&e.at>0?[e.at]:[])),x?.receive(n.message)):n.kind===`result`&&(k(),n.error===null?A.clearError():A.showError(n.error),E(n.error??`Running in the sandbox. ${n.nodes} node${n.nodes===1?``:`s`}.`,n.error!==null))})});y.src=`./sandbox-frame.html`;var L=e=>y.contentWindow?.postMessage(e,`*`);function R(){x&&A.value!==C&&(C=A.value,L({kind:`run`,code:C}))}function z(){let e=b?.context.state===`running`;g.textContent=e?`${b.transport.bpm} bpm`:`Audio is off.`,g.classList.toggle(`running`,e),h.textContent=e?`Stop audio`:`Start audio`}function B(){return S??=(async()=>{let t=await e({context:new AudioContext});t.bus(`main`).gain.set(.6),t.on(`error`,e=>E(e.message,!0)),t.on(`state`,z),t.transport.on(`tempo`,z),u(t),n(t,e=>{T=e,E(w.text,w.isError)}),await I,x=p(t.scope(`sandboxed`),{send:e=>{e.type===`event`&&j.set(e.event.time,performance.now()),L({kind:`host`,message:e})},allow:e=>e.op!==`loadBuffer`}),L({kind:`init`,state:x.state()}),t.buffers.on(`ready`,k),k(),b=t,Object.assign(window,{engine:t}),setInterval(F,500)})(),S}async function V(){await B(),await b.resume(),b.transport.start(),z(),R()}var H=document.querySelector(`#break-credit`);H.href=s.page,H.textContent=r,h.addEventListener(`click`,()=>{b?.context.state===`running`?b.context.suspend().then(z):V()}),z();