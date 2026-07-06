// The dead-x-capture bookmarklet as a paste-ready javascript: one-liner.
// Hand-minified from tools/x-capture-bookmarklet.js — that file is the
// maintained, commented source; when X's DOM churns, fix the selectors THERE
// and re-minify here. Kept as a plain exported string (client-safe, no deps)
// so the Social pane can render a copy button; we deliberately never put it
// in an <a href> — React blocks javascript: URLs, and copy-into-a-bookmark is
// the reliable install path on both desktop and mobile anyway.
//
// v2 is an ACCUMULATING COLLECTOR: X virtualizes its timeline (posts leave
// the DOM as they scroll off-screen), so a one-shot snapshot only ever saw
// the current screenful (~5 posts). Now: tap once to start → a floating
// counter collects posts while you scroll (deduped, capped 200) → tap the
// counter (or the bookmark again) to download.
//
// NOTE: this is a TS template literal, so every backslash in the bookmarklet
// source is doubled (\\d, \\n, …) to survive the escape pass.

export const X_BOOKMARKLET =
  `javascript:(()=>{var W=window;if(W.__deadxcap){W.__deadxcap.save();return}var MAX=200,S=new Map(),B=document.createElement('button');var G=()=>{document.querySelectorAll('article[data-testid="tweet"]').forEach(a=>{try{if(S.size>=MAX)return;var t=a.querySelector('a[href*="/status/"] time'),l=t?t.closest('a'):null,u=l?new URL(l.getAttribute('href'),location.origin).href:'',im=u.match(/status\\/(\\d+)/),te=a.querySelector('[data-testid="tweetText"]'),x=te?te.innerText:'';if(!x)return;var au='',h='',ne=a.querySelector('[data-testid="User-Name"]');if(ne){var ls=ne.innerText.split('\\n');au=ls[0]||'';var hh=ls.find(s=>s.startsWith('@'));h=hh?hh.slice(1):''}var k=im?im[1]:h+'|'+x.slice(0,80);if(S.has(k))return;var M=d=>{var e=a.querySelector('[data-testid="'+d+'"]');if(!e)return;var m=(e.getAttribute('aria-label')||e.innerText||'').match(/[\\d.,]+\\s*[KMB]?/);return m?m[0].trim():void 0};S.set(k,{id:im?im[1]:'',url:u,author:au,handle:h,time:t?t.getAttribute('datetime')||'':'',text:x,metrics:{replies:M('reply'),reposts:M('retweet'),likes:M('like')}})}catch(e){}});B.textContent='𝕏 '+S.size+(S.size>=MAX?' (cap)':'')+' captured — tap to save'};function V(){clearInterval(iv);B.remove();delete W.__deadxcap;var P=Array.from(S.values());if(!P.length){alert('dead-x-capture: no posts collected. Start it on a view with posts, scroll, then save.');return}var p=location.pathname,k=p.indexOf('/lists/')>=0?'list':p.indexOf('/bookmarks')>=0?'bookmarks':p.indexOf('/search')>=0?'search':p==='/home'||p==='/'?'timeline':'profile',lb=(document.title||'X capture').replace(/^\\(\\d+\\)\\s*/,'').replace(/ [/|] X.*$/,'').slice(0,80);if(k==='list'&&(/^List$/i.test(lb)||!lb)){var h2=document.querySelector('h2');if(h2&&h2.innerText)lb=h2.innerText.split('\\n')[0].slice(0,80)}var o={format:'dead-x-capture',version:1,capturedAt:new Date().toISOString(),source:{kind:k,label:lb},items:P.slice(0,MAX)},b=new Blob([JSON.stringify(o,null,2)],{type:'application/json'}),d=document.createElement('a');d.href=URL.createObjectURL(b);d.download='x-capture-'+new Date().toISOString().replace(/[:.]/g,'').slice(0,15)+'Z.json';document.body.appendChild(d);d.click();d.remove();alert('dead-x-capture: saved '+o.items.length+' posts. Import the file on the dashboard: OSINT → Social.')}B.style.cssText='position:fixed;bottom:18px;right:18px;z-index:2147483647;background:#10b981;color:#022c22;font:700 13px system-ui;padding:10px 14px;border-radius:10px;border:0;box-shadow:0 4px 16px rgba(0,0,0,.5);cursor:pointer';B.onclick=()=>V();document.body.appendChild(B);var iv=setInterval(G,500);G();W.__deadxcap={save:V}})();`;
