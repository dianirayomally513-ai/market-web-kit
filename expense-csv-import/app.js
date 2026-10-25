(function () {
  'use strict';

  const LS_KEY = 'expense-csv-overrides-v1';

  /** @type {Array<Txn>} */
  let transactions = [];
  /** @type {Record<string, string>} id -> category override */
  let overrides = loadOverrides();

  const $ = (id) => document.getElementById(id);

  // ---------- utils ----------
  function loadOverrides() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }
  function saveOverrides() {
    localStorage.setItem(LS_KEY, JSON.stringify(overrides));
  }

  function stripBom(text) {
    if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
    return text;
  }

  /** 简易 CSV 行解析：支持双引号包裹与逗号 */
  function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }

  function splitLines(text) {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  }

  function findHeaderIndex(lines) {
    for (let i = 0; i < Math.min(lines.length, 40); i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#') || line.startsWith('-')) continue;
      const cols = parseCsvLine(line);
      const joined = cols.join('|');
      if (
        (joined.includes('交易时间') && joined.includes('交易对方') && (joined.includes('金额') || joined.includes('金额(元)'))) ||
        (joined.includes('交易时间') && joined.includes('收/支') && joined.includes('金额'))
      ) {
        return i;
      }
    }
    return -1;
  }

  function detectFormat(headers) {
    const h = headers.join('|');
    if (h.includes('金额(元)') || h.includes('当前状态') || h.includes('支付方式')) return 'wechat';
    if (h.includes('交易分类') || h.includes('收/付款方式') || h.includes('对方账号') || h.includes('商品说明')) return 'alipay';
    if (h.includes('交易对方') && h.includes('收/支')) return 'generic';
    return 'unknown';
  }

  function colIndex(headers, names) {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0) return i;
    }
    // 模糊：包含关键词
    for (let i = 0; i < headers.length; i++) {
      for (const n of names) {
        if (headers[i].includes(n)) return i;
      }
    }
    return -1;
  }

  function parseAmount(raw) {
    if (raw == null) return 0;
    let s = String(raw).trim().replace(/¥/g, '').replace(/￥/g, '').replace(/,/g, '');
    // 微信有时写成 / 或空
    if (!s || s === '/') return 0;
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.abs(n) : 0;
  }

  function normalizeDirection(raw) {
    const s = String(raw || '').trim();
    if (s.includes('收入') || s === '入') return '收入';
    if (s.includes('支出') || s === '出') return '支出';
    if (s.includes('不计') || s === '/' || s === '') return '不计收支';
    return s || '不计收支';
  }

  function isRefundStatus(status) {
    const s = String(status || '');
    return (window.REFUND_STATUS_KEYWORDS || []).some((k) => s.includes(k));
  }

  function categorize(merchant, goods) {
    const text = `${merchant || ''} ${goods || ''}`.toLowerCase();
    const rules = window.EXPENSE_RULES || [];
    for (const rule of rules) {
      if (!rule.keywords) continue;
      const parts = rule.keywords.split('|').map((x) => x.trim()).filter(Boolean);
      for (const kw of parts) {
        if (kw && text.includes(kw.toLowerCase())) return rule.category;
      }
    }
    return '其他';
  }

  function makeId(format, time, merchant, amount, orderNo, idx) {
    return `${format}|${time}|${merchant}|${amount}|${orderNo || ''}|${idx}`;
  }

  /**
   * @typedef {{
   *   id: string, time: string, merchant: string, goods: string,
   *   direction: string, amount: number, status: string,
   *   format: string, isRefund: boolean, autoCategory: string
   * }} Txn
   */

  function parseBillText(text) {
    text = stripBom(text);
    const lines = splitLines(text);
    const headerIdx = findHeaderIndex(lines);
    if (headerIdx < 0) {
      throw new Error('未找到账单表头（需含「交易时间」「交易对方」「金额」等列）。请确认是微信/支付宝导出的 CSV。');
    }
    const headers = parseCsvLine(lines[headerIdx]).map((h) => h.replace(/^\ufeff/, '').trim());
    const format = detectFormat(headers);
    if (format === 'unknown') {
      throw new Error('无法识别账单格式。请使用微信或支付宝官方导出的 CSV。');
    }

    const iTime = colIndex(headers, ['交易时间']);
    const iMerchant = colIndex(headers, ['交易对方']);
    const iGoods = colIndex(headers, ['商品', '商品说明']);
    const iDir = colIndex(headers, ['收/支']);
    const iAmount = colIndex(headers, ['金额(元)', '金额']);
    const iStatus = colIndex(headers, ['当前状态', '交易状态']);
    const iOrder = colIndex(headers, ['交易单号', '交易订单号']);

    if (iTime < 0 || iMerchant < 0 || iAmount < 0 || iDir < 0) {
      throw new Error('表头缺少必要列：交易时间 / 交易对方 / 收/支 / 金额。');
    }

    /** @type {Txn[]} */
    const rows = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#') || line.startsWith('-')) continue;
      // 支付宝末尾有时有说明行
      if (line.includes('导出时间') || line.startsWith('--------')) continue;
      const cols = parseCsvLine(line);
      if (cols.length < 4) continue;

      const time = cols[iTime] || '';
      const merchant = cols[iMerchant] || '';
      const goods = iGoods >= 0 ? cols[iGoods] || '' : '';
      const direction = normalizeDirection(cols[iDir]);
      const amount = parseAmount(cols[iAmount]);
      const status = iStatus >= 0 ? cols[iStatus] || '' : '';
      const orderNo = iOrder >= 0 ? cols[iOrder] || '' : '';

      if (!time && !merchant) continue;
      if (amount === 0 && direction === '不计收支') continue;

      const isRefund = isRefundStatus(status);
      const autoCategory = categorize(merchant, goods);
      const id = makeId(format, time, merchant, amount, orderNo, i);

      rows.push({
        id,
        time,
        merchant,
        goods,
        direction,
        amount,
        status,
        format,
        isRefund,
        autoCategory,
      });
    }

    if (!rows.length) {
      throw new Error('解析到表头，但没有有效交易行。请检查文件内容。');
    }
    return { format, rows };
  }

  function effectiveCategory(txn) {
    return overrides[txn.id] || txn.autoCategory;
  }

  function getFiltered() {
    const dirFilter = $('filter-dir').value;
    const catFilter = $('filter-cat').value;
    const includeRefunds = $('include-refunds').checked;

    return transactions.filter((t) => {
      if (!includeRefunds && t.isRefund) return false;
      if (dirFilter === '支出' && t.direction !== '支出') return false;
      if (dirFilter === '收入' && t.direction !== '收入') return false;
      if (catFilter !== '全部' && effectiveCategory(t) !== catFilter) return false;
      return true;
    });
  }

  function computeTotals() {
    let expense = 0;
    let income = 0;
    const byCat = {};
    for (const c of window.CATEGORY_LIST || []) byCat[c] = 0;

    // 支出/收入合计永远排除退款与交易关闭，避免重复计算
    for (const t of transactions) {
      if (t.direction === '支出' && !t.isRefund) {
        expense += t.amount;
        const cat = effectiveCategory(t);
        byCat[cat] = (byCat[cat] || 0) + t.amount;
      } else if (t.direction === '收入' && !t.isRefund) {
        income += t.amount;
      }
    }

    return { expense, income, byCat, count: transactions.length };
  }

  function formatMoney(n) {
    return '¥' + n.toFixed(2);
  }

  function render() {
    const includeRefunds = $('include-refunds').checked;
    const totals = computeTotals();
    const filtered = getFiltered();

    $('sum-expense').textContent = formatMoney(totals.expense);
    $('sum-income').textContent = formatMoney(totals.income);
    $('sum-count').textContent = String(filtered.length) + ' / ' + totals.count;

    // category bars — based on full non-refund expenses
    const maxCat = Math.max(1, ...Object.values(totals.byCat));
    const bars = $('cat-bars');
    bars.innerHTML = '';
    const entries = Object.entries(totals.byCat)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
      bars.innerHTML = '<div class="empty">暂无支出分类数据</div>';
    } else {
      for (const [cat, amt] of entries) {
        const pct = (amt / maxCat) * 100;
        const row = document.createElement('div');
        row.className = 'cat-row';
        row.innerHTML =
          `<span>${cat}</span>` +
          `<div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>` +
          `<span class="cat-amt">${formatMoney(amt)}</span>`;
        bars.appendChild(row);
      }
    }

    // unmatched
    const unmatched = transactions.filter(
      (t) => !t.isRefund && t.direction === '支出' && effectiveCategory(t) === '其他'
    ).length;
    const tip = $('unmatched-tip');
    if (unmatched > 0) {
      tip.style.display = 'block';
      tip.textContent = `有 ${unmatched} 笔支出落在「其他」，可在表格中改分类，或编辑 rules.js 增加关键词。`;
    } else {
      tip.style.display = 'none';
    }

    // populate cat filter options once
    const catSel = $('filter-cat');
    const prev = catSel.value;
    catSel.innerHTML = '<option value="全部">全部分类</option>';
    for (const c of window.CATEGORY_LIST || []) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      catSel.appendChild(opt);
    }
    if ([...catSel.options].some((o) => o.value === prev)) catSel.value = prev;

    // table
    const tbody = $('txn-body');
    tbody.innerHTML = '';
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">没有符合筛选的记录</td></tr>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const t of filtered) {
      const tr = document.createElement('tr');
      if (t.isRefund) tr.className = 'refund';
      const cat = effectiveCategory(t);
      const dirClass = t.direction === '收入' ? 'income' : t.direction === '支出' ? 'expense' : '';
      const statusNote = t.isRefund ? ` · ${t.status || '已退款'}` : '';

      const opts = (window.CATEGORY_LIST || [])
        .map((c) => `<option value="${c}"${c === cat ? ' selected' : ''}>${c}</option>`)
        .join('');

      tr.innerHTML =
        `<td>${escapeHtml(t.time)}</td>` +
        `<td class="merchant" title="${escapeAttr(t.merchant)}">${escapeHtml(t.merchant)}` +
        (t.goods ? `<div class="goods" title="${escapeAttr(t.goods)}">${escapeHtml(t.goods)}</div>` : '') +
        `</td>` +
        `<td class="amount ${dirClass}">${t.direction === '收入' ? '+' : t.direction === '支出' ? '-' : ''}${formatMoney(t.amount)}</td>` +
        `<td>${escapeHtml(t.direction)}${escapeHtml(statusNote)}</td>` +
        `<td><select class="cat-select" data-id="${escapeAttr(t.id)}">${opts}</select></td>` +
        `<td>${t.format === 'wechat' ? '微信' : t.format === 'alipay' ? '支付宝' : t.format}</td>`;
      frag.appendChild(tr);
    }
    tbody.appendChild(frag);

    tbody.querySelectorAll('select.cat-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const id = sel.getAttribute('data-id');
        overrides[id] = sel.value;
        saveOverrides();
        render();
      });
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function showError(msg) {
    const el = $('error');
    el.textContent = msg;
    el.classList.add('show');
  }
  function clearError() {
    const el = $('error');
    el.textContent = '';
    el.classList.remove('show');
  }

  function onParsed(rows, format) {
    transactions = rows;
    $('app-main').classList.add('visible');
    $('format-badge').textContent =
      format === 'wechat' ? '已识别：微信支付' : format === 'alipay' ? '已识别：支付宝' : '已识别：通用';
    clearError();
    render();
  }

  async function handleFile(file) {
    if (!file) return;
    clearError();
    const name = (file.name || '').toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.txt')) {
      showError('请上传 .csv 文件（微信/支付宝导出）。暂不支持直接读 .xlsx，请先另存为 CSV。');
      return;
    }

    try {
      let text = await readFileAsText(file, 'UTF-8');
      // 若大量替换符，尝试 GBK（部分旧版导出）
      if (looksLikeGarbled(text)) {
        try {
          text = await readFileAsText(file, 'GBK');
        } catch {
          /* keep utf-8 */
        }
      }
      const { format, rows } = parseBillText(text);
      onParsed(rows, format);
    } catch (e) {
      console.error(e);
      showError(e.message || String(e));
    }
  }

  function looksLikeGarbled(text) {
    // 表头附近应出现「交易」；若没有且有大量 �，可能是编码问题
    const head = text.slice(0, 2000);
    if (head.includes('交易时间') || head.includes('交易对方')) return false;
    const bad = (head.match(/\uFFFD/g) || []).length;
    return bad > 3;
  }

  function readFileAsText(file, encoding) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsText(file, encoding);
    });
  }

  function exportCsv() {
    const list = getFiltered();
    const header = ['交易时间', '交易对方', '商品', '收/支', '金额', '状态', '分类', '来源', '是否退款'];
    const lines = [header.join(',')];
    for (const t of list) {
      lines.push(
        [
          t.time,
          t.merchant,
          t.goods,
          t.direction,
          t.amount.toFixed(2),
          t.status,
          effectiveCategory(t),
          t.format,
          t.isRefund ? '是' : '否',
        ]
          .map(csvEscape)
          .join(',')
      );
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `已分类账单_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function csvEscape(v) {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function clearAll() {
    transactions = [];
    $('app-main').classList.remove('visible');
    $('format-badge').textContent = '';
    $('file-input').value = '';
    clearError();
  }

  function resetOverrides() {
    overrides = {};
    saveOverrides();
    if (transactions.length) render();
  }

  // ---------- bind UI ----------
  function init() {
    const zone = $('dropzone');
    const input = $('file-input');

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) handleFile(input.files[0]);
    });

    $('filter-dir').addEventListener('change', render);
    $('filter-cat').addEventListener('change', render);
    $('include-refunds').addEventListener('change', render);
    $('btn-export').addEventListener('click', exportCsv);
    $('btn-reimport').addEventListener('click', () => input.click());
    $('btn-clear').addEventListener('click', clearAll);
    $('btn-reset-overrides').addEventListener('click', () => {
      if (confirm('清除所有手工改过的分类？（仅本机浏览器）')) resetOverrides();
    });

    // sample buttons
    document.querySelectorAll('[data-sample]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const path = btn.getAttribute('data-sample');
        try {
          const res = await fetch(path);
          if (!res.ok) throw new Error('无法加载样例（请用本地服务器打开页面，不要直接双击 file://）');
          const text = await res.text();
          const { format, rows } = parseBillText(text);
          onParsed(rows, format);
        } catch (err) {
          showError(err.message || String(err));
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
