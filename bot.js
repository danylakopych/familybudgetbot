const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');

// Змінні середовища
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS;
const PORT = process.env.PORT || 3000;

// Налаштування Google Sheets
const credentials = JSON.parse(GOOGLE_CREDENTIALS || '{}');
const auth = new google.auth.GoogleAuth({
  credentials: credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Стан користувачів
const userState = {};

// Категорії
const EXPENSE_CATEGORIES = [
  ['🍔 Їжа', '🏠 Дім', '🚗 Транспорт'],
  ['💊 Здоров\'я', '🎭 Розваги', '👕 Одяг'],
  ['📱 Зв\'язок', '🎓 Освіта', '💰 Інше']
];

const INCOME_CATEGORIES = [
  ['💼 Зарплата', '💵 Бонус', '🎁 Подарунок'],
  ['📈 Інвестиції', '🏪 Продаж', '💰 Інше']
];

// Бюджети по категоріях (грн/місяць)
const BUDGETS = {
  '🍔 Їжа': 10000,
  '🏠 Дім': 5000,
  '🚗 Транспорт': 3000,
  '💊 Здоров\'я': 2000,
  '🎭 Розваги': 2000,
  '👕 Одяг': 3000,
  '📱 Зв\'язок': 500,
  '🎓 Освіта': 2000
};

// ============== КОМАНДИ ==============

// /start
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name;
  const username = msg.from.username || 'користувач';
  
  bot.sendMessage(msg.chat.id,
    `👋 Привіт, ${name}! Я бот для сімейного бюджету.\n\n` +
    `📊 Ваш username: @${username}\n\n` +
    `Основні команди:\n` +
    `💸 /add - Додати витрату\n` +
    `💰 /income - Додати дохід\n` +
    `📊 /report - Звіт за місяць\n` +
    `💳 /balance - Загальний баланс\n\n` +
    `Статистика:\n` +
    `📈 /stats - Статистика за період\n` +
    `🏷️ /categories - Витрати по категоріях\n` +
    `👤 /myexpenses - Мої витрати сьогодні\n` +
    `🎯 /budget - Статус бюджетів\n\n` +
    `Керування:\n` +
    `📥 /export - Експорт даних\n` +
    `🗑️ /delete - Видалити останню транзакцію\n` +
    `❓ /help - Допомога`
  );
});

// /add - Додати витрату
bot.onText(/\/add/, (msg) => {
  userState[msg.chat.id] = { step: 'amount', type: 'expense' };
  bot.sendMessage(msg.chat.id, '💸 Введіть суму витрати (грн):');
});

// /income - Додати дохід
bot.onText(/\/income/, (msg) => {
  userState[msg.chat.id] = { step: 'amount', type: 'income' };
  bot.sendMessage(msg.chat.id, '💰 Введіть суму доходу (грн):');
});

// /report - Звіт за місяць
bot.onText(/\/report/, async (msg) => {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F'
    });

    const rows = result.data.values || [];
    if (rows.length <= 1) {
      bot.sendMessage(msg.chat.id, '📭 Немає даних для звіту');
      return;
    }

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let totalIncome = 0;
    let totalExpense = 0;
    const categoryExpenses = {};

    rows.slice(1).forEach(row => {
      const date = new Date(row[0]);
      if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
        const type = row[2];
        const amount = parseFloat(row[3]) || 0;
        const category = row[4];

        if (type === 'Дохід') {
          totalIncome += amount;
        } else if (type === 'Витрата') {
          totalExpense += Math.abs(amount);
          categoryExpenses[category] = (categoryExpenses[category] || 0) + Math.abs(amount);
        }
      }
    });

    const balance = totalIncome - totalExpense;
    const monthName = now.toLocaleString('uk', { month: 'long' });

    let report = `📊 Звіт за ${monthName} ${currentYear}\n\n`;
    report += `💰 Доходи: ${totalIncome.toFixed(2)} грн\n`;
    report += `💸 Витрати: ${totalExpense.toFixed(2)} грн\n`;
    report += `📈 Баланс: ${balance.toFixed(2)} грн\n\n`;
    report += `📋 Витрати по категоріях:\n`;

    const sorted = Object.entries(categoryExpenses).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([cat, sum]) => {
      const percentage = ((sum / totalExpense) * 100).toFixed(1);
      report += `${cat}: ${sum.toFixed(2)} грн (${percentage}%)\n`;
    });

    bot.sendMessage(msg.chat.id, report);
  } catch (error) {
    console.error('Error generating report:', error);
    bot.sendMessage(msg.chat.id, '❌ Помилка при формуванні звіту');
  }
});

// /balance - Загальний баланс
bot.onText(/\/balance/, async (msg) => {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F'
    });

    const rows = result.data.values || [];
    if (rows.length <= 1) {
      bot.sendMessage(msg.chat.id, '📭 Немає транзакцій');
      return;
    }

    let totalIncome = 0;
    let totalExpense = 0;

    rows.slice(1).forEach(row => {
      const type = row[2];
      const amount = parseFloat(row[3]) || 0;

      if (type === 'Дохід') {
        totalIncome += amount;
      } else if (type === 'Витрата') {
        totalExpense += Math.abs(amount);
      }
    });

    const balance = totalIncome - totalExpense;
    const emoji = balance >= 0 ? '✅' : '⚠️';

    bot.sendMessage(msg.chat.id,
      `💳 Загальний баланс:\n\n` +
      `💰 Доходи: ${totalIncome.toFixed(2)} грн\n` +
      `💸 Витрати: ${totalExpense.toFixed(2)} грн\n` +
      `${emoji} Баланс: ${balance.toFixed(2)} грн`
    );
  } catch (error) {
    console.error('Error getting balance:', error);
    bot.sendMessage(msg.chat.id, '❌ Помилка при отриманні балансу');
  }
});

// /stats - Детальна статистика
bot.onText(/\/stats/, async (msg) => {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F'
    });

    const rows = result.data.values || [];
    if (rows.length <= 1) {
      bot.sendMessage(msg.chat.id, '📭 Немає даних');
      return;
    }

    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    let todayExpense = 0;
    let weekExpense = 0;
    let monthExpense = 0;

    rows.slice(1).forEach(row => {
      const date = new Date(row[0]);
      const type = row[2];
      const amount = Math.abs(parseFloat(row[3]) || 0);

      if (type === 'Витрата') {
        if (date.toDateString() === today.toDateString()) {
          todayExpense += amount;
        }
        if (date >= weekAgo) {
          weekExpense += amount;
        }
        if (date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear()) {
          monthExpense += amount;
        }
      }
    });

    const avgDaily = monthExpense / today.getDate();

    bot.sendMessage(msg.chat.id,
      `📊 Статистика витрат:\n\n` +
      `📅 Сьогодні: ${todayExpense.toFixed(2)} грн\n` +
      `📆 За тиждень: ${weekExpense.toFixed(2)} грн\n` +
      `📈 За місяць: ${monthExpense.toFixed(2)} грн\n` +
      `📊 Середньо за день: ${avgDaily.toFixed(2)} грн`
    );
  } catch (error) {
    console.error('Error getting stats:', error);
    bot.sendMessage(msg.chat.id, '❌ Помилка при отриманні статистики');
  }
});

// /categories - Витрати по категоріях за місяць
bot.onText(/\/categories/, async (msg) => {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F'
    });

    const rows = result.data.values || [];
    const today = new Date();
    const categoryData = {};

    rows.slice(1).forEach(row => {
      const date = new Date(row[0]);
      if (date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear()) {
        const type = row[2];
        const amount = Math.abs(parseFloat(row[3]) || 0);
        const category = row[4];

        if (type === 'Витрата') {
          categoryData[category] = (categoryData[category] || 0) + amount;
        }
      }
    });

    if (Object.keys(categoryData).length === 0) {
      bot.sendMessage(msg.chat.id, '📭 Немає витрат за цей місяць');
      return;
    }

    let message = '🏷️ Витрати по категоріях за місяць:\n\n';
    const sorted = Object.entries(categoryData).sort((a, b) => b[1] - a[1]);
    
    sorted.forEach(([cat, sum]) => {
      message += `${cat}: ${sum.toFixed(2)} грн\n`;
    });

    bot.sendMessage(msg.chat.id, message);
  } catch (error) {
    console.error('Error getting categories:', error);
    bot.sendMessage(msg.chat.id, '❌ Помилка при отриманні категорій');
  }
});

// /myexpenses - Мої витрати сьогодні
bot.onText(/\/myexpenses/, async (msg) => {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F'
    });

    const rows = result.data.values || [];
    const today = new Date().toDateString();
    const userName = msg.from.first_name;

    const myExpenses = rows.slice(1).filter(row => {
      const date = new Date(row[0]).toDateString();
      const user = row[1];
      const type = row[2];
      return date === today && user === userName && type === 'Витрата';
    });

    if (myExpenses.length === 0) {
      bot.sendMessage(msg.chat.id, '📭 У вас немає витрат сьогодні');
      return;
    }

    let total = 0;
    let message = `👤 Ваші витрати за сьогодні:\n\n`;

    myExpenses.forEach(row => {
      const amount = Math.abs(parseFloat(row[3]));
      const category = row[4];
      const description = row[5] || '';
      total += amount;
      message += `${category}: ${amount.toFixed(2)} грн`;
      if (description) message += ` - ${description}`;
      message += `\n`;
    });

    message += `\n💰 Загалом: ${total.toFixed(2)} грн`;
    bot.sendMessage(msg.chat.id, message);
  } catch (error) {
    console.error('Error getting my expenses:', error);
    bot.sendMessage(msg.chat.id, '❌ Помилка при отриманні витрат');
  }
});

// /budget - Статус бюджетів
bot.onText(/\/budget/, async (msg) => {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F'
    });

    const rows = result.data.values || [];
    const today = new Date();
    const categoryExpenses = {};

    rows.slice(1).forEach(row => {
      const date = new Date(row[0]);
      if (date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear()) {
        const type = row[2];
        const amount = Math.abs(parseFloat(row[3]) || 0);
        const category = row[4];

        if (type === 'Витрата') {
          categoryExpenses[category] = (categoryExpenses[category] || 0) + amount;
        }
      }
    });

    let message = `🎯 Статус бюджетів за місяць:\n\n`;

    Object.entries(BUDGETS).forEach(([cat, budget]) => {
      const spent = categoryExpenses[cat] || 0;
      const remaining = budget - spent;
      const percentage = ((spent / budget) * 100).toFixed(1);
      
      let emoji = '✅';
      if (percentage > 90) emoji = '🔴';
      else if (percentage > 70) emoji = '🟡';

      message += `${emoji} ${cat}\n`;
      message += `   Витрачено: ${spent.toFixed(2)} / ${budget} грн (${percentage}%)\n`;
      message += `   Залишок: ${remaining.toFixed(2)} грн\n\n`;
    });

    bot.sendMessage(msg.chat.id, message);
  } catch (error) {
    console.error('Error getting budget:', error);
    bot.sendMessage(msg.chat.id, '❌ Помилка при отриманні бюджету');
  }
});

// /export - Експорт даних
bot.onText(/\/export/, async (msg) => {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=xlsx`;
  bot.sendMessage(msg.chat.id,
    `📥 Експорт даних:\n\n` +
    `Excel: ${url}\n\n` +
    `Або відкрийте таблицю:\n` +
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`
  );
});

// /delete - Видалити останню транзакцію
bot.onText(/\/delete/, async (msg) => {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F'
    });

    const rows = result.data.values || [];
    const userName = msg.from.first_name;

    // Знайти останню транзакцію користувача
    let lastRowIndex = -1;
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][1] === userName) {
        lastRowIndex = i;
        break;
      }
    }

    if (lastRowIndex === -1) {
      bot.sendMessage(msg.chat.id, '❌ У вас немає транзакцій для видалення');
      return;
    }

    const deletedRow = rows[lastRowIndex];
    
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `Sheet1!A${lastRowIndex + 1}:F${lastRowIndex + 1}`
    });

    bot.sendMessage(msg.chat.id,
      `🗑️ Видалено транзакцію:\n\n` +
      `${deletedRow[2]}: ${deletedRow[3]} грн\n` +
      `Категорія: ${deletedRow[4]}\n` +
      `Опис: ${deletedRow[5] || '-'}`
    );
  } catch (error) {
    console.error('Error deleting transaction:', error);
    bot.sendMessage(msg.chat.id, '❌ Помилка при видаленні');
  }
});

// /help - Допомога
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `❓ Довідка по командах:\n\n` +
    `💸 /add - Додати витрату через діалог\n` +
    `💰 /income - Додати дохід\n` +
    `📊 /report - Детальний звіт за місяць з категоріями\n` +
    `💳 /balance - Загальний баланс доходів і витрат\n` +
    `📈 /stats - Статистика: сьогодні, тиждень, місяць\n` +
    `🏷️ /categories - Витрати згруповані по категоріях\n` +
    `👤 /myexpenses - Тільки ваші витрати за сьогодні\n` +
    `🎯 /budget - Перевірка бюджетів по категоріях\n` +
    `📥 /export - Отримати посилання для експорту в Excel\n` +
    `🗑️ /delete - Видалити вашу останню транзакцію\n\n` +
    `💡 Підказка: Після /add або /income просто слідуйте інструкціям бота!`
  );
});

// ============== ОБРОБКА ПОВІДОМЛЕНЬ ==============

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const state = userState[chatId];
  
  // Ігноруємо команди
  if (msg.text && msg.text.startsWith('/')) return;
  
  if (!state) return;
  
  // Крок 1: Введення суми
  if (state.step === 'amount') {
    const amount = parseFloat(msg.text);
    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, '❌ Введіть коректне число більше 0!');
      return;
    }
    userState[chatId].amount = amount;
    userState[chatId].step = 'category';
    
    const categories = state.type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    const typeText = state.type === 'expense' ? 'витрати' : 'доходу';
    
    bot.sendMessage(chatId, `🏷️ Виберіть категорію ${typeText}:`, {
      reply_markup: {
        keyboard: categories,
        one_time_keyboard: true,
        resize_keyboard: true
      }
    });
  }
  // Крок 2: Вибір категорії
  else if (state.step === 'category') {
    userState[chatId].category = msg.text;
    userState[chatId].step = 'description';
    bot.sendMessage(chatId, '📝 Введіть опис (або /skip для пропуску):');
  }
  // Крок 3: Введення опису
  else if (state.step === 'description') {
    const description = msg.text === '/skip' ? '' : msg.text;
    
    try {
      // Збереження в Google Sheets
      const typeText = state.type === 'expense' ? 'Витрата' : 'Дохід';
      const amount = state.type === 'expense' ? -Math.abs(state.amount) : Math.abs(state.amount);
      
      const row = [
        new Date().toLocaleString('uk-UA', { 
          year: 'numeric', 
          month: '2-digit', 
          day: '2-digit', 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
        msg.from.first_name,
        typeText,
        amount,
        state.category,
        description
      ];
      
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Sheet1!A:F',
        valueInputOption: 'USER_ENTERED',
        resource: { values: [row] }
      });
      
      const emoji = state.type === 'expense' ? '💸' : '💰';
      bot.sendMessage(chatId,
        `✅ ${typeText} додано!\n\n` +
        `${emoji} Сума: ${Math.abs(state.amount).toFixed(2)} грн\n` +
        `🏷️ Категорія: ${state.category}\n` +
        `📝 Опис: ${description || '-'}`,
        { reply_markup: { remove_keyboard: true } }
      );
      
      // Перевірка бюджету для витрат
      if (state.type === 'expense' && BUDGETS[state.category]) {
        checkBudgetWarning(chatId, state.category);
      }
      
    } catch (error) {
      console.error('Error saving to sheets:', error);
      bot.sendMessage(chatId, '❌ Помилка при збереженні. Спробуйте ще раз.');
    }
    
    delete userState[chatId];
  }
});

// Функція перевірки бюджету
async function checkBudgetWarning(chatId, category) {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F'
    });

    const rows = result.data.values || [];
    const today = new Date();
    let categoryTotal = 0;

    rows.slice(1).forEach(row => {
      const date = new Date(row[0]);
      if (date.getMonth() === today.getMonth() && 
          date.getFullYear() === today.getFullYear() &&
          row[2] === 'Витрата' &&
          row[4] === category) {
        categoryTotal += Math.abs(parseFloat(row[3]) || 0);
      }
    });

    const budget = BUDGETS[category];
    const percentage = (categoryTotal / budget) * 100;

    if (percentage >= 90) {
      bot.sendMessage(chatId,
        `⚠️ УВАГА! Бюджет категорії "${category}" майже вичерпано!\n\n` +
        `Витрачено: ${categoryTotal.toFixed(2)} / ${budget} грн (${percentage.toFixed(1)}%)`
      );
    } else if (percentage >= 70) {
      bot.sendMessage(chatId,
        `🟡 Бюджет категорії "${category}" на ${percentage.toFixed(1)}%\n` +
        `Залишилось: ${(budget - categoryTotal).toFixed(2)} грн`
      );
    }
  } catch (error) {
    console.error('Error checking budget:', error);
  }
}

// Обробка помилок
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

console.log('🤖 Бот запущено!');
console.log('⏰', new Date().toLocaleString('uk-UA'));