const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
const fs = require('fs');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Налаштування Google Sheets
const auth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Стан користувача
const userState = {};

const CATEGORIES = [
  ['🍔 Їжа', '🏠 Дім', '🚗 Транспорт'],
  ['💊 Здоров\'я', '🎭 Розваги', '👕 Одяг'],
  ['📱 Зв\'язок', '💰 Інше']
];

bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name;
  bot.sendMessage(msg.chat.id,
    `👋 Привіт, ${name}! Я бот для сімейного бюджету.\n\n` +
    `Команди:\n` +
    `/add - Додати витрату\n` +
    `/income - Додати дохід\n` +
    `/report - Звіт за місяць\n` +
    `/balance - Загальний баланс`);
});

bot.onText(/\/add/, (msg) => {
  userState[msg.chat.id] = { step: 'amount', type: 'expense' };
  bot.sendMessage(msg.chat.id, '💸 Введіть суму витрати:');
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const state = userState[chatId];
  
  if (!state) return;
  
  if (state.step === 'amount') {
    const amount = parseFloat(msg.text);
    if (isNaN(amount)) {
      bot.sendMessage(chatId, '❌ Введіть число!');
      return;
    }
    userState[chatId].amount = amount;
    userState[chatId].step = 'category';
    
    bot.sendMessage(chatId, '🏷️ Виберіть категорію:', {
      reply_markup: {
        keyboard: CATEGORIES,
        one_time_keyboard: true
      }
    });
  } else if (state.step === 'category') {
    userState[chatId].category = msg.text;
    userState[chatId].step = 'description';
    bot.sendMessage(chatId, '📝 Введіть опис (або /skip):');
  } else if (state.step === 'description') {
    const description = msg.text === '/skip' ? '' : msg.text;
    
    // Збереження в Google Sheets
    const row = [
      new Date().toLocaleString('uk-UA'),
      msg.from.first_name,
      'Витрата',
      state.amount,
      state.category,
      description
    ];
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] }
    });
    
    bot.sendMessage(chatId,
      `✅ Витрату додано!\n\n` +
      `💰 Сума: ${state.amount} грн\n` +
      `🏷️ Категорія: ${state.category}\n` +
      `📝 Опис: ${description}`);
    
    delete userState[chatId];
  }
});