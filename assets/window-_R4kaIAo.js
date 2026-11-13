function e(e,r,i={}){let a=i.layerGap??56,o=i.nodeGap??16,s=i.previous,c=new Map;for(let t of e)c.has(t.key)||c.set(t.key,{key:t.key,width:t.width,height:t.height,layer:0,y:0,dummy:!1,index:c.size,float:t.float===!0,ins:[],outs:[]});let l=[...c.values()],u=r.filter(e=>e.from!==e.to&&c.has(e.from)&&c.has(e.to)),d=(e,t)=>`${e.key}\u0000${t.key}`,f=new Map(l.map(e=>[e,[]])),p=new Set;for(let e of u){if(e.weak)continue;let t=c.get(e.from),n=c.get(e.to);p.has(d(t,n))||(p.add(d(t,n)),f.get(t).push(n))}let m=new Set,h=new Map,g=new Set;for(let e of f.values())for(let t of e)g.add(t);let _=e=>{if(h.get(e))return;let t=[[e,0]];for(h.set(e,1);t.length>0;){let e=t[t.length-1],[n,r]=e,i=f.get(n);if(r>=i.length){h.set(n,2),t.pop();continue}e[1]=r+1;let a=i[r],o=h.get(a)??0;o===1?m.add(d(n,a)):o===0&&(h.set(a,1),t.push([a,0]))}};for(let e of l)g.has(e)||_(e);for(let e of l)_(e);let v=new Map(l.map(e=>[e,[]])),y=new Map(l.map(e=>[e,[]])),b=new Set,x=(e,t)=>{b.has(d(e,t))||(b.add(d(e,t)),v.get(e).push(t),y.get(t).push(e))};for(let[e,t]of f)for(let n of t)m.has(d(e,n))?x(n,e):x(e,n);let S=(e,t)=>{let n=new Set([e]),r=[e];for(;r.length>0;){let e=r.pop();if(e===t)return!0;for(let t of v.get(e))n.has(t)||(n.add(t),r.push(t))}return!1};for(let e of u){if(!e.weak)continue;let t=c.get(e.from),n=c.get(e.to);p.has(d(t,n))||b.has(d(t,n))||(p.has(d(n,t))||S(n,t)?(m.add(d(t,n)),x(n,t)):x(t,n))}let C=[],w=new Map(l.map(e=>[e,y.get(e).length])),T=l.filter(e=>w.get(e)===0);for(;T.length>0;){let e=T.shift();C.push(e);for(let t of v.get(e)){let e=w.get(t)-1;w.set(t,e),e===0&&T.push(t)}}for(let e of C)for(let t of v.get(e))t.layer=Math.max(t.layer,e.layer+1);for(let e=C.length-1;e>=0;e--){let t=C[e],n=v.get(t);!t.float||y.get(t).length>0||n.length===0||(t.layer=Math.max(0,Math.min(...n.map(e=>e.layer))-1))}let E=[],D=e=>E[e]??=[];for(let e of l)D(e.layer).push(e);for(let e=0;e<E.length;e++)E[e]??=[];let O=new Map,k=new Map,A=0,j=e=>{let t={key:`\u0000lane${A++}`,width:0,height:12,layer:e,y:0,dummy:!0,index:l.length+A,float:!1,ins:[],outs:[]};return D(e).push(t),t},M=(e,t)=>{e.outs.push(t),t.ins.push(e)},N=new Set;for(let e of u){let t=c.get(e.from),n=c.get(e.to);m.has(d(t,n))||N.add(d(t,n))}for(let e of l)for(let t of v.get(e)){if(N.has(d(e,t))){let n=[],r=e;for(let i=e.layer+1;i<t.layer;i++){let e=j(i);M(r,e),n.push(e),r=e}M(r,t),O.set(d(e,t),n)}if(m.has(d(t,e))){let n=[];for(let r=e.layer;r<=t.layer;r++){let e=j(r),t=n[n.length-1];t&&M(t,e),n.push(e)}n[0].ins.push(e),n[n.length-1].outs.push(t),k.set(d(t,e),n)}}let P=e=>e.y+e.height/2,F=e=>e.length===0?null:e.reduce((e,t)=>e+P(t),0)/e.length,I=e=>e.dummy?void 0:s?.get(e.key),L=s!==void 0&&l.some(e=>I(e)!==void 0);if(L){for(let e of E){let n=e.filter(e=>I(e)!==void 0).sort((e,t)=>I(e).y-I(t).y||e.index-t.index),r=t(n.map(e=>I(e).y),n.map(e=>e.height),o);n.forEach((e,t)=>e.y=r[t])}let e=new Set;for(let t of E)for(let n of t)I(n)!==void 0&&e.add(n);for(let t of E){let r=t.filter(t=>e.has(t)).map(e=>[e.y,e.y+e.height]);for(let i of t){if(e.has(i))continue;let t=F([...i.ins,...i.outs].filter(t=>e.has(t))),a=r.reduce((e,t)=>Math.max(e,t[1]+o),0);i.y=n(r,t===null?a:t-i.height/2,i.height,o),r.push([i.y,i.y+i.height]),e.add(i)}t.sort((e,t)=>e.y-t.y||e.index-t.index)}}else{let e=new Map;(()=>{for(let t of E)t.forEach((t,n)=>e.set(t,n))})();let n=t=>{let n=t?1:E.length-2,r=t?1:-1;for(let i=n;i>=0&&i<E.length;i+=r){let n=E[i],r=new Map;for(let i of n){let n=t?i.ins:i.outs,a=n.reduce((t,n)=>t+e.get(n),0);r.set(i,n.length>0?a/n.length:e.get(i))}n.sort((t,n)=>r.get(t)-r.get(n)||e.get(t)-e.get(n)),n.forEach((t,n)=>e.set(t,n))}};for(let e=0;e<4;e++)n(!0),n(!1);for(let e of E){let t=0;for(let n of e)n.y=t,t+=n.height+o}let r=e=>{let n=e?1:E.length-2,r=e?1:-1;for(let i=n;i>=0&&i<E.length;i+=r){let n=E[i],r=t(n.map(t=>{let n=F(e?t.ins:t.outs);return n===null?t.y:n-t.height/2}),n.map(e=>e.height),o);n.forEach((e,t)=>e.y=r[t])}};for(let e=0;e<6;e++)r(!0),r(!1);r(!0)}let R=[],z=[],B=0;for(let e=0;e<E.length;e++){let t=E[e].reduce((e,t)=>Math.max(e,t.width),0);R.push(B),z.push(t),B+=t+a}if(!L){let e=E.flat(),t=e.reduce((e,t)=>Math.min(e,t.y),1/0);if(Number.isFinite(t))for(let n of e)n.y=Math.round((n.y-t)*2)/2}let V=new Map,H=e=>R[e.layer]+(z[e.layer]-e.width)/2;for(let e of l)V.set(e.key,{x:H(e),y:e.y,width:e.width,height:e.height,layer:e.layer});let U=new Map;for(let e of r){let t=c.get(e.from),n=c.get(e.to);if(!t||!n||t===n)continue;let r=m.has(d(t,n)),i=((r?k:O).get(d(t,n))??[]).map(e=>[{x:R[e.layer],y:P(e)},{x:R[e.layer]+z[e.layer],y:P(e)}]);r&&i.reverse().forEach(e=>e.reverse()),U.set(e.key,{points:[{x:H(t)+t.width,y:P(t)},...i.flat(),{x:H(n),y:P(n)}],reversed:r})}let W=1/0,G=1/0,K=-1/0,q=-1/0;for(let e of V.values())W=Math.min(W,e.x),G=Math.min(G,e.y),K=Math.max(K,e.x+e.width),q=Math.max(q,e.y+e.height);for(let e of U.values()){for(let t of e.points)G=Math.min(G,t.y-6),q=Math.max(q,t.y+6);e.reversed&&(K=Math.max(K,e.points[0].x+40),W=Math.min(W,e.points[e.points.length-1].x-40))}return{nodes:V,edges:U,bounds:V.size===0?{x:0,y:0,width:0,height:0}:{x:W,y:G,width:K-W,height:q-G}}}function t(e,t,n){let r=[],i=0;for(let a=0;a<e.length;a++)r.push(i),i+=t[a]+n;let a=[];for(let t=0;t<e.length;t++)for(a.push({sum:e[t]-r[t],count:1});a.length>1;){let e=a[a.length-1],t=a[a.length-2];if(t.sum/t.count<=e.sum/e.count)break;t.sum+=e.sum,t.count+=e.count,a.pop()}let o=[];for(let t of a)if(t.count===1)o.push(e[o.length]);else for(let e=0;e<t.count;e++)o.push(t.sum/t.count+r[o.length]);return o}function n(e,t,n,r){let i=t=>e.every(e=>t+n+r<=e[0]||t>=e[1]+r);if(i(t))return t;let a=t,o=1/0;for(let s of e)for(let e of[s[0]-r-n,s[1]+r]){let n=Math.abs(e-t);n<o&&i(e)&&(a=e,o=n)}return a}function r(e){let t=e.points,n=t[0];if(!n)return``;let r=e=>String(Math.round(e*10)/10),i=`M${r(n.x)} ${r(n.y)}`;for(let n=1;n<t.length;n++){let a=t[n-1],o=t[n];if(a.y===o.y&&o.x>a.x!==e.reversed){i+=` L${r(o.x)} ${r(o.y)}`;continue}if(!e.reversed){let e=Math.max(16,(o.x-a.x)/2);i+=` C${r(a.x+e)} ${r(a.y)} ${r(o.x-e)} ${r(o.y)} ${r(o.x)} ${r(o.y)}`;continue}let s=n===1,c=n===t.length-1,l=Math.max(16,(a.x-o.x)/2),u=s?Math.max(a.x,o.x)+52:a.x-l,d=c?Math.min(a.x,o.x)-52:o.x+l;i+=` C${r(u)} ${r(a.y)} ${r(d)} ${r(o.y)} ${r(o.x)} ${r(o.y)}`}return i}var i=-100;function a(e){return e>0?Math.max(i,20*Math.log10(e)):i}function o(e,t){let n=t??{peak:0,rms:0,min:0,max:0,last:0},r=e.length;if(r===0)return n.peak=n.rms=n.min=n.max=n.last=0,n;let i=1/0,a=-1/0,o=0;for(let t=0;t<r;t++){let n=e[t];n<i&&(i=n),n>a&&(a=n),o+=n*n}return!(i<=a)||Number.isNaN(o)?(n.peak=n.rms=n.min=n.max=n.last=0,n):(n.min=i,n.max=a,n.peak=Math.max(-i,a),n.rms=Math.sqrt(o/r),n.last=e[r-1],n)}var s=class{peakDb=i;rmsDb=i;holdDb=i;clipped=!1;meanSquare=0;held=0;update(e,t){let n=Math.max(0,t),r=a(e.peak);this.peakDb=Math.max(r,this.peakDb-24*n,i);let o=e.rms*e.rms,s=n>0?Math.exp(-n/.12):1;this.meanSquare=o+(this.meanSquare-o)*s,this.rmsDb=a(Math.sqrt(this.meanSquare)),r>=this.holdDb?(this.holdDb=r,this.held=0,this.clipped=e.peak>1):(this.held+=n,this.held>1&&(this.holdDb=Math.max(r,this.holdDb-24*n,i),this.holdDb<0&&(this.clipped=!1)))}idle(e){this.update(c,e)}get silent(){return this.peakDb<=-60&&this.holdDb<=-60}get activity(){return u((this.peakDb- -60)/48)}},c={peak:0,rms:0,min:0,max:0,last:0},l=class{value=0;low=0;high=0;scale=0;started=!1;history=[];update(e,t){let n=Math.max(0,t);this.value=e.last;for(let e of this.history)e[0]+=n;for(;this.history.length>0&&this.history[0][0]>2;)this.history.shift();this.history.push([0,e.min,e.max]);let r=1/0,i=-1/0;for(let e of this.history)e[1]<r&&(r=e[1]),e[2]>i&&(i=e[2]);this.low=r,this.high=i;let a=Math.max(Math.abs(r),Math.abs(i));this.scale=this.started?Math.max(a,this.scale*Math.exp(-n/4)):a,this.started=!0}idle(){}get activity(){return this.scale>0?u((this.high-this.low)/this.scale):0}};function u(e){return e<0?0:e>1?1:e}function d(e){if(!Number.isFinite(e))return String(e);let t=Math.abs(e);return t===0?`0`:t>=1e3?String(Math.round(e)):t>=100?f(e.toFixed(1)):t>=1?f(e.toFixed(2)):t>=1e-6?String(Number(e.toPrecision(3))):e.toExponential(1)}function f(e){return e.includes(`.`)?e.replace(/\.?0+$/,``):e}function p(e){return e<=-100?`-inf`:e.toFixed(1)}var m=(e,t)=>`${e}#${t}`,h=(e,t)=>`${e}@${t}`,g=(e,t)=>`${e}/${t}`,_=e=>`${e}!out`,v=(e,t)=>t===`scope`;function y(e,t=v,n=``){let{snapshot:r}=e,i=new Map(r.buses.map(e=>[e.name,e])),a=new Map,o=new Map,s=(e,t,n,r=null)=>{let i=`${e}>${t}${r===null?``:`:${r}`}`;o.has(i)||o.set(i,{key:i,from:e,to:t,kind:n,param:r})};for(let i of r.graph.nodes){let r=Object.hasOwn(e.types,i.type)?e.types[i.type]:void 0,o=m(n,i.id),s=r?.isMacro??!1,c=Object.hasOwn(e.macros,i.id)?e.macros[i.id]:void 0;a.set(o,{key:o,kind:`node`,id:i.id,type:i.type,category:r?.category??null,classes:i.classes??[],bypassed:i.bypass===!0,macro:s,triggerable:r?.triggerable??!1,autoId:RegExp(`^${S(i.type)}-\\d+$`).test(i.id),external:!1,signal:`audio`,expandable:s,children:s&&c&&t(o,`macro`)?y(c,t,o):null})}let c=e=>{let t=h(n,e);return a.has(t)||a.set(t,{key:t,kind:`bus`,id:e,type:`bus`,category:null,classes:[],bypassed:!1,macro:!1,triggerable:!1,autoId:!1,external:!i.has(e),signal:`audio`,expandable:!1,children:null}),t};if(!e.inner)for(let e of i.keys())c(e);for(let e of r.graph.edges){let t=typeof e.from==`string`?m(n,e.from):c(e.from.bus);`bus`in e.to?s(t,c(e.to.bus),`audio`):`param`in e.to?s(t,m(n,e.to.node),`modulation`,e.to.param):s(t,m(n,e.to.node),`audio`)}for(let t of e.incoming)s(c(t.bus),m(n,t.node),`audio`);for(let t of i.values())if(t.to!==null)s(c(t.name),c(t.to),`route`);else if(e.root&&t.name===`main`){let e=_(n);a.set(e,{key:e,kind:`output`,id:`out`,type:`output`,category:null,classes:[],bypassed:!1,macro:!1,triggerable:!1,autoId:!1,external:!1,signal:`audio`,expandable:!1,children:null}),s(c(t.name),e,`route`)}for(let r of e.children){let e=g(n,r.snapshot.name);a.set(e,{key:e,kind:`scope`,id:r.snapshot.name,type:`scope`,category:null,classes:[],bypassed:!1,macro:!1,triggerable:!1,autoId:!1,external:!1,signal:`audio`,expandable:!0,children:t(e,`scope`)?y(r,t,e):null});let i=b(r);for(let t of i.sends)s(e,c(t),`link`);for(let t of i.receives)s(c(t),e,`link`)}let l=[...a.values()],u=[...o.values()].filter(e=>a.has(e.from)&&a.has(e.to)),d=x(l,u);return{path:n,name:r.name,nodes:l.map(e=>d.has(e.key)?{...e,signal:`control`}:e),edges:u}}function b(e){let t=new Set(e.snapshot.buses.map(e=>e.name)),n=new Set,r=new Set;for(let r of e.snapshot.graph.edges)`bus`in r.to&&!t.has(r.to.bus)&&n.add(r.to.bus);for(let r of e.snapshot.buses)r.to!==null&&!t.has(r.to)&&n.add(r.to);for(let n of e.incoming)t.has(n.bus)||r.add(n.bus);for(let i of e.children){let e=b(i);for(let r of e.sends)t.has(r)||n.add(r);for(let n of e.receives)t.has(n)||r.add(n)}return{sends:n,receives:r}}function x(e,t){let n=new Set;for(let t of e)t.category===`modulator`&&n.add(t.key);let r=new Map;for(let e of t){let t=r.get(e.from);t?t.push(e):r.set(e.from,[e])}let i=!0;for(;i;){i=!1;for(let t of e){if(t.kind!==`node`||n.has(t.key))continue;let e=r.get(t.key);e&&e.length!==0&&e.every(e=>e.kind===`modulation`||n.has(e.to))&&(n.add(t.key),i=!0)}}return n}function S(e){return e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`)}function C(e){let t=[],n=e=>{for(let r of e.nodes)t.push(`${r.key}|${r.type}|${r.classes.join(` `)}|${r.bypassed?`b`:``}|${r.signal}|${r.children?`open`:``}`),r.children&&n(r.children);for(let n of e.edges)t.push(n.key)};return n(e),t.join(`
`)}function w(e){return e.select(`*`).nodes.filter(t=>t.scope===e)}function T(e,t=v){let n=new Map,r=[];return{source:E(e,t,``,n,r),handles:n,scopes:r}}function E(e,t,n,r,i){i.push(e);let a=e.snapshot(),o=e.engine.registry,s=new Set(a.buses.map(e=>e.name)),c={},l={},u=[];for(let e of a.graph.nodes)if(!Object.hasOwn(c,e.type)&&o.has(e.type)){let t=o.describe(e.type);c[e.type]={category:t.category,isMacro:t.isMacro,triggerable:t.triggerable}}let d=new Set;for(let t=e.parent;t;t=t.parent)d.add(t);for(let a of w(e)){let o=m(n,a.id);r.set(o,{node:a,bus:null,scope:null});for(let t of a.inputs){let n=t.from;if(n.scope===e||!d.has(n.scope)||!n.id.startsWith(`bus:`))continue;let r=n.id.slice(4);s.has(r)||e.bus(r).output===n.output&&u.push({bus:r,node:a.id})}let c=a.insideScope;c&&t(o,`macro`)&&(l[a.id]=E(c,t,o,r,i))}let f=e.children.map(e=>E(e,t,g(n,e.name),r,i));for(let t of e.children)r.set(g(n,t.name),{node:null,bus:null,scope:t});let p={snapshot:a,root:e.parent===null&&e.owner===null,inner:e.owner!==null,types:c,incoming:u,macros:l,children:f},_=new Set(s);for(let e of a.graph.edges)`bus`in e.to&&_.add(e.to.bus);for(let e of a.buses)e.to!==null&&_.add(e.to);for(let e of u)_.add(e.bus);for(let e of f){let t=b(e);for(let e of[...t.sends,...t.receives])_.add(e)}for(let t of _)r.set(h(n,t),{node:null,bus:e.bus(t),scope:null});return p}var D={hz:` Hz`,db:` dB`,seconds:` s`,ms:` ms`,beats:` beats`,cents:` ct`,semitones:` st`};function O(e,t){return typeof e==`boolean`?e?`on`:`off`:typeof e==`string`?e:d(e)+(t.kind===`number`?D[t.unit]??``:``)}function k(e){let t=e.meta;return{name:e.name,kind:t.kind,value:e.value,text:O(e.value,t),unit:t.kind===`number`?t.unit:`none`,min:t.kind===`number`?t.min:null,max:t.kind===`number`?t.max:null,default:t.default,rate:t.rate,description:t.description??``,modulators:e.modulators.map(e=>({id:e.source.id,type:e.source.type}))}}var A=e=>e.id.startsWith(`bus:`)?`bus ${e.id.slice(4)}`:`${e.type} #${e.id}`;function j(e){return`meta`in e?`${e.name} of ${A(e.node)}`:`params`in e?A(e):`bus ${e.name}`}function M(e,t){return{kind:`node`,id:e.id,type:e.type,category:t?.category??null,description:t?.description??``,classes:[...e.classes],tags:e.tags,bypassed:e.bypass,macro:t?.isMacro??!1,triggerable:(t?.triggerable??!1)&&t?.category!==`io`,params:Object.keys(e.params).map(t=>k(e.param(t))),inputs:e.inputs.map(e=>A(e.from)),outputs:e.outputs.map(e=>j(e.to))}}function N(e,t){return{kind:`bus`,id:e.name,type:`bus`,category:null,description:`A named mix point: several chains go in, one signal comes out. `+(t===null?``:`This one is sent on to the bus "${t}".`),classes:[],tags:{},bypassed:!1,macro:!1,triggerable:!1,params:[k(e.gain)],inputs:[],outputs:t===null?[]:[`bus ${t}`]}}function P(e,t){let n={};if(!t)return n;Object.hasOwn(t.triggerOptions,`pitch`)&&(n.pitch=60);let r=Object.hasOwn(e.params,`speed`)||Object.hasOwn(e.params,`loop`);return Object.hasOwn(t.triggerOptions,`duration`)&&!r&&(n.duration=.3),n}function F(e,t=``,n=``){let r=document.createElement(e);return t&&(r.className=t),n&&(r.textContent=n),r}var I=class{host;element=F(`aside`,`detail`);title=F(`h2`);name=F(`span`,`name`);desc=F(`p`,`desc`);actions=F(`div`,`actions`);canvas=F(`canvas`,`signal`);readout=F(`div`,`readout`);params=F(`table`);paramsHead=F(`h3`,``,`Parameters`);links=F(`p`,`links`);handle=null;info=null;signal=`audio`;busTo=null;bypass=null;shown=``;sinceText=1;wave=new Float32Array;spectrum=new Float32Array;stats={peak:0,rms:0,min:0,max:0,last:0};level=new s;range=new l;history=[];constructor(e){this.host=e,this.element.hidden=!0,this.element.setAttribute(`aria-label`,`Node details`);let t=F(`header`),n=F(`button`,`close`,`×`);n.type=`button`,n.setAttribute(`aria-label`,`Close details`),n.addEventListener(`click`,()=>this.host.close()),t.append(this.title,this.name,n),this.canvas.setAttribute(`role`,`img`),this.canvas.setAttribute(`aria-label`,`Level, waveform and spectrum of this output`),this.element.append(t,this.desc,this.actions,this.canvas,this.readout,this.paramsHead,this.params,this.links)}get open(){return this.handle!==null}modulatorIds(){let e=this.handle?.node;if(!e||e.disposed)return[];let t=[];for(let n of Object.keys(e.params))for(let r of e.param(n).modulators)t.push(r.source.id);return t}show(e,t,n,r,i){this.handle=e,this.info=t,this.signal=n,this.busTo=r,this.level=new s,this.range=new l,this.history=[],this.shown=``,this.element.hidden=!1,this.actions.replaceChildren(),this.bypass=null;let a=e.node;if(a){let e=F(`label`),n=F(`input`);if(n.type=`checkbox`,n.checked=a.bypass,n.addEventListener(`change`,()=>{a.disposed||(a.bypass=n.checked),this.host.changed()}),e.append(n,`Bypass`),this.bypass=n,this.actions.append(e),M(a,t).triggerable){let e=F(`button`,`trigger`,`Trigger`);e.type=`button`,e.addEventListener(`click`,()=>{a.disposed||a.trigger(P(a,t))}),this.actions.append(e)}if(i){let e=F(`button`,`open`,`Open inside`);e.type=`button`,e.addEventListener(`click`,()=>this.host.enter()),this.actions.append(e)}}this.renderText()}textChanged(){this.sinceText=1}hide(){this.handle=null,this.element.hidden=!0}detail(){let e=this.handle;return e?e.node?e.node.disposed?null:M(e.node,this.info):e.bus?N(e.bus,this.busTo):null:null}renderText(){let e=this.detail();if(!e)return;let t=e.params.map(e=>e.modulators.map(e=>{let t=this.host.meterFor(e.id),n=t instanceof l?` ${d(t.low)} to ${d(t.high)}`:``;return`${e.type} #${e.id}${n}`}));this.bypass&&this.bypass.checked!==e.bypassed&&(this.bypass.checked=e.bypassed);let n=JSON.stringify([e,t]);if(n===this.shown)return;this.shown=n,this.title.textContent=e.type===`bus`?`bus`:e.type,this.name.textContent=e.kind===`bus`?e.id:[`#${e.id}`,...e.classes.map(e=>`.${e}`)].join(` `),this.desc.textContent=e.description,this.paramsHead.hidden=e.params.length===0,this.params.replaceChildren(...e.params.map((e,n)=>{let r=F(`tr`);r.title=e.description;let i=F(`td`,`pname`,e.name),a=F(`td`,`pvalue`,e.text),o=F(`td`,`pmeta`,[e.min!==null&&e.max!==null?`${d(e.min)} to ${d(e.max)}`:``,e.unit===`none`?``:e.unit,e.rate===`audio`?``:e.rate].filter(Boolean).join(` · `));for(let e of t[n]??[])o.append(F(`span`,`mod`,`moved by ${e}`));return r.append(i,a,o),r}));let r=[];e.inputs.length>0&&(r.push(`From `),e.inputs.forEach((e,t)=>r.push(t?`, `:``,F(`span`,``,e))),r.push(`. `)),e.outputs.length>0&&(r.push(`To `),e.outputs.forEach((e,t)=>r.push(t?`, `:``,F(`span`,``,e))),r.push(`.`)),this.links.replaceChildren(...r)}frame(e,t,n,r){if(!this.handle)return;this.sinceText+=t,this.sinceText>=.15&&(this.sinceText=0,this.renderText());let i=!1;e?(this.wave.length!==e.fftSize&&(this.wave=new Float32Array(e.fftSize),this.spectrum=new Float32Array(e.frequencyBinCount)),e.getFloatTimeDomainData(this.wave),o(this.wave,this.stats),this.level.update(this.stats,t),this.range.update(this.stats,t),this.history.push(this.stats.min,this.stats.max),this.history.length>480&&this.history.splice(0,2),this.signal===`audio`&&e.getFloatFrequencyData(this.spectrum),i=!0):this.level.idle(t),this.draw(n,i,r)}draw(e,t,n){let r=this.canvas,i=window.devicePixelRatio||1,a=r.clientWidth,o=r.clientHeight;if(a===0||o===0)return;(r.width!==Math.round(a*i)||r.height!==Math.round(o*i))&&(r.width=Math.round(a*i),r.height=Math.round(o*i));let s=r.getContext(`2d`);if(!s)return;s.setTransform(i,0,0,i,0,0),s.clearRect(0,0,a,o),s.font=`10px ui-monospace, Menlo, Consolas, monospace`,s.textBaseline=`top`;let c=a-16;if(this.signal===`control`){this.drawControl(s,e,8,c,o);let n=this.range;this.readout.textContent=t?`value ${d(n.value)} · range ${d(n.low)} to ${d(n.high)}`:`No signal to read while audio is not running.`;return}let l=e=>c*Math.min(1,Math.max(0,(e- -60)/60));s.fillStyle=e.border,s.fillRect(8,8,c,12),s.fillStyle=e.ok,s.globalAlpha=.4,s.fillRect(8,8,l(this.level.peakDb),12),s.globalAlpha=1,s.fillRect(8,8,l(this.level.rmsDb),12),this.level.holdDb>-60&&(s.fillStyle=this.level.clipped?e.clip:e.text,s.fillRect(8+l(this.level.holdDb)-1,8,2,12)),s.fillStyle=e.muted;for(let e of[-48,-36,-24,-12,0]){let t=8+l(e);s.fillRect(Math.min(t,8+c-1),20,1,3),s.textAlign=e===0?`right`:`center`,s.fillText(String(e),t,24)}let u=o-108-8;s.strokeStyle=e.border,s.lineWidth=1,s.beginPath(),s.moveTo(8,70.5),s.lineTo(8+c,70.5),s.stroke();let f=this.wave;if(t&&f.length>0){let t=f.length>>1,n=0;for(let e=1;e<t;e++)if(f[e-1]<=0&&f[e]>0){n=e;break}let r=Math.max(1,this.stats.peak);s.strokeStyle=e.ok,s.lineWidth=1.25,s.beginPath();let i=Math.min(t,Math.max(2,Math.floor(c)));for(let e=0;e<i;e++){let a=f[n+Math.floor(e/(i-1)*(t-1))]??0,o=8+e/(i-1)*c,l=70-a/r*27;e===0?s.moveTo(o,l):s.lineTo(o,l)}s.stroke()}s.strokeStyle=e.border,s.lineWidth=1,s.strokeRect(8.5,108.5,c-1,u-1);let m=Math.log(30),h=Math.log(2e4);s.fillStyle=e.muted,s.textAlign=`center`;for(let e of[100,1e3,1e4]){let t=8+(Math.log(e)-m)/(h-m)*c;s.globalAlpha=.5,s.fillRect(Math.round(t),109,1,u-2),s.globalAlpha=1,s.fillText(e>=1e3?`${e/1e3}k`:String(e),t,111)}let g=this.spectrum;if(t&&g.length>0){let t=n/2/g.length;s.fillStyle=e.ok,s.globalAlpha=.75,s.beginPath(),s.moveTo(8,108+u-1);let r=Math.max(2,Math.floor(c/2));for(let e=0;e<r;e++){let n=Math.exp(m+e/r*(h-m))/t,i=Math.exp(m+(e+1)/r*(h-m))/t,a=-1/0,o=Math.min(g.length-1,Math.max(Math.floor(n),Math.ceil(i)-1));for(let e=Math.min(g.length-1,Math.floor(n));e<=o;e++)g[e]>a&&(a=g[e]);let l=Math.min(1,Math.max(0,(a+100)/100));s.lineTo(8+e/(r-1)*c,108+u-1-l*(u-2))}s.lineTo(8+c,108+u-1),s.closePath(),s.fill(),s.globalAlpha=1}this.readout.textContent=t?`peak ${p(this.level.holdDb)} dB · rms ${p(this.level.rmsDb)} dB`:`No signal to read while audio is not running.`}drawControl(e,t,n,r,i){let a=n+12,o=i-a-n,s=this.range.scale>0?this.range.scale:1,c=e=>a+o/2-Math.max(-1,Math.min(1,e/s))*(o-4)/2;e.strokeStyle=t.border,e.lineWidth=1,e.strokeRect(n+.5,a+.5,r-1,o-1),e.beginPath(),e.moveTo(n,Math.round(c(0))+.5),e.lineTo(n+r,Math.round(c(0))+.5),e.stroke(),e.fillStyle=t.muted,e.textAlign=`left`,e.fillText(`+${d(s)}`,n,n-2),e.textAlign=`right`,e.fillText(`last 4 seconds`,n+r,n-2);let l=this.history,u=l.length/2;if(!(u<1)){e.strokeStyle=t.mod,e.lineWidth=1.5,e.lineJoin=`round`,e.beginPath();for(let t=0;t<u;t++){let i=n+r-(u-1-t)/239*r,a=c(l[t*2]),o=c(l[t*2+1]);t===0?e.moveTo(i,a):e.lineTo(i,a),Math.abs(a-o)>.5&&e.lineTo(i,o)}e.stroke()}}},L=`
:host {
  color-scheme: light dark;
  display: block;
  min-width: 0;
  min-height: 0;
  --bg: var(--cu-inspect-bg, light-dark(#f6f5f1, #171716));
  --panel: var(--cu-inspect-panel, light-dark(#ffffff, #1f1f1d));
  --text: var(--cu-inspect-text, light-dark(#1d1d1b, #ecebe6));
  --muted: var(--cu-inspect-muted, light-dark(#6b6a65, #98968f));
  --border: var(--cu-inspect-border, light-dark(#d9d7cf, #34332f));
  --edge: var(--cu-inspect-edge, light-dark(#b9b6ab, #55534d));
  --accent: var(--cu-inspect-accent, light-dark(#b4530a, #f0a35e));
  --ok: var(--cu-inspect-level, light-dark(#2f7d4f, #7fd3a0));
  --clip: var(--cu-inspect-clip, light-dark(#c42b1c, #ff8a7a));
  --mod: var(--cu-inspect-modulation, light-dark(#8a3ea8, #cda8f2));
  --group: var(--cu-inspect-group, light-dark(rgba(29, 29, 27, 0.035), rgba(236, 235, 230, 0.04)));
}
:host([data-theme='light']) {
  color-scheme: light;
}
:host([data-theme='dark']) {
  color-scheme: dark;
}
* {
  box-sizing: border-box;
}
.root {
  container-type: inline-size;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--bg);
  color: var(--text);
  font:
    13px/1.4 system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
}
button {
  font: inherit;
  color: inherit;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 9px;
  cursor: pointer;
}
button:hover {
  border-color: var(--accent);
}
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  min-width: 0;
}
.crumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  font-size: 12px;
}
.crumbs button {
  border-color: transparent;
  background: none;
  padding: 2px 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 1 auto;
}
.crumbs button[aria-current] {
  font-weight: 600;
  cursor: default;
}
.crumbs .sep {
  color: var(--muted);
}
.bar .tool {
  min-width: 28px;
  padding: 2px 7px;
  font-size: 12px;
}
.body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
}
.body.with-detail {
  grid-template-rows: minmax(0, 1fr) minmax(0, 46%);
}
@container (min-width: 760px) {
  .body.with-detail {
    grid-template-columns: minmax(0, 1fr) 320px;
    grid-template-rows: minmax(0, 1fr);
  }
  .body.with-detail .detail {
    border-top: 0;
    border-left: 1px solid var(--border);
  }
}
.viewport {
  position: relative;
  overflow: hidden;
  min-height: 0;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  background: var(--bg);
}
.viewport.panning {
  cursor: grabbing;
}
.world {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  transform-origin: 0 0;
}
.edges {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  overflow: visible;
  pointer-events: none;
}
.edges path {
  fill: none;
  stroke: var(--edge);
  stroke-width: 1.5;
}
.edges path.modulation {
  stroke: var(--mod);
  stroke-dasharray: 2 4;
  stroke-linecap: round;
  opacity: 0.75;
}
.edges path.route {
  stroke-width: 2;
}
.edges path.link {
  stroke-dasharray: 6 5;
}
.edges .head {
  fill: var(--edge);
  stroke: none;
}
.edges .head.modulation {
  fill: var(--mod);
}
.edges text {
  font:
    10px ui-monospace,
    'SF Mono',
    Menlo,
    Consolas,
    monospace;
  fill: var(--mod);
  stroke: var(--bg);
  stroke-width: 3px;
  paint-order: stroke;
}
canvas.live {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.node,
.group {
  position: absolute;
  left: 0;
  top: 0;
  cursor: pointer;
}
.node {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2px 16px 2px 9px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-left: 3px solid var(--muted);
  border-radius: 6px;
  white-space: nowrap;
  animation: arrive 0.25s ease-out;
}
@keyframes arrive {
  from {
    opacity: 0;
  }
}
.node:hover,
.group:hover > .group-head {
  border-color: var(--accent);
}
.node .type,
.group .type {
  font-weight: 600;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.node .name,
.group .name {
  font:
    10.5px ui-monospace,
    'SF Mono',
    Menlo,
    Consolas,
    monospace;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
}
.node .name:empty {
  display: none;
}
/* The stripe on the left says what kind of thing a node is. */
.node.cat-source,
.node.cat-synth,
.node.cat-io {
  border-left-color: var(--accent);
}
.node.control {
  border-left-color: var(--mod);
}
.node.bus {
  border-radius: 999px;
  border-left-width: 1px;
  border-left-color: var(--border);
  padding: 0 20px 0 14px;
  align-items: flex-start;
}
.node.bus .type {
  font-weight: 500;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11.5px;
}
.node.bus.external {
  border-style: dashed;
  background: none;
}
.node.output {
  border-radius: 999px;
  border-left-width: 1px;
  border-left-color: var(--border);
  padding: 0;
  align-items: center;
  color: var(--muted);
  cursor: default;
}
.node.macro,
.node.scope {
  box-shadow: 3px 3px 0 -1px var(--panel), 3px 3px 0 0 var(--border);
  padding-left: 26px;
}
.node.scope {
  border-left-color: var(--border);
  border-left-width: 1px;
  border-style: dashed;
}
.node.bypassed {
  border-style: dashed;
  background: repeating-linear-gradient(
    -45deg,
    var(--panel),
    var(--panel) 5px,
    var(--bg) 5px,
    var(--bg) 10px
  );
}
.node.bypassed .type {
  text-decoration: line-through;
  color: var(--muted);
}
.node .flag {
  position: absolute;
  right: 14px;
  bottom: 4px;
  font-size: 8.5px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
}
/* The track of the meter. The level itself is painted on the canvas above. */
.node:not(.output):not(.scope)::after,
.group:not(.scope) > .group-head::after {
  content: '';
  position: absolute;
  right: 5px;
  top: 4px;
  bottom: 4px;
  width: 4px;
  border-radius: 1px;
  background: var(--border);
  opacity: 0.7;
}
.node.bus::after {
  right: 8px;
}
.node.selected,
.group.selected > .group-head {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}
.node.macro.selected {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}
.expand,
.enter {
  position: absolute;
  left: 4px;
  top: 50%;
  translate: 0 -50%;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1;
  color: var(--muted);
  background: none;
}
.group {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--group);
  cursor: default;
}
.group.scope {
  border-style: dashed;
}
.group-head {
  position: absolute;
  left: -1px;
  top: -1px;
  right: -1px;
  height: 26px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px 0 26px;
  border: 1px solid var(--border);
  border-radius: 8px 8px 0 0;
  background: var(--panel);
  white-space: nowrap;
  cursor: pointer;
}
.group.scope > .group-head {
  border-style: dashed;
}
.group-head .enter {
  position: static;
  translate: none;
  margin-left: auto;
  flex: none;
  font-size: 11px;
}
.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  text-align: center;
  color: var(--muted);
  pointer-events: none;
}
.empty[hidden] {
  display: none;
}
.status {
  display: flex;
  gap: 10px;
  padding: 4px 10px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
}
.status .state.running {
  color: var(--ok);
}
.status .cost {
  margin-left: auto;
}

/* --- Detail panel ---------------------------------------------------------------------------- */
.detail {
  border-top: 1px solid var(--border);
  background: var(--panel);
  overflow: auto;
  padding: 10px 12px 14px;
  min-height: 0;
  font-size: 12px;
}
.detail[hidden] {
  display: none;
}
.detail header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.detail h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.detail header .name {
  font:
    11.5px ui-monospace,
    'SF Mono',
    Menlo,
    Consolas,
    monospace;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.detail header .close {
  border-color: transparent;
  background: none;
  padding: 0 6px;
  font-size: 16px;
  line-height: 1.2;
}
.detail .desc {
  margin: 6px 0 8px;
  color: var(--muted);
  max-height: 5.6em;
  overflow: auto;
}
.detail .actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 8px 0;
}
.detail .actions:empty {
  display: none;
}
.detail .actions label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}
.detail canvas.signal {
  display: block;
  width: 100%;
  height: 176px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
}
.detail .readout {
  margin: 4px 0 10px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  min-height: 1.4em;
}
.detail h3 {
  margin: 12px 0 4px;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.detail table {
  border-collapse: collapse;
  width: 100%;
}
.detail td {
  vertical-align: top;
  padding: 3px 8px 3px 0;
  border-bottom: 1px solid var(--border);
}
.detail td.pname {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11.5px;
  white-space: nowrap;
}
.detail td.pvalue {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  font-weight: 600;
}
.detail td.pmeta {
  color: var(--muted);
  padding-right: 0;
}
.detail .mod {
  display: block;
  color: var(--mod);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
}
.detail .links {
  margin: 0;
  color: var(--muted);
}
.detail .links span {
  color: var(--text);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
}
.probe {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  visibility: hidden;
}
@media (prefers-reduced-motion: reduce) {
  .node {
    animation: none;
  }
}

/* --- The ready-made window (openInspector) --------------------------------------------------- */
.window {
  position: fixed;
  z-index: 2147483000;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
  font:
    13px/1.4 system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
}
.window.sidebar {
  top: 0;
  right: 0;
  bottom: 0;
  width: min(var(--cu-inspect-width, 420px), 100vw);
  border-width: 0 0 0 1px;
}
.window.sidebar.wide {
  width: 100vw;
  border-left-width: 0;
}
.window.modal {
  inset: 5vh 5vw;
  border-radius: 10px;
  overflow: hidden;
}
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147482999;
  background: rgba(0, 0, 0, 0.35);
}
.window-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 8px 12px;
  border-bottom: 1px solid var(--border);
}
.window-head h1 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  flex: 1;
}
.window-body {
  min-height: 0;
  display: grid;
}
`,R=1,z=class{context;size;smoothing;taps=new Map;buffer;constructor(e,t=1024,n=0){this.context=e,this.size=t,this.smoothing=n,this.buffer=new Float32Array(t)}get count(){return this.taps.size}has(e){return this.taps.has(e)}sync(e,t){for(let[n,r]of this.taps){let i=e.get(n);i===void 0?(r.idle+=t,r.idle>R&&this.remove(n)):i===r.source?r.idle=0:this.remove(n)}for(let[t,n]of e){if(this.taps.has(t))continue;let e=new AnalyserNode(this.context,{fftSize:this.size,smoothingTimeConstant:this.smoothing});n.connect(e),this.taps.set(t,{source:n,analyser:e,idle:0})}}read(e){let t=this.taps.get(e);return t?(t.analyser.getFloatTimeDomainData(this.buffer),this.buffer):null}analyser(e){return this.taps.get(e)?.analyser??null}remove(e){let t=this.taps.get(e);if(t){this.taps.delete(e);try{t.source.disconnect(t.analyser)}catch{}}}clear(){for(let e of[...this.taps.keys()])this.remove(e)}},B=124,V=38,H=28,U=26,W=14,G=36,K=[3,11],q=.15,J=.7,ee=2.5,Y=`http://www.w3.org/2000/svg`;function X(e,t=``,n=``){let r=document.createElement(e);return t&&(r.className=t),n&&(r.textContent=n),r}function te(e){return e.kind===`output`?{width:44,height:H}:e.kind===`bus`?{width:Math.min(160,Math.max(64,e.id.length*7.2+44)),height:H}:{width:e.expandable?138:B,height:V}}function ne(e){return`root`in e&&`registry`in e}function Z(e,t){return new re(e,t)}var re=class{element=X(`div`,`cu-inspector`);engine;home;current;states=new WeakMap;options;root=X(`div`,`root`);crumbs=X(`nav`,`crumbs`);body=X(`div`,`body`);viewport=X(`div`,`viewport`);world=X(`div`,`world`);groupLayer=X(`div`,`groups`);svg=document.createElementNS(Y,`svg`);nodeLayer=X(`div`,`nodes`);canvas=X(`canvas`,`live`);empty=X(`div`,`empty`);statusCount=X(`span`,`count`);statusState=X(`span`,`state`);statusCost=X(`span`,`cost`);probes=X(`div`,`probe`);panel;model=null;sig=``;handles=new Map;placed=new Map;placedEdges=[];bounds={x:0,y:0,width:0,height:0};nodeEls=new Map;edgeEls=new Map;labelEls=new Map;selectedKey=null;selectedHandle=null;transform={x:0,y:0,k:1};size={width:0,height:0};visibleNodes=[];visibleEdges=[];viewDirty=!0;paintDirty=!0;taps=null;probe=null;meters=new Map;block={peak:0,rms:0,min:0,max:0,last:0};wanted=new Map;probeWanted=new Map;raf=0;lastFrame=0;sincePoll=0;sinceStatus=1;sinceColors=10;flow=0;dirty=!0;textDirty=!1;frameMs=0;worst=[];destroyed=!1;colors={bg:`#fff`,panel:`#fff`,text:`#000`,muted:`#666`,border:`#ccc`,edge:`#bbb`,accent:`#b4530a`,ok:`#2f7d4f`,clip:`#c42b1c`,mod:`#8a3ea8`};probeEls=new Map;reducedMotion=null;unsubscribe=[];cleanup=[];suppressClick=!1;constructor(e,t){this.options=t,this.home=ne(e)?e.root:e,this.engine=this.home.engine,this.current=this.home,this.panel=new I({meterFor:e=>{let t=this.selectedKey;if(t===null)return null;let n=t.slice(0,t.lastIndexOf(`#`)+1);return this.meters.get(n+e)??null},close:()=>this.selectKey(null),enter:()=>{this.selectedKey!==null&&this.enter(this.selectedKey)},changed:()=>this.refresh()}),this.build(),t.parent.append(this.element),this.setTheme(t.theme??`auto`),this.resolveColors(),this.measureViewport(),this.refresh(),this.lastFrame=performance.now(),this.raf=requestAnimationFrame(this.tick)}get scope(){return this.current}get selected(){return this.selectedHandle?.node??null}setScope(e){if(e===this.current)return;this.state().transform={...this.transform},this.pathTo(e)||(this.home=e),this.current=e,this.selectKey(null);for(let e of this.nodeEls.values())e.remove();for(let e of this.edgeEls.values())this.removeEdgeEls(e);for(let e of this.labelEls.values())e.remove();this.nodeEls.clear(),this.edgeEls.clear(),this.labelEls.clear(),this.meters.clear(),this.sig=``;let t=this.state().transform;t&&this.setTransform(t),this.refresh()}refresh(){if(this.destroyed)return;this.dirty=!1,this.sincePoll=0;let e=this.state(),t=(t,n)=>e.toggles.get(t)??n===`scope`,n;this.empty.textContent=`This scope has no nodes yet.`;try{let e=T(this.current,t);n=y(e.source,t),this.handles=e.handles,this.subscribe(e.scopes)}catch(e){this.handles=new Map,this.subscribe([]),n={path:``,name:this.current.name,nodes:[],edges:[]},this.empty.textContent=`This scope can no longer be read: ${e instanceof Error?e.message:String(e)}`}let r=C(n);this.syncSelection(),r===this.sig&&this.model||(this.sig=r,this.model=n,this.place())}fit(){let e=this.state();e.moved=!1,e.whole=!0,this.fitNow()}tidy(){let e=this.state();e.positions.clear(),e.moved=!1,this.place()}expand(e,t=!0){let n=this.keyOf(e);n!==null&&this.setOpen(n,t)}select(e){this.selectKey(e===null?null:this.keyOf(e))}detail(){return this.panel.detail()}level(e){for(let t of this.keysOf(e)){let e=this.meters.get(t);if(e&&this.taps?.has(t)){if(e instanceof s){let{peakDb:t,rmsDb:n,holdDb:r,clipped:i}=e;return{kind:`audio`,peakDb:t,rmsDb:n,holdDb:r,clipped:i}}return{kind:`control`,value:e.value,low:e.low,high:e.high}}}return null}setTheme(e){e===`auto`?this.element.removeAttribute(`data-theme`):this.element.setAttribute(`data-theme`,e),this.sinceColors=10}stats(){return{nodes:this.placed.size,edges:this.placedEdges.length,visibleNodes:this.visibleNodes.length,taps:(this.taps?.count??0)+(this.probe?.count??0),frameMs:this.frameMs,worstFrameMs:this.worst.reduce((e,t)=>Math.max(e,t),0)}}destroy(){if(!this.destroyed){this.destroyed=!0,cancelAnimationFrame(this.raf),this.taps?.clear(),this.probe?.clear(),this.meters.clear();for(let e of this.unsubscribe)e();for(let e of this.cleanup)e();this.unsubscribe=[],this.cleanup=[],this.element.remove()}}build(){let e=this.element.attachShadow({mode:`open`}),t=X(`style`);t.textContent=L;let n=X(`div`,`bar`);this.crumbs.setAttribute(`aria-label`,`Scope`);let r=(e,t,n)=>{let r=X(`button`,`tool`,e);return r.type=`button`,r.title=t,r.setAttribute(`aria-label`,t),r.addEventListener(`click`,n),r};n.append(this.crumbs,r(`Tidy`,`Lay the graph out again`,()=>this.tidy()),r(`−`,`Zoom out`,()=>this.zoomBy(1/1.25)),r(`+`,`Zoom in`,()=>this.zoomBy(1.25)),r(`Fit`,`Fit the whole graph in view`,()=>this.fit())),this.viewport.tabIndex=0,this.viewport.setAttribute(`role`,`group`),this.viewport.setAttribute(`aria-label`,`Graph. Arrow keys pan, plus and minus zoom, 0 fits it in view.`),this.svg.setAttribute(`class`,`edges`),this.svg.setAttribute(`aria-hidden`,`true`),this.world.append(this.groupLayer,this.svg,this.nodeLayer),this.canvas.setAttribute(`aria-hidden`,`true`),this.viewport.append(this.world,this.canvas,this.empty),this.body.append(this.viewport,this.panel.element);let i=X(`div`,`status`);i.append(this.statusCount,this.statusState,this.statusCost);for(let e of Object.keys(this.colors)){let t=X(`span`);t.style.color=`var(--${e})`,this.probes.append(t),this.probeEls.set(e,t)}this.root.append(n,this.body,i,this.probes),e.append(t,this.root),this.listen()}on(e,t,n,r){e.addEventListener(t,n,r),this.cleanup.push(()=>e.removeEventListener(t,n,r))}listen(){let e=this.viewport,t=null;this.on(e,`pointerdown`,e=>{e.button===0&&(t={id:e.pointerId,x:e.clientX,y:e.clientY,moved:!1})}),this.on(e,`pointermove`,n=>{if(!t||n.pointerId!==t.id)return;let r=n.clientX-t.x,i=n.clientY-t.y;if(!t.moved){if(Math.hypot(r,i)<4)return;t.moved=!0,e.classList.add(`panning`);try{e.setPointerCapture(n.pointerId)}catch{}}t.x=n.clientX,t.y=n.clientY,this.userTransform({...this.transform,x:this.transform.x+r,y:this.transform.y+i})});let n=n=>{t&&n.pointerId===t.id&&(t.moved&&(this.suppressClick=!0,setTimeout(()=>this.suppressClick=!1,0)),t=null,e.classList.remove(`panning`))};if(this.on(e,`pointerup`,n),this.on(e,`pointercancel`,n),this.on(e,`wheel`,t=>{if(t.preventDefault(),t.ctrlKey||t.metaKey){let n=e.getBoundingClientRect();this.zoomAt(t.clientX-n.left,t.clientY-n.top,Math.exp(-t.deltaY*.01))}else this.userTransform({...this.transform,x:this.transform.x-t.deltaX,y:this.transform.y-t.deltaY})},{passive:!1}),this.on(e,`click`,e=>{if(this.suppressClick)return;let t=e.target,n=t.closest(`[data-key]`)?.dataset.key;n!==void 0&&(t.closest(`.expand`)?this.toggle(n):t.closest(`.enter`)?this.enter(n):this.selectKey(n))}),this.on(e,`dblclick`,e=>{let t=e.target;if(t.closest(`button`))return;let n=t.closest(`[data-key]`)?.dataset.key;n!==void 0&&this.enter(n)}),this.on(this.root,`keydown`,e=>{if(e.metaKey||e.ctrlKey||e.altKey)return;let t=e.target;if(e.key===`Escape`&&this.panel.open){e.stopPropagation();let t=this.selectedKey;this.selectKey(null),t!==null&&this.focusable(t)?.focus();return}if(!this.viewport.contains(t))return;let n=t.closest(`[data-key]`)?.dataset.key;if((e.key===`Enter`||e.key===` `)&&n!==void 0){if(t.closest(`button`))return;e.preventDefault(),this.selectKey(n);return}let r=(t,n)=>{e.preventDefault(),this.userTransform({...this.transform,x:this.transform.x+t,y:this.transform.y+n})};e.key===`ArrowLeft`?r(60,0):e.key===`ArrowRight`?r(-60,0):e.key===`ArrowUp`?r(0,60):e.key===`ArrowDown`?r(0,-60):e.key===`+`||e.key===`=`?this.zoomBy(1.25):e.key===`-`?this.zoomBy(1/1.25):e.key===`0`&&this.fit()}),this.on(e,`focusin`,e=>{let t=e.target.closest(`[data-key]`)?.dataset.key,n=t===void 0?void 0:this.placed.get(t);n&&e.target.matches(`:focus-visible`)&&this.reveal(n)}),this.on(e,`scroll`,()=>{e.scrollLeft=0,e.scrollTop=0}),typeof ResizeObserver<`u`){let t=new ResizeObserver(()=>{this.measureViewport(),this.state().moved||this.fitNow()});t.observe(e),this.cleanup.push(()=>t.disconnect())}if(typeof matchMedia==`function`){this.reducedMotion=matchMedia(`(prefers-reduced-motion: reduce)`);let e=matchMedia(`(prefers-color-scheme: dark)`);this.on(e,`change`,()=>this.sinceColors=10)}}state(){let e=this.states.get(this.current);return e||(e={transform:null,moved:!1,whole:!1,toggles:new Map,positions:new Map},this.states.set(this.current,e)),e}pathTo(e){let t=[e],n=e;for(;n!==this.home;){let e=n.owner?n.owner.scope:n.parent;if(!e)return null;t.unshift(e),n=e}return t}renderCrumbs(){let e=this.pathTo(this.current)??[this.current],t=[];e.forEach((e,n)=>{n>0&&t.push(X(`span`,`sep`,`›`));let r=e.owner,i=X(`button`,``,r?`${r.type} #${r.id}`:e.name);i.type=`button`,e===this.current?i.setAttribute(`aria-current`,`true`):i.addEventListener(`click`,()=>this.setScope(e)),t.push(i)}),this.crumbs.replaceChildren(...t)}subscribe(e){for(let e of this.unsubscribe)e();this.unsubscribe=[];let t=()=>{this.dirty=!0};for(let n of e)this.unsubscribe.push(n.on(`node:added`,t),n.on(`node:removed`,t),n.on(`param:changed`,()=>{this.textDirty=!0}))}*keysOf(e){for(let[t,n]of this.handles)(n.node===e||n.scope===e||n.bus&&`gain`in e&&`output`in e&&n.bus.output===e.output)&&(yield t)}keyOf(e){for(let t of this.keysOf(e))return t;return null}toggle(e){let t=this.placed.get(e);t&&(this.setOpen(e,!t.open),this.focusable(e)?.focus({preventScroll:!0}))}setOpen(e,t){let n=this.state(),r=this.placed.get(e);n.toggles.set(e,t),n.moved=!0,this.refresh();let i=this.placed.get(e);if(!r||!i)return;let a=this.transform;this.setTransform({k:a.k,x:a.x+(r.x-i.x)*a.k,y:a.y+(r.y-i.y)*a.k})}enter(e){let t=this.handles.get(e),n=t?.node?.insideScope??t?.scope??null;n&&this.setScope(n)}focusable(e){let t=this.nodeEls.get(e);return t?t.classList.contains(`group`)?t.querySelector(`.group-head`):t:null}selectKey(e){let t=e===null?void 0:this.handles.get(e),n=t&&(t.node||t.bus)?t:null,r=this.selectedKey;this.selectedKey=n?e:null,this.selectedHandle=n,r!==null&&this.nodeEls.get(r)?.classList.remove(`selected`),n&&e!==null?(this.nodeEls.get(e)?.classList.add(`selected`),this.showPanel(e,n)):(this.panel.hide(),this.probe?.clear()),this.body.classList.toggle(`with-detail`,this.panel.open),r!==this.selectedKey&&this.options.onSelect?.(n?.node??null)}showPanel(e,t){let n=this.engine.registry,r=t.node?.type,i=r!==void 0&&n.has(r)?n.describe(r):null,a=this.placed.get(e),o=this.placedEdges.find(t=>t.edge.from===e&&t.edge.kind===`route`),s=o?this.placed.get(o.edge.to)?.node.id??null:null;this.panel.show(t,i,a?.node.signal??`audio`,s,!!t.node?.insideScope)}syncSelection(){let e=this.selectedKey;if(e===null)return;let t=this.handles.get(e);!t||!(t.node||t.bus)?this.selectKey(null):t.node!==this.selectedHandle?.node&&(this.selectedHandle=t,this.showPanel(e,t))}arrange(t,n){let r=new Map,i=t.nodes.map(e=>{if(!e.children)return{key:e.key,...te(e),float:e.signal===`control`};let t=this.arrange(e.children,n);return r.set(e.key,t),{key:e.key,width:Math.max(164,t.result.bounds.width+28),height:54+t.result.bounds.height}}),a=n.positions.get(t.path),o=e(i,t.edges.map(e=>({key:e.key,from:e.from,to:e.to,weak:e.kind===`modulation`})),{layerGap:44,...a?{previous:a}:{}}),s=new Map;for(let[e,t]of o.nodes)s.set(e,{x:t.x,y:t.y});return n.positions.set(t.path,s),{graph:t,result:o,inner:r}}flatten(e,t,n,i){let a=new Set;for(let r of e.graph.nodes){let o=e.result.nodes.get(r.key);if(!o)continue;r.signal===`control`&&a.add(r.key);let s=e.inner.get(r.key),c=t+o.x,l=n+o.y;if(this.placed.set(r.key,{key:r.key,node:r,x:c,y:l,w:o.width,h:o.height,open:s!==void 0,depth:i}),s){let e=s.result.bounds,t=o.width-28-e.width;this.flatten(s,c+W+t/2-e.x,l+U+W-e.y,i+1)}}for(let i of e.graph.edges){let o=e.result.edges.get(i.key);if(!o)continue;let s=o.points.map(e=>({x:e.x+t,y:e.y+n})),c=r({points:s,reversed:o.reversed}),l=1/0,u=1/0,d=-1/0,f=-1/0;for(let e of s)l=Math.min(l,e.x),u=Math.min(u,e.y),d=Math.max(d,e.x),f=Math.max(f,e.y);let p=o.reversed?60:20;this.placedEdges.push({edge:i,d:c,path:typeof Path2D==`function`?new Path2D(c):null,x0:l-p,y0:u-p,x1:d+p,y1:f+p,end:s[s.length-1],control:i.kind===`modulation`||a.has(i.from)})}}place(){let e=this.model;if(!e)return;let t=this.state(),n=this.arrange(e,t);this.placed=new Map,this.placedEdges=[],this.flatten(n,0,0,0),this.bounds=n.result.bounds;let r=this.element.shadowRoot?.activeElement??null;for(let[e,t]of this.nodeEls){let n=this.placed.get(e);n&&n.open===t.classList.contains(`group`)||(t.remove(),this.nodeEls.delete(e))}for(let e of this.placed.values()){let t=this.nodeEls.get(e.key);t||(t=e.open?this.makeGroup(e):this.makeNode(e),this.nodeEls.set(e.key,t),(e.open?this.groupLayer:this.nodeLayer).append(t)),this.updateElement(t,e)}let i=[...this.placed.values()].filter(e=>!e.open).sort((e,t)=>e.x-t.x||e.y-t.y).map(e=>this.nodeEls.get(e.key)),a=this.nodeLayer.children;i.some((e,t)=>a[t]!==e)&&(this.nodeLayer.append(...i),r instanceof HTMLElement&&r.isConnected&&r.focus({preventScroll:!0}));let o=new Set,s=new Map;for(let e of this.placedEdges){let{edge:t}=e;o.add(t.key);let n=this.edgeEls.get(t.key);if(!n){let e=document.createElementNS(Y,`path`);e.setAttribute(`class`,t.kind);let r=document.createElementNS(Y,`path`);r.setAttribute(`class`,`head ${t.kind}`),n={path:e,head:r},this.edgeEls.set(t.key,n),this.svg.append(e,r)}n.path.setAttribute(`d`,e.d);let{x:r,y:i}=e.end;if(n.head.setAttribute(`d`,`M${r} ${i}l-6 -3.5v7z`),t.param!==null){let e=s.get(t.to)??[];s.has(t.to)||s.set(t.to,e),e.includes(t.param)||e.push(t.param)}}for(let[e,t]of this.edgeEls)o.has(e)||(this.removeEdgeEls(t),this.edgeEls.delete(e));for(let[e,t]of this.labelEls)s.has(e)||(t.remove(),this.labelEls.delete(e));for(let[e,t]of s){let n=this.placed.get(e);if(!n)continue;let r=this.labelEls.get(e);r||(r=document.createElementNS(Y,`text`),this.labelEls.set(e,r),this.svg.append(r));let i=t.join(`, `);r.textContent!==i&&(r.textContent=i),r.setAttribute(`x`,String(n.x+3)),r.setAttribute(`y`,String(n.y-4))}for(let e of this.meters.keys())this.placed.has(e)||this.meters.delete(e);this.empty.hidden=this.placed.size>0,this.renderCrumbs(),this.selectedKey!==null&&this.nodeEls.get(this.selectedKey)?.classList.add(`selected`),this.viewDirty=!0,this.sinceStatus=1,t.moved||this.fitNow()}removeEdgeEls(e){e.path.remove(),e.head.remove()}makeNode(e){let{node:t}=e,n=X(`div`,`node`);return n.dataset.key=t.key,t.kind===`output`?(n.append(X(`span`,`type`,`out`)),n.setAttribute(`aria-label`,`The speakers`),n):(n.tabIndex=0,n.setAttribute(`role`,`button`),n.append(X(`span`,`type`),X(`span`,`name`)),t.expandable&&n.append(this.expandButton(!1)),n)}makeGroup(e){let{node:t}=e,n=X(`div`,`group`);n.dataset.key=t.key;let r=X(`div`,`group-head`);r.tabIndex=0,r.setAttribute(`role`,`button`);let i=X(`button`,`enter`,`↗`);return i.type=`button`,i.title=`Show only this`,i.setAttribute(`aria-label`,`Show only this`),r.append(this.expandButton(!0),X(`span`,`type`),X(`span`,`name`),i),n.append(r),n}expandButton(e){let t=X(`button`,`expand`,e?`▾`:`▸`);return t.type=`button`,t.title=e?`Close`:`Open in place`,t.setAttribute(`aria-label`,e?`Close`:`Open in place`),t.setAttribute(`aria-expanded`,String(e)),t}updateElement(e,t){let{node:n}=t;if(e.style.transform=`translate(${t.x}px, ${t.y}px)`,e.style.width=`${t.w}px`,e.style.height=`${t.h}px`,e.className=[t.open?`group`:`node`,n.kind,n.category?`cat-${n.category}`:``,n.macro?`macro`:``,n.signal===`control`?`control`:``,n.bypassed?`bypassed`:``,n.external?`external`:``,n.key===this.selectedKey?`selected`:``].filter(Boolean).join(` `),n.kind===`output`)return;let r=e.querySelector(`.type`),i=e.querySelector(`.name`),a=n.classes.map(e=>`.${e}`),o=n.type,s=``;n.kind===`bus`?o=n.id:s=n.kind===`scope`?n.id:[n.autoId?``:`#${n.id}`,...a].filter(Boolean).join(` `),r.textContent!==o&&(r.textContent=o),i.textContent!==s&&(i.textContent=s);let c=e.querySelector(`:scope > .flag`);n.bypassed&&!t.open?c||(c=X(`span`,`flag`,`bypassed`),e.append(c)):c?.remove();let l=[n.kind===`bus`?`bus ${n.id}`:n.kind===`scope`?`scope ${n.id}`:``,n.kind===`node`?`${n.type} ${n.id}`:``,n.external?`of an outer scope`:``,n.macro?`macro`:``,n.bypassed?`bypassed`:``],u=t.open?e.querySelector(`.group-head`):e;u.setAttribute(`aria-label`,l.filter(Boolean).join(`, `)),u.title=n.kind===`node`?`${n.type} #${n.id}`:n.id}measureViewport(){let e=this.viewport.clientWidth,t=this.viewport.clientHeight;if(e===this.size.width&&t===this.size.height)return;this.size={width:e,height:t};let n=window.devicePixelRatio||1;this.canvas.width=Math.max(1,Math.round(e*n)),this.canvas.height=Math.max(1,Math.round(t*n)),this.viewDirty=!0}setTransform(e){this.transform=e,this.world.style.transform=`translate(${e.x}px, ${e.y}px) scale(${e.k})`,this.viewDirty=!0}userTransform(e){this.state().moved=!0,this.setTransform(e)}zoomAt(e,t,n){let r=this.transform,i=Math.min(ee,Math.max(q,r.k*n)),a=i/r.k;this.userTransform({k:i,x:e-(e-r.x)*a,y:t-(t-r.y)*a})}zoomBy(e){this.zoomAt(this.size.width/2,this.size.height/2,e)}fitNow(){let{width:e,height:t}=this.size,n=this.bounds;if(e===0||t===0||n.width===0||n.height===0)return;let r=Math.max(this.state().whole?q:J,Math.min(1,(e-40)/n.width,(t-40)/n.height)),i=n.width*r<=e-40?(e-n.width*r)/2:20,a=n.height*r<=t-40?(t-n.height*r)/2:20;this.setTransform({k:r,x:i-n.x*r,y:a-n.y*r})}reveal(e){let t=this.transform,n=e.x*t.k+t.x,r=e.y*t.k+t.y,i=n+Math.min(e.w,138)*t.k,a=r+Math.min(e.h,V)*t.k,o=0,s=0;n<16?o=16-n:i>this.size.width-16&&(o=this.size.width-16-i),r<16?s=16-r:a>this.size.height-16&&(s=this.size.height-16-a),(o!==0||s!==0)&&this.userTransform({...t,x:t.x+o,y:t.y+s})}tick=e=>{if(this.destroyed)return;this.raf=requestAnimationFrame(this.tick);let t=performance.now(),n=Math.min(.25,Math.max(0,(e-this.lastFrame)/1e3));this.lastFrame=e,this.sincePoll+=n,(this.dirty||this.sincePoll>=.4)&&this.refresh(),this.sinceColors+=n,this.sinceColors>=2&&this.resolveColors(),this.frame(n);let r=performance.now()-t;this.frameMs+=(r-this.frameMs)*.05,this.worst.push(r),this.worst.length>120&&this.worst.shift(),this.sinceStatus+=n,this.sinceStatus>=.5&&this.renderStatus()};outputOf(e){let t=this.handles.get(e);return t?t.node?t.node.disposed?null:t.node.output:t.bus?.output??null:null}frame(e){this.viewDirty&&this.cull();let t=this.engine.context,n=this.options.meters!==!1&&!this.engine.offline&&t.state===`running`,r=this.wanted;if(r.clear(),n){for(let e of this.visibleNodes){let t=this.outputOf(e.key);t&&r.set(e.key,t)}for(let e of this.visibleEdges){let t=e.edge.from;if(r.has(t))continue;let n=this.outputOf(t);n&&r.set(t,n)}if(this.selectedKey!==null){let e=this.selectedKey.slice(0,this.selectedKey.lastIndexOf(`#`)+1);for(let t of this.panel.modulatorIds()){let n=this.outputOf(e+t);n&&r.set(e+t,n)}}}r.size>0&&!this.taps&&(this.taps=new z(t));let i=this.taps;i?.sync(r,e);for(let e of r.keys()){if(this.meters.has(e))continue;let t=this.placed.get(e)?.node.signal===`control`;this.meters.set(e,t?new l:new s)}let a=!1;for(let[t,c]of this.meters){let l=n&&r.has(t)?i?.read(t)??null:null;l?(c.update(o(l,this.block),e),a=!0):c instanceof s?(c.idle(e),c.silent?this.meters.delete(t):a=!0):(this.meters.delete(t),this.paintDirty=!0)}if((a||this.paintDirty)&&(this.flow=(this.flow+e*G)%(K[0]+K[1]),this.paint(),this.paintDirty=a),this.panel.open&&this.selectedKey!==null){let r=this.probeWanted;r.clear();let i=n?this.outputOf(this.selectedKey):null;i&&r.set(`probe`,i),i&&!this.probe&&(this.probe=new z(t,2048,.5)),this.probe?.sync(r,e),this.textDirty&&this.panel.textChanged(),this.panel.frame(i?this.probe?.analyser(`probe`)??null:null,e,this.colors,t.sampleRate)}this.textDirty=!1}cull(){this.viewDirty=!1,this.paintDirty=!0;let e=this.transform,t=-e.x/e.k,n=-e.y/e.k,r=t+this.size.width/e.k,i=n+this.size.height/e.k;if(this.visibleNodes=[],this.visibleEdges=[],this.size.width!==0&&this.size.height!==0){for(let e of this.placed.values())e.x<r&&e.x+e.w>t&&e.y<i&&e.y+e.h>n&&this.visibleNodes.push(e);for(let e of this.placedEdges)e.x0<r&&e.x1>t&&e.y0<i&&e.y1>n&&this.visibleEdges.push(e)}}paint(){let e=this.canvas.getContext(`2d`);if(!e)return;let t=window.devicePixelRatio||1,n=this.transform,r=this.colors;e.setTransform(1,0,0,1,0,0),e.clearRect(0,0,this.canvas.width,this.canvas.height),e.setTransform(t*n.k,0,0,t*n.k,t*n.x,t*n.y);let i=this.reducedMotion?.matches??!1;e.lineCap=`round`,e.lineWidth=2.5,i?e.setLineDash([]):(e.setLineDash(K),e.lineDashOffset=-this.flow);for(let t of this.visibleEdges){let n=this.meters.get(t.edge.from);if(!n||!t.path)continue;let a=n.activity;a<.02||(e.globalAlpha=(i?.6:1)*(.2+.8*a),e.strokeStyle=t.control?r.mod:r.accent,e.stroke(t.path))}e.setLineDash([]),e.globalAlpha=1;for(let t of this.visibleNodes){let n=this.meters.get(t.key);if(!n)continue;let i=t.x+t.w-(t.node.kind===`bus`?13:10),a=t.y+5,o=(t.open?U:t.h)-10;if(n instanceof s){let t=e=>o*Math.min(1,Math.max(0,(e- -60)/60));e.fillStyle=r.ok,e.globalAlpha=.4;let s=t(n.peakDb);e.fillRect(i,a+o-s,4,s),e.globalAlpha=1;let c=t(n.rmsDb);e.fillRect(i,a+o-c,4,c),n.holdDb>-60&&(e.fillStyle=n.clipped?r.clip:r.text,e.fillRect(i-1,a+o-t(n.holdDb)-.75,6,1.5))}else if(n.scale>0){let t=a+o/2,s=e=>t-Math.max(-1,Math.min(1,e/n.scale))*o/2;e.fillStyle=r.mod,e.globalAlpha=.35;let c=s(n.high);e.fillRect(i,c,4,Math.max(1,s(n.low)-c)),e.globalAlpha=1,e.fillRect(i-1,s(n.value)-1,6,2),e.fillStyle=r.muted,e.fillRect(i-2,t-.5,1.5,1)}}}renderStatus(){this.sinceStatus=0;let e=[...this.placed.values()].filter(e=>e.node.kind===`node`).length,t=this.placedEdges.length;this.statusCount.textContent=`${e} node${e===1?``:`s`}, ${t} connection${t===1?``:`s`}`;let n=this.engine.offline?`offline`:this.engine.context.state;this.statusState.textContent=n===`running`?`audio running`:n===`offline`?`offline engine: no meters`:`audio ${n}: meters idle`,this.statusState.classList.toggle(`running`,n===`running`);let r=this.stats();this.statusCost.textContent=`${r.taps} taps · ${r.frameMs.toFixed(2)} ms/frame`,this.statusCost.title=`Analysers attached, and the script time this inspector uses per animation frame.`}resolveColors(){this.sinceColors=0;let e=!1;for(let[t,n]of this.probeEls){let r=getComputedStyle(n).color;r&&r!==this.colors[t]&&(this.colors[t]=r,e=!0)}e&&(this.paintDirty=!0)}};function Q(e,t={}){let{mode:n=`sidebar`,parent:r=document.body,title:i=`Graph`,width:a,onClose:o}=t,s=document.activeElement,c=document.createElement(`div`);c.className=`cu-inspector-window`,t.theme&&t.theme!==`auto`&&(c.dataset.theme=t.theme),a!==void 0&&c.style.setProperty(`--cu-inspect-width`,`${a}px`);let l=c.attachShadow({mode:`open`}),u=document.createElement(`style`);u.textContent=L;let d=document.createElement(`div`);d.className=`window ${n}`,d.tabIndex=-1,d.setAttribute(`role`,n===`modal`?`dialog`:`complementary`),d.setAttribute(`aria-label`,i),n===`modal`&&d.setAttribute(`aria-modal`,`true`);let f=document.createElement(`div`);f.className=`window-head`;let p=document.createElement(`h1`);p.textContent=i;let m=document.createElement(`button`);m.type=`button`,m.className=`window-close`,m.textContent=`Close`;let h=!1,g=e=>{h=e,d.classList.toggle(`wide`,h),_.textContent=h?`Narrow`:`Full width`,_.title=h?`Back to a sidebar`:`Use the whole width of the page`,_.setAttribute(`aria-pressed`,String(h))},_=document.createElement(`button`);_.type=`button`,_.className=`window-width`,_.addEventListener(`click`,()=>g(!h)),g(t.wide===!0),n===`sidebar`?f.append(p,_,m):f.append(p,m);let v=document.createElement(`div`);v.className=`window-body`,d.append(f,v);let y=null;n===`modal`?(y=document.createElement(`div`),y.className=`backdrop`,l.append(u,y,d)):l.append(u,d),r.append(c);let{parent:b,mode:x,title:S,width:C,onClose:w,wide:T,...E}=t,D=Z(e,{...E,parent:v}),O=!1,k=e=>{e.key===`Escape`&&!e.defaultPrevented&&A()},A=()=>{O||(O=!0,j.removeEventListener(`keydown`,k),D.destroy(),c.remove(),$.get(e)===M&&$.delete(e),s instanceof HTMLElement&&s.isConnected&&s.focus({preventScroll:!0}),o?.())},j=n===`modal`?document:d;j.addEventListener(`keydown`,k),m.addEventListener(`click`,A),y?.addEventListener(`click`,A),d.focus({preventScroll:!0});let M={inspector:D,element:c,get closed(){return O},get wide(){return h},setWide:g,close:A};return M}var $=new WeakMap;function ie(e,t={}){let n=$.get(e);if(n&&!n.closed)return n.close(),null;let r=Q(e,t);return $.set(e,r),r}export{ie as n,Z as r,Q as t};