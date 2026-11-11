import 'dotenv/config';
const ids = (v) => new Set((v || '').split(',').map(x=>x.trim()).filter(Boolean));
export const config = {
  prefix: process.env.PREFIX || '/',
  admins: ids(process.env.ADMIN_IDS),
  groups: ids(process.env.ALLOWED_GROUP_IDS),
  auto: process.env.AUTO_REPLY !== 'false',
  welcome: process.env.WELCOME !== 'false',
  kick: process.env.ENABLE_KICK === 'true',
  cooldown: Math.max(0, Number(process.env.COOLDOWN_MS) || 1500),
};
