import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { warn } from '../services/state.js';

const menu = `LỆNH BOT\n/help, /menu: danh sách lệnh\n/ping: kiểm tra bot\n/id: ID nhóm/người gửi\n/info: thông tin cuộc trò chuyện\n/image <tên file>: gửi ảnh trong media/\n/file <tên file>: gửi file trong media/\n/admins: xem ID quản trị\n/warn <ID>: cảnh báo thành viên (admin)\n/kick <ID>: mời thành viên ra nhóm (admin, phải bật ENABLE_KICK)`;
const mediaRoot = path.resolve('media');
function safeMedia(name) {
  if (!name || path.basename(name) !== name) throw Error('Chỉ nhập tên file trong thư mục media/.');
  const full = path.resolve(mediaRoot, name);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw Error('Không tìm thấy file trong media/.');
  if (fs.statSync(full).size > 15 * 1024 * 1024) throw Error('File quá 15 MB (giới hạn cấu hình bot).');
  return full;
}
export async function handleCommand({ api, message, text, senderId, isGroup, reply }) {
  if (!text.startsWith(config.prefix)) return false;
  const [raw, ...args] = text.slice(config.prefix.length).trim().split(/\s+/);
  const cmd = (raw || '').toLowerCase();
  const arg = args.join(' ');
  const admin = config.admins.has(String(senderId));
  try {
    switch(cmd) {
      case 'help': case 'menu': await reply(menu); break;
      case 'ping': await reply('Pong! Bot đang chạy.'); break;
      case 'id': await reply(`Sender ID: ${senderId}\nThread ID: ${message.threadId}\nLoại: ${isGroup ? 'Nhóm' : 'Cá nhân'}`); break;
      case 'info': await reply(`Cuộc trò chuyện: ${message.threadId}\nNgười gửi: ${senderId}\n${isGroup ? 'Nhóm' : 'Riêng tư'}`); break;
      case 'admins': await reply(`Admin IDs: ${[...config.admins].join(', ') || '(chưa cấu hình)'}`); break;
      case 'warn': {
        if (!admin || !isGroup) { await reply('Chỉ admin được cảnh báo trong nhóm.'); break; }
        if (!/^\d+$/.test(arg)) { await reply('Cú pháp: /warn <ID thành viên>'); break; }
        await reply(`Đã cảnh báo ${arg}. Tổng: ${warn(message.threadId,arg)} lần.`); break;
      }
      case 'kick': {
        if (!admin || !isGroup) { await reply('Chỉ admin được dùng lệnh này trong nhóm.'); break; }
        if (!config.kick) { await reply('Lệnh kick đang tắt. Bật ENABLE_KICK=true trong .env nếu muốn sử dụng.'); break; }
        if (!/^\d+$/.test(arg)) { await reply('Cú pháp: /kick <ID thành viên>'); break; }
        if (arg === String(senderId) || config.admins.has(arg)) { await reply('Không thể kick admin.'); break; }
        // API nhóm yêu cầu tài khoản Zalo có quyền quản trị nhóm.
        await api.removeUserFromGroup(arg, message.threadId);
        await reply(`Đã gửi yêu cầu xóa thành viên ${arg}.`);
        break;
      }
      case 'image': case 'file': {
        const file = safeMedia(arg);
        if (cmd === 'image' && !/\.(png|jpe?g|gif|webp)$/i.test(file)) throw Error('Lệnh /image chỉ nhận file ảnh.');
        await api.sendMessage({msg: `Tệp: ${path.basename(file)}`, attachments: [file]}, message.threadId, message.type);
        break;
      }
      default: await reply('Lệnh không tồn tại. Gõ /help.');
    }
  } catch (e) { console.error('Command error:', e); await reply(`Không thực hiện được: ${e.message}`); }
  return true;
}
