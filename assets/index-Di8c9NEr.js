import"./modulepreload-polyfill-P2Xu9kJm.js";import{t as e}from"./highlight-bPnov08D.js";import{t}from"./engine-B9R-7j5h.js";import{n,r,t as i}from"./helpers-D1IkWwMk.js";import{i as a,n as o,r as s,t as c}from"./samples-DTSZEcO3.js";var l=`// Edit this code: it re-runs on every key up.
// While it has an error, the last working version keeps playing.

__.transport.bpm = 110;

// --- Drums, mixed on a bus of their own ---------------------------------------
// 'kick', 'snare' and 'hat' are sounds made by this page.
__.bus('drums');
__().sampler({ id: 'kick', buffer: 'kick' }).to('drums');
__().sampler({ id: 'snare', buffer: 'snare' }).gain(0.6).to('drums');
__().sampler({ id: 'hat', buffer: 'hat' }).highpass(6000).gain(0.35).to('drums');

// A pattern is a string or an array. Steps are sixteenth notes unless you say otherwise.
__.transport.sequence('kick', { steps: 'x..x..x...x..x..' }, (ev) => {
  if (ev.value) __('#kick').trigger();
});
__.transport.sequence('snare', { steps: [0, 1], step: '1/4' }, (ev) => {
  if (ev.value) __('#snare').trigger();
});
__.transport.sequence('hat', { steps: euclid(5, 8), step: '1/8', swing: 0.58 }, (ev) => {
  if (ev.value) __('#hat').trigger({ speed: 1 + ev.index * 0.04 });
});

// --- A recording that stays in time -------------------------------------------
// A recorder listening in on the drum bus. The bus goes on playing as normal.
__.bus('drums').chain().recorder({ id: 'tape', into: 'drum-bar' });

// A sampler that plays whatever was recorded last, at half speed.
__().sampler({ id: 'tape-play', buffer: 'drum-bar', speed: 0.5 })
  .lowpass(900).gain(0.7).to('main');

// Every four bars, record exactly one bar, starting on the bar line...
__.transport.every('4 bars', () => {
  __('#tape').trigger({ duration: __.transport.seconds('1 bar') });
});
// ...and two bars later, play it. At half speed one bar lasts two, so it ends on the bar.
__.transport.every('4 bars', () => __('#tape-play').trigger(), { offset: '2 bars' });

// --- A loop that stays in time ------------------------------------------------
// Anything sent to 'loop-in' can be looped. to(null) means this bus goes nowhere
// by itself: its only way out is through the looper, which passes the sound on.
__.bus('loop-in').to(null).chain().looper({ id: 'loop', length: '2 bars' }).to('main');

__().saw({ id: 'bass', gate: 'closed' })
  .lowpass({ id: 'filter', frequency: 500, q: 6 })
  .gain(0.25)
  .to('loop-in');
__().sine(0.2).gain(300).modulate('#filter', 'frequency');
__().sine({ id: 'blip', gate: 'closed', frequency: 880 }).gain(0.1).to('loop-in');

// The bass is only played in bars 1 and 2 of every eight, and the blips only in
// bars 3 and 4. The looper records each as a layer and keeps both going.
__.transport.sequence('bass', { steps: [55, 0, 55, 82.4, 0, 65.4, 0, 110], step: '1/8' }, (ev) => {
  if (ev.value && ev.bar % 8 < 2) {
    __('#bass').set({ frequency: ev.value }).trigger({ duration: ev.duration * 0.6 });
  }
});
__.transport.sequence('blips', { steps: 'x..x.x..', step: '1/8' }, (ev) => {
  if (ev.value && ev.bar % 8 >= 2 && ev.bar % 8 < 4) __('#blip').trigger({ duration: 0.04 });
});

// Bar 1: empty the looper and record two bars. Bar 3: record a second layer on top.
// Layers after the first are recorded a little quieter (the looper's 'overdub' level).
__.transport.every('8 bars', () => __('#loop').call('clear').trigger());
__.transport.every('8 bars', () => __('#loop').trigger(), { offset: '2 bars' });
`,u=`cracked-up-demo-code-v4`,d=[`cracked-up-demo-code`,`cracked-up-demo-code-v2`,`cracked-up-demo-code-v3`],f=document.querySelector(`#editor`),p=document.querySelector(`#toggle`),m=document.querySelector(`#reset`),h=document.querySelector(`#status`),g=document.querySelector(`#message`),_=null,v=null,y=null,b={text:``,isError:!1},x=``;function S(){g.textContent=[b.text,x].filter(Boolean).join(`
`),g.classList.toggle(`error`,b.isError)}function C(e,t=!1){b={text:e,isError:t},S()}function w(e){x=e,S()}function T(e){let t=e instanceof Error&&e.cause instanceof Error?e.cause:e;return t instanceof Error?`${t.name}: ${t.message}`:String(t)}function E(e){let t=f.value;if(t===y)return;y=t;try{localStorage.setItem(u,t)}catch{}let i;try{i=Function(`__`,`engine`,...Object.keys(n),r(t))}catch(e){C(T(e),!0);return}let a=e.scope(`live`);a.build(t=>i(t,e,...Object.values(n))).then(e=>{if(e.errors[0])return C(T(e.errors[0]),!0);let t=a.select(`*`).length,n=e.unchanged.length+e.updated.length;C(`Running. ${t} node${t===1?``:`s`}: ${n} kept, ${e.added.length} new, ${e.removed.length} removed.`)}).catch(e=>C(T(e),!0))}function D(){let e=_?.context.state===`running`;h.textContent=e?O():_?`Audio is paused.`:`Audio is off. Press Start, or just type.`,h.classList.toggle(`running`,e),p.textContent=e?`Stop audio`:`Start audio`}function O(){if(!_)return``;let{bar:e,beatInBar:t}=_.transport.position;return`${_.transport.bpm} bpm · bar ${e+1} beat ${Math.floor(t)+1}`}function k(){_?.context.state===`running`&&(h.textContent=O()),requestAnimationFrame(k)}function A(){return v??=(async()=>{let e=new AudioContext,n=await t({context:e});return n.bus(`main`).gain.set(.6),n.on(`error`,e=>C(T(e),!0)),n.on(`state`,D),c(n),a(n,e=>{w(e),document.querySelector(`#break-sample`)?.classList.add(`missing`)}),F(n),_=n,Object.assign(window,{engine:n}),k(),n})(),v}async function j(){let e=await A();await e.resume(),e.transport.start(),D(),E(e)}async function M(){_&&await _.context.suspend(),D()}function N(e,t){document.querySelector(`#${e}`).replaceChildren(...t.map(([e,t])=>{let n=document.createElement(`li`),r=document.createElement(`span`);return r.textContent=t?` ${t}`:``,n.append(e,r),n}))}function P(){N(`samples`,[[`'kick'`,``],[`'snare'`,``],[`'hat'`,``]]);let e=document.createElement(`li`);e.id=`break-sample`;let t=document.createElement(`a`);t.href=o.page,t.target=`_blank`,t.rel=`noopener`,t.textContent=s;let n=document.createElement(`span`);n.append(` a drum break in 128 slices. `,t),e.append(`'${o.key}'`,n),document.querySelector(`#samples`).append(e)}function F(e){N(`types`,e.registry.list().map(e=>[e.type,e.params.map(e=>e.name).join(`, `)]))}function I(){N(`helpers`,[[`__()`,`start a chain`],[`__('selector')`,`select nodes`],[`__.transport.sequence(name, options, fn)`,`a repeating pattern`],[`__.transport.every(interval, fn)`,`a repeating callback`],[`__.transport.bpm`,`tempo`]]),document.querySelector(`#helper-groups`).replaceChildren(...i.flatMap(e=>{let t=document.createElement(`h3`);t.textContent=e.title;let n=document.createElement(`ul`);return n.append(...e.helpers.map(e=>{let t=document.createElement(`li`);return t.textContent=e.signature,t.title=e.alias?`${e.description} Also as ${e.alias}, its name in Cracked.`:e.description,t})),[t,n]}))}function L(){let e=/^#code=(.*)$/s.exec(location.hash);if(!e)return null;try{return decodeURIComponent(e[1]??``)}catch{return null}}function R(){let e=L();if(e!==null)return e;try{for(let e of d)localStorage.removeItem(e);return localStorage.getItem(u)??l}catch{return l}}P(),I(),f.value=R();var z=e(f,document.querySelector(`#highlight`));f.addEventListener(`keyup`,()=>{_?E(_):j()}),f.addEventListener(`keydown`,e=>{e.key!==`Tab`||e.metaKey||e.ctrlKey||e.altKey||(e.preventDefault(),f.setRangeText(`  `,f.selectionStart,f.selectionEnd,`end`),z())}),p.addEventListener(`click`,()=>{_?.context.state===`running`?M():j()}),m.addEventListener(`click`,()=>{f.value=l,z(),y=null,_&&E(_),f.focus()}),window.addEventListener(`hashchange`,()=>{let e=L();e!==null&&(f.value=e,z(),_&&E(_))}),D();