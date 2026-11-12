import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ThreadType, TextStyle } from 'zca-js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(DIR, '..', 'web', 'index.html');
const sessions = new Map();
const attempts = new Map();
const activity = [];
const SEND_COOLDOWN = 1800;
let lastSend = 0;

const colors = { green: TextStyle.Green, red: TextStyle.Red, yellow: TextStyle.Yellow, orange: TextStyle.Orange };
const secureEqual = (a, b) => {
  if (!a || !b) return false;
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const json = (res, status, value, extra = {}) => {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...extra });
  res.end(JSON.stringify(value));
};
const readBody = async req => {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 12000) throw new Error('Dữ liệu quá lớn');
  }
  return JSON.parse(data || '{}');
};
const logEvent = item => {
  activity.unshift({ ...item, time: new Date().toISOString() });
  if (activity.length > 60) activity.length = 60;
};
const getToken = req => (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s => s.startsWith('zpanel='))?.slice(7);
const authorized = req => {
  const token = getToken(req);
  const session = token && sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expires) { sessions.delete(token); return false; }
  return true;
};
const sameOrigin = req => {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const o = new URL(origin);
    return o.host === req.headers.host && (o.protocol === 'https:' || (o.hostname === 'localhost' || o.hostname === '127.0.0.1'));
  } catch { return false; }
};
function stylesOf(body, opts) {
  const styles = [];
  const add = st => styles.push({start: 0, len: body.length, st});
  if (opts.small) add(TextStyle.Small);
  if (opts.big) add(TextStyle.Big);
  if (opts.bold) add(TextStyle.Bold);
  if (opts.italic) add(TextStyle.Italic);
  if (opts.underline) add(TextStyle.Underline);
  if (opts.color && colors[opts.color]) add(colors[opts.color]);
  return styles;
}

/** Called once by the logged-in Zalo bot. Shares its existing API and settings. */
export function startWebPanel({api, settings, saveSettings, botId}) {
  const password = process.env.WEB_PASSWORD;
  if (!password || password.length < 12) {
    console.warn('WEB: chưa chạy. Thêm WEB_PASSWORD tối thiểu 12 ký tự vào .env');
    return { onMessage() {} };
  }
  const port = Number(process.env.SERVER_PORT || process.env.PORT || 3456);
  const host = process.env.WEB_PUBLIC === 'true' ? '0.0.0.0' : '127.0.0.1';
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://local').pathname;
      res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('X-Frame-Options','DENY');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      if (req.method === 'GET' && pathname === '/') {
        const html = await fs.readFile(FILE);
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
        return res.end(html);
      }
      if (req.method === 'GET' && pathname === '/app.js') {
        const js = await fs.readFile(path.join(DIR, '..', 'web', 'app.js'));
        res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
        return res.end(js);
      }
      if (req.method === 'GET' && pathname === '/style.css') {
        const css = await fs.readFile(path.join(DIR, '..', 'web', 'style.css'));
        res.writeHead(200, {'Content-Type':'text/css; charset=utf-8','Cache-Control':'no-store'});
        return res.end(css);
      }
      if (req.method === 'GET' && pathname === '/api/me') return json(res,200,{loggedIn:authorized(req)});
      if (req.method === 'POST' && pathname === '/api/login') {
        if (!sameOrigin(req)) return json(res,403,{error:'Nguồn không hợp lệ; cần HTTPS hoặc localhost'});
        const key = req.socket.remoteAddress || 'unknown';
        const limit = attempts.get(key) || {n:0,until:0};
        if (limit.until > Date.now()) return json(res,429,{error:'Thử lại sau 15 phút'});
        const data = await readBody(req);
        if (!secureEqual(data.password,password)) {
          limit.n++;
          if (limit.n >= 5) { limit.n = 0; limit.until = Date.now() + 15 * 60_000; }
          attempts.set(key,limit);
          return json(res,401,{error:'Mật khẩu sai'});
        }
        attempts.delete(key);
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token,{expires:Date.now()+12*60*60_000});
        const isSecure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
        return json(res,200,{ok:true},{'Set-Cookie':`zpanel=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${isSecure?'; Secure':''}`});
      }
      if (req.method === 'POST' && pathname === '/api/logout') {
        if (!sameOrigin(req)) return json(res,403,{error:'Nguồn không hợp lệ'});
        sessions.delete(getToken(req));
        return json(res,200,{ok:true},{'Set-Cookie':'zpanel=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
      }
      if (!authorized(req)) return json(res,401,{error:'Cần đăng nhập'});
      if (req.method === 'GET' && pathname === '/api/status') return json(res,200,{online:true,botId,settings:{...settings},activity});
      if (req.method === 'POST' && pathname === '/api/settings') {
        if (!sameOrigin(req)) return json(res,403,{error:'Nguồn không hợp lệ'});
        const data = await readBody(req);
        if (typeof data.busy === 'boolean') settings.busy = data.busy;
        if (typeof data.enabled === 'boolean') settings.enabled = data.enabled;
        if (typeof data.color === 'string' && colors[data.color]) settings.color = data.color;
        await saveSettings();
        logEvent({kind:'settings',detail:'Đã cập nhật cấu hình'});
        return json(res,200,{ok:true,settings});
      }
      if (req.method === 'POST' && pathname === '/api/send') {
        if (!sameOrigin(req)) return json(res,403,{error:'Nguồn không hợp lệ'});
        const data = await readBody(req);
        const id = String(data.threadId || '').trim();
        const body = String(data.message || '').trim();
        if (!/^\d{8,22}$/.test(id)) return json(res,400,{error:'Zalo ID chỉ gồm 8–22 chữ số'});
        if (!body || body.length > 1500) return json(res,400,{error:'Tin nhắn cần dài 1–1500 ký tự'});
        if (!['user','group'].includes(data.type)) return json(res,400,{error:'Loại chat không hợp lệ'});
        if (Date.now() - lastSend < SEND_COOLDOWN) return json(res,429,{error:'Chờ ít nhất 2 giây giữa các tin'});
        lastSend = Date.now();
        const o = data.style || {};
        const style = {
          small: !!o.small && !o.big,
          big: !!o.big,
          bold: !!o.bold,
          italic: !!o.italic,
          underline: !!o.underline,
          color: colors[o.color] ? o.color : ''
        };
        const styles = stylesOf(body,style);
        const result = await api.sendMessage(
          styles.length ? {msg:body, styles} : {msg:body},
          id, data.type === 'group' ? ThreadType.Group : ThreadType.User
        );
        logEvent({kind:'sent',threadId:id,detail:`Đã gửi ${body.length} ký tự`,type:data.type});
        return json(res,200,{ok:true,msgId:result?.message?.msgId ?? null});
      }
      return json(res,404,{error:'Không tồn tại'});
    } catch(e) {
      console.error('WEB ERROR:',e);
      return json(res,e instanceof SyntaxError?400:500,{error:'Có lỗi khi xử lý yêu cầu'});
    }
  });
  server.listen(port,host,()=>console.log(`WEB PANEL: http://${host}:${port} (chỉ dùng HTTPS khi truy cập từ xa)`));
  return {onMessage(message) {
    const content=message.data?.content;
    if(typeof content!=='string') return;
    logEvent({kind: message.isSelf?'self':'received', threadId:String(message.threadId),type:message.type===ThreadType.Group?'group':'user',detail:`Tin nhắn ${content.length} ký tự`,from:message.data?.dName || 'Người dùng'});
  }};
}
