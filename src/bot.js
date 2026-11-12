import { Zalo, ThreadType, TextStyle } from 'zca-js';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import { config } from './config.js';
import { handleCommand } from './commands/index.js';
import { canRespond } from './services/state.js';

const FONT_FILE = './font-settings.json';
const OWN_ID = '713588087980736558';
const BUSY_TEXT = 'Đức dz hiện đang bận xin hãy liên lạc lại sau';
const AUTO_REPLY_DELAY = 5 * 60 * 1000;
const fontColors = {
  green: TextStyle.Green,
  red: TextStyle.Red,
  yellow: TextStyle.Yellow,
  orange: TextStyle.Orange
};

let fontSettings = { enabled: false, color: 'green', busy: false };

async function loadFont() {
  try {
    const saved = JSON.parse(await fs.readFile(FONT_FILE, 'utf8'));
    if (typeof saved.enabled === 'boolean') fontSettings.enabled = saved.enabled;
    if (Object.hasOwn(fontColors, saved.color)) fontSettings.color = saved.color;
    if (typeof saved.busy === 'boolean') fontSettings.busy = saved.busy;
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Không đọc được cấu hình:', error);
  }
}

async function saveFont() {
  await fs.writeFile(FONT_FILE, JSON.stringify(fontSettings, null, 2), 'utf8');
}

function stylesFor(body, { italic = false, force = false } = {}) {
  if (!force && !fontSettings.enabled) return undefined;
  const len = body.length;
  return [
    { start: 0, len, st: TextStyle.Small },
    ...(italic ? [{ start: 0, len, st: TextStyle.Italic }] : []),
    { start: 0, len, st: fontColors[fontSettings.color] }
  ];
}

export async function startBot() {
  await loadFont();
  const zalo = new Zalo({
    selfListen: true,
    imageMetadataGetter: async (filePath) => {
      const bytes = await fs.readFile(filePath);
      const meta = await sharp(bytes).metadata();
      return { width: meta.width || 0, height: meta.height || 0, size: bytes.length };
    }
  });

  console.log('Đang đăng nhập Zalo bằng QR...');
  const api = await zalo.loginQR();
  console.log('Đăng nhập thành công. Đang nghe tin nhắn riêng...');

  const processing = new Set();
  const processedOriginals = new Set();
  const generatedIds = new Set();
  const recentlySent = new Map();
  const autoReplyCooldown = new Map();
  const spamTasks = new Map();
  let lastRepeatAt = 0;

  function markOwnEcho(threadId, content) {
    const key = `${threadId}\u0000${content}`;
    const state = recentlySent.get(key);
    recentlySent.set(key, {
      remaining: (state?.expires > Date.now() ? state.remaining : 0) + 1,
      expires: Date.now() + 15000
    });
    if (recentlySent.size > 500) recentlySent.delete(recentlySent.keys().next().value);
  }

  function suppressOwnEcho(threadId, content) {
    const key = `${threadId}\u0000${content}`;
    const state = recentlySent.get(key);
    if (!state || state.expires < Date.now()) {
      recentlySent.delete(key);
      return false;
    }
    state.remaining--;
    if (state.remaining <= 0) recentlySent.delete(key);
    return true;
  }

  function addGeneratedId(id) {
    if (id == null) return;
    generatedIds.add(String(id));
    if (generatedIds.size > 500) generatedIds.delete(generatedIds.values().next().value);
  }

  api.listener.on('message', async (message) => {
    try {
      // Cho phép nhận tin nhắn riêng và nhóm
      if (
        message.type !== ThreadType.User &&
        message.type !== ThreadType.Group
      ) return;
      const isGroup = message.type === ThreadType.Group;
      const isPrivate = message.type === ThreadType.User;
      const data = message.data ?? {};
      const msgId = String(data.msgId ?? '');
      if (data.content && typeof data.content === 'object' && data.content.action === 'rtf') return;
      if (message.isSelf && generatedIds.has(msgId)) return;
      if (typeof data.content !== 'string') return;

      const text = data.content.trim();
      if (!text) return;
      const threadId = String(message.threadId);
      if (message.isSelf && suppressOwnEcho(threadId, text)) return;
      const senderId = message.isSelf ? OWN_ID : String(data.uidFrom ?? data.senderId ?? '');

      const reply = async (body, styles) => {
        markOwnEcho(threadId, String(body));
        const result = await api.sendMessage(
          styles ? { msg: String(body), styles } : { msg: String(body) },
          threadId,
          message.type
        );
        addGeneratedId(result?.message?.msgId);
        console.log('SEND RESULT:', result);
        return result;
      };

      // Chỉ trả lời tự động trong inbox. Lệnh trong nhóm vẫn hoạt động.
      if (!message.isSelf && isPrivate && fontSettings.busy) {
        // Không trả lời lệnh bot hoặc tin trống.
        if (text.startsWith('/') || text.startsWith('.')) return;

        const now = Date.now();
        const last = autoReplyCooldown.get(senderId) ?? 0;
        const remaining = AUTO_REPLY_DELAY - (now - last);
        if (remaining > 0) {
          console.log('BUSY SKIP: còn cooldown', senderId, Math.ceil(remaining / 1000), 'giây');
          return;
        }
        // Đặt cooldown trước khi gửi để tránh trùng khi có nhiều tin đến cùng lúc.
        autoReplyCooldown.set(senderId, now);
        try {
          const result = await reply(
            BUSY_TEXT,
            stylesFor(BUSY_TEXT, { italic: true, force: true })
          );
          console.log('BUSY SEND RESULT:', senderId, result);
        } catch (error) {
          autoReplyCooldown.delete(senderId);
          console.error('BUSY SEND ERROR:', senderId, error);
        }
        return;
      }

      if (message.isSelf) {
        const isAdmin = config.admins.has(OWN_ID);
        console.log("ADMIN IDS:", [...config.admins]);
        console.log("OWN ID:", OWN_ID);
        console.log("IS ADMIN:", isAdmin);
        const cmd = text.toLowerCase();

        // Bật/tắt trạng thái bận, chỉ admin.
        if (cmd === '.busy' || cmd === '.busy on' || cmd === '.busy off' || cmd === '.busy status' || cmd === '.busy reset') {
          if (!isAdmin) {
            console.log('Không có quyền admin, kiểm tra ADMIN_IDS trong .env');
            return;
          }
          if (cmd === '.busy status') {
            console.log('Chế độ bận:', fontSettings.busy ? 'ĐANG BẬT' : 'ĐANG TẮT');
            return;
          }
          if (cmd === '.busy reset') {
            autoReplyCooldown.clear();
            console.log('Đã xóa cooldown trả lời bận để thử lại.');
            return;
          }
          fontSettings.busy = cmd !== '.busy off';
          if (fontSettings.busy) autoReplyCooldown.clear();
          await saveFont();
          console.log('Chế độ bận:', fontSettings.busy ? 'ĐANG BẬT' : 'ĐANG TẮT');
          return;
        }

        if (cmd === '.stopspam') {
          if (!isAdmin) return;
          const task = spamTasks.get(threadId);
          if (task) task.cancelled = true;
          console.log(task ? 'Đã yêu cầu dừng gửi lặp.' : 'Không có tác vụ gửi lặp trong chat.');
          return;
        }

        // Gửi thử có giới hạn, giữ nguyên chức năng từ bản cũ.
        if (cmd === '.spam' || cmd.startsWith('.spam ')) {
          if (!isAdmin) return;
          const match = text.match(/^\.spam\s+([\s\S]+?)\s+(\d+)$/i);
          if (!match) { console.log('Cú pháp: .spam <nội dung> <số lần 1-5>'); return; }
          const body = match[1].trim();
          const count = Number(match[2]);
          if (!body || body.length > 200 || !Number.isInteger(count) || count < 1 || count > 1000) {
            console.log('');
            return;
          }
          if (spamTasks.has(threadId) || Date.now() - lastRepeatAt < 60000) {
            console.log('Chat đang gửi lặp hoặc chưa hết thời gian chờ 60 giây.');
            return;
          }
          lastRepeatAt = Date.now();
          const task = { cancelled: false };
          spamTasks.set(threadId, task);
          try {
            for (let i = 0; i < count; i++) {
              if (task.cancelled) break;
              try {
                await reply(body, stylesFor(body));
                console.log(`Đã gửi ${i + 1}/${count}`);
              } catch (error) {
                console.error('Dừng gửi do lỗi:', error);
                break;
              }
              if (i < count - 1) await new Promise(resolve => setTimeout(resolve, 250));
            }
          } finally {
            if (spamTasks.get(threadId) === task) spamTasks.delete(threadId);
          }
          return;
        }

        if (cmd === '.font' || cmd === '.font on' || cmd === '.font off' || cmd.startsWith('.font color ')) {
          if (!isAdmin) { console.log('Hãy thêm ADMIN_IDS vào .env'); return; }
          if (cmd === '.font' || cmd === '.font on') fontSettings.enabled = true;
          else if (cmd === '.font off') fontSettings.enabled = false;
          else {
            const color = cmd.slice('.font color '.length).trim();
            if (!Object.hasOwn(fontColors, color)) {
              console.log('Màu hợp lệ: green, red, yellow, orange');
              return;
            }
            fontSettings.color = color;
          }
          await saveFont();
          console.log('Cấu hình font:', fontSettings);
          return;
        }

        // Chủ tài khoản gửi tin thường: gửi bản có font rồi thu hồi tin gốc.
        if (isAdmin && fontSettings.enabled && !text.startsWith('.') && !text.startsWith('/')) {
          const originalId = `${threadId}:${msgId}:${data.cliMsgId ?? ''}`;
          if (processing.has(originalId) || processedOriginals.has(originalId)) return;
          processing.add(originalId);
          processedOriginals.add(originalId);
          if (processedOriginals.size > 500) processedOriginals.delete(processedOriginals.values().next().value);
          try {
            const result = await reply(text, stylesFor(text));
            if (!result?.message?.msgId || !data.msgId || !data.cliMsgId) {
              console.warn('Không đủ thông tin để thu hồi tin gốc.');
              return;
            }
            try {
              const undone = await api.undo({ msgId: data.msgId, cliMsgId: data.cliMsgId });
              console.log('UNDO RESULT:', undone);
            } catch (error) {
              console.error('Không thu hồi được tin gốc:', error);
            }
          } finally {
            processing.delete(originalId);
          }
          return;
        }

        if (!text.startsWith('/') && !text.startsWith('.')) return;
      }

      if (text.toLowerCase() === '.test' || text.toLowerCase() === '/test') {
        await reply('Bot Zalo đã trả lời tin nhắn riêng thành công!');
        return;
      }

      if (!canRespond(`${threadId}:${senderId}`, config.cooldown)) return;
      if (await handleCommand({ api, message, text, senderId, isGroup: isGroup, reply })) return;
      if (message.isSelf || isGroup || !config.auto) return;
      const lower = text.toLowerCase();
      if (['xin chào', 'hello', 'hi'].includes(lower)) await reply('Chào bạn! Gõ /help để xem lệnh.');
      else if (lower === 'bot') await reply('Bot đang hoạt động. Gõ /menu.');
    } catch (error) {
      console.error('MESSAGE ERROR:', error);
    }
  });

  api.listener.on('error', error => console.error('LISTENER ERROR:', error));
  api.listener.start();
  console.log('Listener đã chạy. Font và chế độ bận:', fontSettings);
}
