// The dead-x-capture bookmarklet as a paste-ready javascript: one-liner.
// Hand-minified from tools/x-capture-bookmarklet.js — that file is the
// maintained, commented source; when X's DOM churns, fix the selectors THERE
// and re-minify here. Kept as a plain exported string (client-safe, no deps)
// so the Social pane can render a copy button; we deliberately never put it
// in an <a href> — React blocks javascript: URLs, and copy-into-a-bookmark is
// the reliable install path on both desktop and mobile anyway.
//
// NOTE: this is a TS template literal, so every backslash in the bookmarklet
// source is doubled (\\d, \\n, …) to survive the escape pass.

export const X_BOOKMARKLET =
  `javascript:(()=>{const P=[],S=new Set();document.querySelectorAll('article[data-testid="tweet"]').forEach(a=>{try{const t=a.querySelector('a[href*="/status/"] time'),l=t?t.closest('a'):null,u=l?new URL(l.getAttribute('href'),location.origin).href:'',im=u.match(/status\\/(\\d+)/),id=im?im[1]:'';if(id&&S.has(id))return;const te=a.querySelector('[data-testid="tweetText"]'),x=te?te.innerText:'';if(!x)return;let au='',h='';const ne=a.querySelector('[data-testid="User-Name"]');if(ne){const ls=ne.innerText.split('\\n');au=ls[0]||'';const hh=ls.find(s=>s.startsWith('@'));h=hh?hh.slice(1):''}const M=d=>{const e=a.querySelector('[data-testid="'+d+'"]');if(!e)return;const m=(e.getAttribute('aria-label')||e.innerText||'').match(/[\\d.,]+\\s*[KMB]?/);return m?m[0].trim():void 0};if(id)S.add(id);P.push({id,url:u,author:au,handle:h,time:t?t.getAttribute('datetime')||'':'',text:x,metrics:{replies:M('reply'),reposts:M('retweet'),likes:M('like')}})}catch(e){}});if(!P.length){alert('dead-x-capture: no posts found on this view. Scroll so posts are visible, then try again.');return}const p=location.pathname,k=p.indexOf('/lists/')>=0?'list':p.indexOf('/bookmarks')>=0?'bookmarks':p.indexOf('/search')>=0?'search':p==='/home'||p==='/'?'timeline':'profile',lb=(document.title||'X capture').replace(/ [/|] X.*$/,'').slice(0,80),o={format:'dead-x-capture',version:1,capturedAt:new Date().toISOString(),source:{kind:k,label:lb},items:P.slice(0,200)},b=new Blob([JSON.stringify(o,null,2)],{type:'application/json'}),d=document.createElement('a');d.href=URL.createObjectURL(b);d.download='x-capture-'+new Date().toISOString().replace(/[:.]/g,'').slice(0,15)+'Z.json';document.body.appendChild(d);d.click();d.remove();alert('dead-x-capture: saved '+o.items.length+' posts. Import the file on the dashboard: OSINT → Social.')})();`;
