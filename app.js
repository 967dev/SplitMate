// Простая модель данных
const participants = []; // { id, name }
// shares теперь хранят КОНКРЕТНУЮ сумму для каждого участника по этой трате
// { id, title, amount, payerId, shares: {participantId: owedAmount} }
const expenses = [];
// оплаченные переводы: { fromId, toId, amount }
const payments = [];

// Хранилище (localStorage)
const STORAGE_KEY = "splitmate_state_v1";
const GAS_URL = "https://script.google.com/macros/s/AKfycbwyhmUD7lqoFPt7fMKpgxtm0e-0U8pjNmUevm_0Pfug2rq8PiQoMKXJTIR-Jk94HnwG/exec";

let globalState = {
  groups: {},
  lastGroupCode: null,
  lastUserName: null,
  currency: "₽",
};

const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) {
  tg.expand();
  // Если зашли через телеграм, скрываем поле ввода имени (оно подтянется само)
  if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
    const nameGroup = document.getElementById("name-input-group");
    if (nameGroup) nameGroup.style.display = "none";
  }
}

// Экран 1
const welcomeScreen = document.getElementById("welcome-screen");
const mainScreen = document.getElementById("main-screen");
const welcomeForm = document.getElementById("welcome-form");
const welcomeNameInput = document.getElementById("welcome-name");
const welcomeGroupInput = document.getElementById("welcome-group");

// Текущий пользователь и группа
let currentUserId = null;
let currentGroupCode = null;

// Экран 2: элементы интерфейса
const currentGroupCodeLabel = document.getElementById("current-group-code-label");
const currentUserNameEl = document.getElementById("current-user-name");
const currentUserBalanceEl = document.getElementById("current-user-balance");
const currentUserBalanceCaptionEl = document.getElementById("current-user-balance-caption");
const openAddExpenseBtn = document.getElementById("open-add-expense");
const openPaymentsBtn = document.getElementById("open-payments");

const participantForm = document.getElementById("participant-form");
const participantNameInput = document.getElementById("participant-name");
const participantsList = document.getElementById("participants-list");

const expenseForm = document.getElementById("expense-form");
const expenseTitleInput = document.getElementById("expense-title");
const expenseAmountInput = document.getElementById("expense-amount");
const expensePayerSelect = document.getElementById("expense-payer");
const expenseParticipantsContainer = document.getElementById("expense-participants");
const expensesList = document.getElementById("expenses-list");
const expenseDetailsEl = document.getElementById("expense-details");

const personalViewSelect = document.getElementById("personal-view");
const balancesSummaryEl = document.getElementById("balances-summary");
const settlementsEl = document.getElementById("settlements");
const splitEquallyBtn = document.getElementById("split-equally");
const toastContainer = document.getElementById("toast-container");

const currencySelect = document.getElementById("currency-select");
const exportDataBtn = document.getElementById("export-data");
const importDataBtn = document.getElementById("import-data");
const resetAllBtn = document.getElementById("reset-all");

let nextParticipantId = 1;
let nextExpenseId = 1;
let selectedExpenseId = null;

function getCurrency() {
  return globalState.currency || "₽";
}

function loadStateFromStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      globalState = {
        groups: parsed.groups || {},
        lastGroupCode: parsed.lastGroupCode || null,
        lastUserName: parsed.lastUserName || null,
        currency: parsed.currency || "₽",
      };
      if (currencySelect) currencySelect.value = globalState.currency;
    }
  } catch (e) {
    console.warn("Не удалось прочитать состояние SplitMate из localStorage:", e);
  }
}

function persistStateToStorage() {
  try {
    const data = JSON.stringify(globalState);
    window.localStorage.setItem(STORAGE_KEY, data);
  } catch (e) {
    console.warn("Не удалось сохранить состояние SplitMate в localStorage:", e);
  }
}

function syncCurrentArraysFromGroup(groupCode) {
  const group = globalState.groups[groupCode];
  if (!group) return;

  // очищаем и заполняем актуальными данными
  participants.length = 0;
  (group.participants || []).forEach((p) => participants.push({ ...p }));

  expenses.length = 0;
  (group.expenses || []).forEach((e) =>
    expenses.push({
      ...e,
      shares: { ...(e.shares || {}) },
    })
  );

  payments.length = 0;
  (group.payments || []).forEach((p) =>
    payments.push({
      ...p,
    })
  );

  nextParticipantId = group.nextParticipantId || 1;
  nextExpenseId = group.nextExpenseId || 1;
}

function saveCurrentGroupToState() {
  if (!currentGroupCode) return;
  globalState.groups[currentGroupCode] = {
    participants: participants.map((p) => ({ ...p })),
    expenses: expenses.map((e) => ({
      ...e,
      shares: { ...(e.shares || {}) },
    })),
    payments: payments.map((p) => ({ ...p })),
    nextParticipantId,
    nextExpenseId,
  };
  persistStateToStorage();
  syncWithBackend();
}

async function syncWithBackend() {
  if (!currentGroupCode || !GAS_URL) return;
  try {
    const stateToSend = globalState.groups[currentGroupCode];
    await fetch(GAS_URL, {
      method: "POST",
      mode: "no-cors", // GAS требует no-cors для простых POST
      body: JSON.stringify({
        groupCode: currentGroupCode,
        state: stateToSend
      })
    });
    // Мы не можем прочитать ответ в no-cors, но сохранение обычно проходит
  } catch (e) {
    console.error("Ошибка синхронизации с GAS:", e);
  }
}

async function loadFromBackend(groupCode) {
  if (!GAS_URL) return;
  try {
    const resp = await fetch(`${GAS_URL}?groupCode=${encodeURIComponent(groupCode)}`);
    const json = await resp.json();
    if (json.state) {
      globalState.groups[groupCode] = json.state;
      syncCurrentArraysFromGroup(groupCode);
      renderAll();
      showToast("Данные загружены из облака", "success");
    }
  } catch (e) {
    console.error("Не удалось загрузить данные из GAS:", e);
  }
}

function renderAll() {
  renderParticipants();
  renderExpenses();
  renderSummaryAndSettlements();
  renderCurrentUserBalance();
}

function formatMoney(value) {
  return value.toFixed(2).replace(".", ",") + " " + getCurrency();
}

/**
 * Переводит сумму в копейки (целое число) для точности вычислений
 */
function toCents(amount) {
  return Math.round(amount * 100);
}

/**
 * Переводит копейки обратно в рубли
 */
function fromCents(cents) {
  return cents / 100;
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-out");
    toast.addEventListener("animationend", () => {
      toast.remove();
    });
  }, 3000);
}

function renderParticipants() {
  // список «табличкой»
  participantsList.innerHTML = "";
  participants.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name;
    participantsList.appendChild(li);
  });

  // обновляем селект плательщика
  expensePayerSelect.innerHTML = "";
  if (participants.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Добавьте участников выше";
    expensePayerSelect.appendChild(opt);
  } else {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Выберите плательщика";
    expensePayerSelect.appendChild(opt);

    participants.forEach((p) => {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      expensePayerSelect.appendChild(o);
    });
  }

  // чекбоксы участников в расходе
  expenseParticipantsContainer.innerHTML = "";
  if (participants.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Добавьте участников выше";
    expenseParticipantsContainer.appendChild(p);
  } else {
    participants.forEach((p) => {
      const row = document.createElement("div");
      row.className = "participant-checkbox-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = p.id;
      checkbox.checked = true;

      const label = document.createElement("label");
      label.textContent = p.name;

      const shareInput = document.createElement("input");
      shareInput.type = "number";
      shareInput.min = "0";
      shareInput.step = "0.01";
      shareInput.placeholder = "сумма";

      row.appendChild(checkbox);
      row.appendChild(label);
      row.appendChild(shareInput);

      expenseParticipantsContainer.appendChild(row);
    });
  }

  // селект для персонального вида
  personalViewSelect.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "Всех сразу";
  personalViewSelect.appendChild(allOpt);
  participants.forEach((p) => {
    const o = document.createElement("option");
    o.value = String(p.id);
    o.textContent = p.name;
    personalViewSelect.appendChild(o);
  });

  // если есть текущий пользователь — по умолчанию выбран он
  if (currentUserId != null) {
    personalViewSelect.value = String(currentUserId);
  }
}

function renderExpenses() {
  expensesList.innerHTML = "";
  if (expenses.length === 0) {
    expenseDetailsEl.innerHTML =
      '<span class="muted small">Нажмите на трату выше, чтобы увидеть подробности по людям.</span>';
    selectedExpenseId = null;
    return;
  }
  expenses.forEach((e) => {
    const payer = participants.find((p) => p.id === e.payerId);
    const li = document.createElement("li");
    li.className = "list-item clickable";
    li.dataset.expenseId = String(e.id);
    if (selectedExpenseId === e.id) {
      li.classList.add("active");
    }

    const left = document.createElement("div");
    left.innerHTML = `<strong>${e.title}</strong><br /><span class="muted small">Заплатил: ${payer ? payer.name : "—"
      }</span>`;

    const right = document.createElement("div");
    right.innerHTML = `<span class="badge">${formatMoney(e.amount)}</span>`;

    li.appendChild(left);
    li.appendChild(right);

    expensesList.appendChild(li);

    li.addEventListener("click", () => {
      selectedExpenseId = e.id;
      renderExpenses();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "Удалить";
    deleteBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      if (confirm(`Удалить расход "${e.title}"?`)) {
        const idx = expenses.findIndex((ex) => ex.id === e.id);
        if (idx !== -1) {
          expenses.splice(idx, 1);
          if (selectedExpenseId === e.id) selectedExpenseId = null;
          showToast("Расход удален", "info");
          renderExpenses();
          renderSummaryAndSettlements();
          saveCurrentGroupToState();
        }
      }
    });
    right.appendChild(deleteBtn);
  });

  if (selectedExpenseId == null && expenses.length > 0) {
    selectedExpenseId = expenses[0].id;
  }
  renderExpenseDetails();
}

function renderExpenseDetails() {
  if (!selectedExpenseId) {
    expenseDetailsEl.innerHTML =
      '<span class="muted small">Нажмите на трату выше, чтобы увидеть подробности по людям.</span>';
    return;
  }

  const expense = expenses.find((e) => e.id === selectedExpenseId);
  if (!expense) {
    expenseDetailsEl.innerHTML =
      '<span class="muted small">Нажмите на трату выше, чтобы увидеть подробности по людям.</span>';
    return;
  }

  const payer = participants.find((p) => p.id === expense.payerId);

  let html = `<div><strong>${expense.title}</strong> — всего ${formatMoney(
    expense.amount
  )}</div>`;
  html += `<div class="small">Заплатил: <strong>${payer ? payer.name : "—"}</strong></div>`;

  html += '<div class="small" style="margin-top:4px;">Участники по этой трате:</div>';
  html += '<ul class="list small">';

  Object.entries(expense.shares).forEach(([participantId, owed]) => {
    const person = participants.find((p) => p.id === Number(participantId));
    html += `<li class="list-item">${person ? person.name : participantId}: ${formatMoney(
      owed
    )}</li>`;
  });
  html += "</ul>";

  expenseDetailsEl.innerHTML = html;
}

function computeBalances() {
  // Балансы в копейках для исключения ошибок с плавающей запятой
  const balances = {}; // participantId -> number (cents)

  // Сначала собираем ВСЕХ участников (даже если они удалены из активного списка, но есть в данных)
  participants.forEach((p) => {
    balances[p.id] = 0;
  });

  expenses.forEach((e) => {
    if (balances[e.payerId] === undefined) balances[e.payerId] = 0;
    Object.keys(e.shares).forEach((pid) => {
      const id = Number(pid);
      if (balances[id] === undefined) balances[id] = 0;
    });
  });

  payments.forEach((pmt) => {
    if (balances[pmt.fromId] === undefined) balances[pmt.fromId] = 0;
    if (balances[pmt.toId] === undefined) balances[pmt.toId] = 0;
  });

  // Для каждого расхода учитываем суммы по каждому человеку
  expenses.forEach((e) => {
    // каждый участник "должен" свою сумму
    Object.entries(e.shares).forEach(([participantId, owed]) => {
      const pid = Number(participantId);
      balances[pid] -= toCents(Number(owed) || 0);
    });

    // плательщик отдал деньги
    balances[e.payerId] += toCents(e.amount);
  });

  // Учитываем уже отмеченные оплаты
  payments.forEach((pmt) => {
    const amountCents = toCents(pmt.amount);
    balances[pmt.fromId] += amountCents; // должник стал должен меньше
    balances[pmt.toId] -= amountCents;   // кредитору должны меньше
  });

  return balances; // Возвращаем в копейках
}

function computeSettlements(balancesInCents) {
  const creditors = []; // кому должны
  const debtors = []; // кто должен

  Object.entries(balancesInCents).forEach(([id, bal]) => {
    const value = Math.round(bal);
    if (value > 0) {
      creditors.push({ id: Number(id), amount: value });
    } else if (value < 0) {
      debtors.push({ id: Number(id), amount: value });
    }
  });

  // Сортируем: жадный алгоритм лучше всего работает, если закрывать самые крупные долги первыми
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => a.amount - b.amount);

  const transfers = []; // { fromId, toId, amount }
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci];
    const d = debtors[di];

    const payAmountCents = Math.min(c.amount, -d.amount);
    if (payAmountCents <= 0) break;

    transfers.push({
      fromId: d.id,
      toId: c.id,
      amount: fromCents(payAmountCents),
    });

    c.amount -= payAmountCents;
    d.amount += payAmountCents;

    if (c.amount <= 0) ci++;
    if (d.amount >= 0) di++;
  }

  return transfers;
}

function renderSummaryAndSettlements() {
  const balancesInCents = computeBalances();
  const selected = personalViewSelect.value; // "all" или id участника

  balancesSummaryEl.innerHTML = "";
  settlementsEl.innerHTML = "";

  const balanceEntries = Object.entries(balancesInCents);

  if (balanceEntries.length === 0) {
    balancesSummaryEl.innerHTML = '<p class="muted">Добавьте участников и расходы.</p>';
    renderCurrentUserBalance(balancesInCents);
    return;
  }

  // Сводка
  balanceEntries.forEach(([id, balCents]) => {
    // Фильтрация по участнику, если выбран персональный вид
    if (selected !== "all" && id !== selected) return;

    const person = participants.find((p) => p.id === Number(id));
    const bal = fromCents(balCents);

    // Скрываем нулевых участников в общем списке для чистоты
    if (Math.abs(bal) < 0.001 && selected === "all") return;

    const line = document.createElement("div");
    line.className = "summary-line";
    if (bal > 0.001) line.classList.add("positive");
    if (bal < -0.001) line.classList.add("negative");

    const nameSpan = document.createElement("span");
    nameSpan.textContent = person ? person.name : `Участник ${id}`;

    const valueSpan = document.createElement("span");
    let text;
    if (bal > 0.001) {
      text = `Ему должны: ${formatMoney(bal)}`;
    } else if (bal < -0.001) {
      text = `Он должен: ${formatMoney(-bal)}`;
    } else {
      text = "По нулям";
    }
    valueSpan.textContent = text;

    line.appendChild(nameSpan);
    line.appendChild(valueSpan);

    balancesSummaryEl.appendChild(line);
  });

  // Переводы между людьми
  const transfers = computeSettlements(balancesInCents);
  if (transfers.length === 0) {
    settlementsEl.innerHTML = '<p class="muted small">Все рассчитались, переводов не требуется.</p>';
    renderCurrentUserBalance(balancesInCents);
    return;
  }

  const forAll = selected === "all";

  transfers.forEach((t) => {
    if (!forAll && String(t.fromId) !== selected && String(t.toId) !== selected) {
      return;
    }
    const from = participants.find((p) => p.id === t.fromId);
    const to = participants.find((p) => p.id === t.toId);
    const div = document.createElement("div");
    div.className = "settlement-line";

    const mainText = document.createElement("span");
    mainText.textContent = `${from ? from.name : t.fromId} → ${to ? to.name : t.toId
      }: ${formatMoney(t.amount)}`;
    div.appendChild(mainText);

    // Кнопка "отметить как оплачено" доступна, если текущий пользователь участвует
    if (currentUserId != null && (t.fromId === currentUserId || t.toId === currentUserId)) {
      const btn = document.createElement("button");
      btn.className = "secondary-btn small";
      btn.style.marginLeft = "8px";
      btn.textContent = "Отметить как оплачено";
      btn.addEventListener("click", () => {
        if (
          confirm(
            `Считать, что перевод ${formatMoney(t.amount)} от ${from ? from.name : t.fromId
            } к ${to ? to.name : t.toId} уже оплачен?`
          )
        ) {
          payments.push({
            fromId: t.fromId,
            toId: t.toId,
            amount: t.amount,
          });
          saveCurrentGroupToState();
          showToast("Оплата отмечена", "success");
          renderSummaryAndSettlements();
        }
      });
      div.appendChild(btn);
    }

    settlementsEl.appendChild(div);
  });

  // обновляем баланс текущего пользователя
  renderCurrentUserBalance(balancesInCents);
}

function renderCurrentUserBalance(existingBalancesCents) {
  if (currentUserId == null) {
    currentUserBalanceEl.textContent = "0 " + getCurrency();
    currentUserBalanceCaptionEl.textContent = "Войди в группу, чтобы увидеть баланс";
    return;
  }

  const balances = existingBalancesCents || computeBalances();
  const balCents = balances[currentUserId] || 0;
  const bal = fromCents(balCents);
  currentUserBalanceEl.textContent = formatMoney(Math.abs(bal));

  if (Math.abs(bal) < 0.001) {
    currentUserBalanceCaptionEl.textContent = "По нулям, с тебя и тебе никто не должен";
  } else if (bal > 0) {
    currentUserBalanceCaptionEl.textContent = "Тебе должны";
  } else {
    currentUserBalanceCaptionEl.textContent = "Ты должен(на)";
  }
}

// Экран 1: вход / группа
welcomeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const group = welcomeGroupInput.value.trim();
  if (!group) return;

  // Имя берем из Telegram или из инпута (если остался для теста)
  let name = "Гость";
  if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
    name = tg.initDataUnsafe.user.username ? `@${tg.initDataUnsafe.user.username}` : tg.initDataUnsafe.user.first_name;
  } else {
    name = welcomeNameInput.value.trim() || globalState.lastUserName || "Пользователь";
  }

  currentGroupCode = group;
  if (currentGroupCodeLabel) currentGroupCodeLabel.textContent = group;

  // Сначала подгружаем из облака
  await loadFromBackend(currentGroupCode);

  if (!globalState.groups[currentGroupCode]) {
    globalState.groups[currentGroupCode] = {
      participants: [],
      expenses: [],
      payments: [],
      nextParticipantId: 1,
      nextExpenseId: 1,
    };
  }

  syncCurrentArraysFromGroup(currentGroupCode);

  // создаём участника как "текущего пользователя"
  const existing = participants.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    currentUserId = existing.id;
  } else {
    const newP = { id: nextParticipantId++, name };
    participants.push(newP);
    currentUserId = newP.id;
  }

  currentUserNameEl.textContent = name;
  globalState.lastGroupCode = currentGroupCode;
  globalState.lastUserName = name;
  saveCurrentGroupToState();

  welcomeScreen.classList.remove("screen-active");
  welcomeScreen.classList.add("screen-hidden");
  mainScreen.classList.remove("screen-hidden");
  mainScreen.classList.add("screen-active");

  renderAll();
});

// Кнопка приглашения
const inviteBtn = document.getElementById("invite-btn");
if (inviteBtn) {
  inviteBtn.addEventListener("click", () => {
    if (!currentGroupCode) return;

    // Если мы в Telegram, генерируем ссылку startapp
    // Пользователю нужно будет заменить BOT_USERNAME на своего бота
    const botUsername = "spl1tmate_bot"; // Важно: замените на юзернейм вашего бота (без @)
    const joinLink = `https://t.me/${botUsername}/app?startapp=${currentGroupCode}`;

    // Если нет бота, просто копируем код
    const text = `Заходи в SplitMate для разделения чеков!\nГруппа: ${currentGroupCode}\n\n${joinLink}`;

    if (tg && tg.onEvent) {
      tg.switchInlineQuery(currentGroupCode, ["users", "groups", "channels"]);
      showToast("Используй поиск, чтобы отправить код группы друзьям", "success");
    } else {
      navigator.clipboard.writeText(text).then(() => {
        showToast("Ссылка и код скопированы!", "success");
      });
    }
  });
}

// Кнопки "Добавить расход" / "Оплатить"
openAddExpenseBtn.addEventListener("click", () => {
  expenseTitleInput.focus();
  expenseTitleInput.scrollIntoView({ behavior: "smooth", block: "center" });
});

openPaymentsBtn.addEventListener("click", () => {
  settlementsEl.scrollIntoView({ behavior: "smooth", block: "center" });
});

participantForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = participantNameInput.value.trim();
  if (!name) return;
  participants.push({ id: nextParticipantId++, name });
  participantNameInput.value = "";
  renderParticipants();
  renderSummaryAndSettlements();
  saveCurrentGroupToState();
});

expenseForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (participants.length === 0) {
    alert("Сначала добавьте хотя бы одного участника.");
    return;
  }

  const title = expenseTitleInput.value.trim();
  const amount = parseFloat(expenseAmountInput.value.replace(",", "."));
  const payerId = Number(expensePayerSelect.value);

  if (!title || !amount || !payerId) {
    showToast("Заполните описание, сумму и плательщика", "error");
    return;
  }

  const shares = {};
  let hasAny = false;
  const rows = expenseParticipantsContainer.querySelectorAll(".participant-checkbox-row");
  rows.forEach((row) => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    const shareInput = row.querySelector('input[type="number"]');
    if (!checkbox || !shareInput) return;
    if (!checkbox.checked) return;
    const owed = parseFloat(shareInput.value.replace(",", "."));
    if (!owed || owed <= 0) return;
    shares[checkbox.value] = Math.round(owed * 100) / 100;
    hasAny = true;
  });

  if (!hasAny) {
    showToast("Выберите хотя бы одного участника и укажите сумму", "error");
    return;
  }

  // Проверяем, что сумма по людям совпадает с общей суммой чека
  let totalByPeople = 0;
  Object.values(shares).forEach((v) => {
    totalByPeople += Number(v) || 0;
  });
  totalByPeople = Math.round(totalByPeople * 100) / 100;

  const roundedAmount = Math.round(amount * 100) / 100;
  const diff = Math.abs(totalByPeople - roundedAmount);
  if (diff > 0.01) {
    showToast(`Сумма по людям не совпадает с итогом (${diff.toFixed(2)} ₽)`, "error");
    return;
  }

  expenses.push({
    id: nextExpenseId++,
    title,
    amount: roundedAmount,
    payerId,
    shares,
  });

  expenseTitleInput.value = "";
  expenseAmountInput.value = "";

  renderExpenses();
  renderSummaryAndSettlements();
  saveCurrentGroupToState();
  showToast("Расход добавлен", "success");
});

splitEquallyBtn.addEventListener("click", () => {
  const amountStr = expenseAmountInput.value.replace(",", ".");
  const amount = parseFloat(amountStr);

  if (!amount || amount <= 0) {
    showToast("Введите корректную сумму чека", "error");
    return;
  }

  const rows = Array.from(expenseParticipantsContainer.querySelectorAll(".participant-checkbox-row"));
  const checkedRows = rows.filter((r) => r.querySelector('input[type="checkbox"]').checked);

  if (checkedRows.length === 0) {
    showToast("Выберите хотя бы одного участника", "error");
    return;
  }

  const share = Math.floor((amount / checkedRows.length) * 100) / 100;
  let currentTotal = 0;

  checkedRows.forEach((row, idx) => {
    const input = row.querySelector('input[type="number"]');
    if (idx === checkedRows.length - 1) {
      // Последнему отдаем остаток из-за округления
      const lastShare = Math.round((amount - currentTotal) * 100) / 100;
      input.value = lastShare.toFixed(2);
    } else {
      input.value = share.toFixed(2);
      currentTotal += share;
    }
  });

  showToast("Сумма разделена поровну", "info");
});

personalViewSelect.addEventListener("change", () => {
  renderSummaryAndSettlements();
});

currencySelect.addEventListener("change", () => {
  globalState.currency = currencySelect.value;
  persistStateToStorage();
  renderExpenses();
  renderSummaryAndSettlements();
  renderCurrentUserBalance();
  showToast("Валюта изменена", "info");
});

exportDataBtn.addEventListener("click", () => {
  const data = JSON.stringify(globalState);
  navigator.clipboard.writeText(data).then(() => {
    showToast("Данные скопированы в буфер", "success");
  });
});

importDataBtn.addEventListener("click", () => {
  const code = prompt("Вставьте код данных группы (JSON):");
  if (!code) return;
  try {
    const parsed = JSON.parse(code);
    if (parsed && parsed.groups) {
      globalState = parsed;
      persistStateToStorage();
      location.reload(); // Перезагружаем для чистого применения
    } else {
      showToast("Некорректный формат данных", "error");
    }
  } catch (e) {
    showToast("Ошибка при импорте данных", "error");
  }
});

resetAllBtn.addEventListener("click", () => {
  if (confirm("Вы уверены, что хотите удалить ВСЕ данные и сбросить приложение?")) {
    window.localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }
});

// Стартовая отрисовка
loadStateFromStorage();

// Если уже есть последняя группа и имя — подставляем их в форму
if (globalState.lastUserName) {
  welcomeNameInput.value = globalState.lastUserName;
}
if (globalState.lastGroupCode) {
  welcomeGroupInput.value = globalState.lastGroupCode;
}

// Обработка приглашения из Telegram
window.addEventListener("DOMContentLoaded", () => {
  if (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) {
    welcomeGroupInput.value = tg.initDataUnsafe.start_param;
    // Можно автоматически нажать "Продолжить" если юзернейм уже известен
    if (tg.initDataUnsafe.user) {
      setTimeout(() => welcomeForm.requestSubmit(), 500);
    }
  }
});

renderAll();

