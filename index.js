import { startBot } from './src/bot.js';
startBot().catch(error => { console.error('Không khởi động được:', error); process.exitCode = 1; });
