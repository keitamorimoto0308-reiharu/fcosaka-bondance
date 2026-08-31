// 開発用の静的サーバー（検証専用。本番は GitHub Pages）
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css',
  '.png':'image/png','.avif':'image/avif','.json':'application/json','.pdf':'application/pdf'};
http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]);
  if(p==='/')p='/index.html';
  const f=path.join(ROOT,p);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('404');}
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
}).listen(4173,()=>console.log('http://localhost:4173/'));
