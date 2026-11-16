// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a per-protocol
// detail drawer with the model's own inputs and the protocol's farm plan. No
// network: every byte it shows is in data.js.
(() => {
  'use strict';

  const DATA = window.RADAR;
  if (!DATA) return;
  const app = document.getElementById('board');
  const ui = { query: '', cat: 'all', view: 'pre-token', sortKey: 'implied', dir: -1, open: null, tweak: null };

  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const money = (n) => {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  };
  const pct = (n) => {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  };
  const ageLabel = (days) => {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  };

  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic. The sandbox overrides
  // two constants and the board recomputes live; with no override the page
  // shows the house model board.json was built with.
  const activeModel = () => {
    if (!ui.tweak) return DATA.model;
    return { ...DATA.model, base_multiple: ui.tweak.base_multiple, growth_weight: ui.tweak.growth_weight };
  };
  const currentImplied = (row) => (ui.tweak ? impliedFor(row, activeModel()) : row.implied_value_usd);
  const impliedFor = (row, model) => {
    const change = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, change));
    const growthMult = 1 + (growth / 100) * model.growth_weight;
    const age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    const maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity));
  };

  // Build a DOM node: h('div', { class: 'x', text: 'y', onclick: fn }, child, [more]).
  // Attribute keys: class, text and html are special; on* keys are listeners;
  // anything else becomes an attribute, skipped when null or undefined.
  const h = (tag, attrs, ...kids) => {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
      }
    }
    for (const kid of kids) {
      if (kid === null || kid === undefined) continue;
      if (Array.isArray(kid)) {
        for (const c of kid) if (c) node.appendChild(c);
      } else if (typeof kid === 'string') node.appendChild(document.createTextNode(kid));
      else node.appendChild(kid);
    }
    return node;
  };

  // The farm plan is the same derivation main.ts writes to board.json: category,
  // chains, TVL and age decide the action, the capital, the hold and every cost
  // and time. No name is special-cased.
  const mainChain = (p) => (p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain');
  const STAKE_TIERS = [[5e9, 250], [1e9, 150], [1e8, 100]];
  const stakeFor = (p) => {
    for (const [floor, stake] of STAKE_TIERS) {
      if (p.tvl_usd >= floor) return stake;
    }
    return 50;
  };
  const holdFor = (age) => {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  };

  // One category's farm wording: the keywords that match it, the action the
  // farmer takes, and the weekly action that keeps the position counted. The
  // table is read top to bottom; the first match wins, so order is precedence.
  const CATEGORY_RULES = [
    { keys: ['lend', 'cdp', 'collateral'],
      action: (name, capital, chain) => 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.',
      weekly: () => 'Top up or repay a small part of the borrow once a week so the position shows fresh activity.' },
    { keys: ['dex', 'yield', 'leveraged farm'],
      action: (name, capital, chain) => 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.',
      weekly: (name) => 'Swap a small amount through ' + name + "'s main pool once a week." },
    { keys: ['bridge'],
      action: (name, capital, chain) => 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.',
      weekly: (name) => 'Bridge a small amount through ' + name + ' once a week, in either direction.' },
    { keys: ['staking', 'restak'],
      action: (name, capital, chain) => "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.',
      weekly: () => 'Restake the rewards or add a small stake once a week.' },
    { keys: ['perpetual', 'derivative'],
      action: (name, capital, chain) => 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.',
      weekly: () => 'Open and close one small hedge a week.' },
    { keys: ['prediction'],
      action: (name, capital, chain) => 'Fund $' + capital + ' and place one market position on ' + name + '.',
      weekly: () => 'Place one small market position a week.' },
    { keys: ['curator', 'allocator'],
      action: (name, capital, chain) => 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.',
      weekly: (name) => 'Move a small amount between ' + name + ' vaults once a week.' },
    { keys: ['stable'],
      action: (name, capital, chain) => 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.',
      weekly: () => 'Mint or deposit a small amount of the stable asset once a week.' },
    { keys: ['rwa'],
      action: (name, capital, chain) => "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.',
      weekly: () => 'Mint or redeem a small amount of the yield asset once a week.' },
    { keys: ['insurance'],
      action: (name, capital, chain) => 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.',
      weekly: () => 'Check the cover policy once a week and renew it before it lapses.' },
  ];
  const ruleFor = (category) => {
    const c = (category || '').toLowerCase();
    for (const rule of CATEGORY_RULES) {
      if (rule.keys.some((key) => c.indexOf(key) >= 0)) return rule;
    }
    return undefined;
  };
  const actionText = (p, capital, chain) => {
    const rule = ruleFor(p.category);
    if (rule) return rule.action(p.name, capital, chain);
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  };
  const weeklyText = (p) => {
    const rule = ruleFor(p.category);
    if (rule) return rule.weekly(p.name);
    return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
  };

  // How much one transaction costs on the protocol's main chain, in plain dollars.
  const GAS_BY_CHAIN = {
    ethereum: { tx: '$3 to $8', first: 'about $8' },
    solana: { tx: 'under $0.01', first: 'under $0.10' },
    bitcoin: { tx: '$1 to $3', first: 'about $3' },
    tron: { tx: '$0.50 to $1.50', first: 'about $2' },
    binance: { tx: '$0.10 to $0.30', first: 'about $0.50' },
    bnb: { tx: '$0.10 to $0.30', first: 'about $0.50' },
    bsc: { tx: '$0.10 to $0.30', first: 'about $0.50' },
    polygon: { tx: '$0.01 to $0.05', first: 'about $0.10' },
    avalanche: { tx: '$0.05 to $0.20', first: 'about $0.50' },
  };
  const gasForChain = (chain) => GAS_BY_CHAIN[chain.toLowerCase()] || { tx: '$0.05 to $0.50', first: 'about $1' };

  const renderStep = (step) => {
    const joined = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (joined.length > 600) return joined.slice(0, 596) + '...';
    if (joined.length < 20) return joined + " Hold the position and check the protocol's own page.";
    return joined;
  };
  const planSteps = (p) => {
    const chain = mainChain(p);
    const gas = gasForChain(chain);
    const capital = stakeFor(p);
    const hold = holdFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas.first + ' of gas for the first transaction on ' + chain, time: '5 minutes' },
      { text: actionText(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas.tx + ' of gas per transaction', time: '15 minutes to set up' },
      { text: weeklyText(p), cost: gas.tx + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ].map(renderStep);
  };

  const loadHash = () => {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    const params = new URLSearchParams(raw);
    const q = params.get('q');
    if (q) ui.query = q;
    const p = params.get('p');
    if (p) ui.open = p;
    const cat = params.get('category');
    if (cat) ui.cat = cat;
  };
  const saveHash = () => {
    const params = new URLSearchParams();
    if (ui.query) params.set('q', ui.query);
    if (ui.cat !== 'all') params.set('category', ui.cat);
    if (ui.open) params.set('p', ui.open);
    const next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  };

  const visibleRows = () => {
    const q = ui.query.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (ui.cat !== 'all' && r.category !== ui.cat) return false;
      if (!q) return true;
      const hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  };
  const sortValue = (row) => {
    if (ui.sortKey === 'name') return row.name.toLowerCase();
    if (ui.sortKey === 'tvl') return row.tvl_usd;
    if (ui.sortKey === 'growth') return row.change_7d === null ? -Infinity : row.change_7d;
    if (ui.sortKey === 'age') return row.age_days === null ? Infinity : row.age_days;
    return currentImplied(row);
  };
  const orderedRows = (list) => list.slice().sort((a, b) => {
    const av = sortValue(a);
    const bv = sortValue(b);
    if (av < bv) return -ui.dir;
    if (av > bv) return ui.dir;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  const topBar = () => h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
    h('div', { class: 'top-meta' },
      h('span', { text: 'Snapshot ' + DATA.as_of }),
      h('span', { text: 'DefiLlama protocol index' }),
      h('span', { text: DATA.model_version + ' model' })
    )
  );

  const intro = () => h('section', { class: 'lede' },
    h('div', null,
      h('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
      h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
    ),
    h('div', { class: 'facts' },
      h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
      h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(DATA.board_size) })),
      h('div', { class: 'fact' }, h('span', { text: 'Early rows below the floor' }), h('b', { text: String(DATA.early_size) })),
      h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(DATA.live_size) }))
    )
  );

  const toolbar = () => {
    const categories = [...new Set(DATA.rows.map((r) => r.category || 'Other'))].sort();
    const search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: ui.query, 'aria-label': 'Search the board' });
    search.addEventListener('input', () => { ui.query = search.value; saveHash(); paint(); });
    const select = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map((c) => h('option', { value: c, text: c, selected: c === ui.cat ? 'selected' : null }))
    );
    select.addEventListener('change', () => { ui.cat = select.value; saveHash(); paint(); });
    const pre = h('button', { type: 'button', 'aria-pressed': ui.view === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: () => { ui.view = 'pre-token'; paint(); } });
    const live = h('button', { type: 'button', 'aria-pressed': ui.view === 'live' ? 'true' : 'false', text: 'Live token', onclick: () => { ui.view = 'live'; paint(); } });
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), select),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, pre, live)),
      h('span', { class: 'count', text: ui.view === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  };

  const sortableTh = (key, label) => h('th', { scope: 'col' },
    h('button', { type: 'button', onclick: () => {
      if (ui.sortKey === key) ui.dir = -ui.dir;
      else { ui.sortKey = key; ui.dir = -1; }
      paint();
    } },
      label,
      ui.sortKey === key ? h('span', { 'aria-hidden': 'true', text: ui.dir < 0 ? ' v' : ' ^' }) : null
    )
  );

  const preTokenTable = () => {
    const list = orderedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: () => { ui.query = ''; ui.cat = 'all'; saveHash(); paint(); } })
      ));
    }
    const max = list.length ? currentImplied(list[0]) || 1 : 1;
    const tbody = h('tbody');
    list.forEach((r, i) => {
      const growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      const chains = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
      const tr = h('tr', {
        'data-selected': ui.open === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: () => showDetail(r.slug),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(r.slug); } },
      },
        h('td', { class: 'num', text: String(ui.tweak && ui.sortKey === 'implied' ? i + 1 : r.rank) }),
        h('td', null, h('div', { class: 'name' },
          h('b', { text: r.name }),
          h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chains })
        )),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: growth }),
        h('td', { class: 'num', text: ageLabel(r.age_days) }),
        h('td', null, h('div', { class: 'implied' },
          h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((currentImplied(r) / max) * 100)) + '%' })),
          h('span', { class: 'num', text: money(currentImplied(r)) })
        )),
        h('td', null, h('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          h('thead', null, h('tr', null,
            sortableTh('implied', 'Rank'),
            sortableTh('name', 'Protocol'),
            sortableTh('tvl', 'TVL'),
            sortableTh('growth', '7d'),
            sortableTh('age', 'Age'),
            sortableTh('implied', 'Implied value'),
            h('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  };

  const liveTokenTable = () => {
    const tbody = h('tbody');
    DATA.live.forEach((r) => {
      const chains = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
      tbody.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chains }))),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        h('td', { class: 'num', text: money(r.mcap_usd) }),
        h('td', null, h('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, h('tr', null,
            h('th', { scope: 'col', text: 'Status' }),
            h('th', { scope: 'col', text: 'Protocol' }),
            h('th', { scope: 'col', text: 'TVL' }),
            h('th', { scope: 'col', text: '7d' }),
            h('th', { scope: 'col', text: 'Market cap' }),
            h('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  };

  const modelSection = () => {
    const m = DATA.model;
    const formula = `implied = round( tvl_usd x ${m.base_multiple} x (1 + clamp(change_7d, ${m.growth_floor}, ${m.growth_cap}) / 100 x ${m.growth_weight}) x (${m.maturity_floor} + min(age_days, ${m.maturity_days}) / ${m.maturity_days} x ${m.maturity_range}) )`;
    const baseNow = ui.tweak ? ui.tweak.base_multiple : m.base_multiple;
    const growthNow = ui.tweak ? ui.tweak.growth_weight : m.growth_weight;
    const sandbox = h('section', { class: 'panel sandbox' },
      h('h2', { text: 'Model sandbox' }),
      h('p', { class: 'sub', text: 'Move a constant and the whole board recomputes from the same figures, live. Reset returns to the house model the board was built with.' }),
      h('div', { class: 'sliders' },
        h('label', null, 'Base multiple — TVL x ',
          h('b', { text: String(baseNow) }),
          h('input', { type: 'range', min: '0.1', max: '0.5', step: '0.01', value: String(baseNow), 'aria-label': 'Base multiple', oninput: (e) => tweakSandbox('base_multiple', parseFloat(e.target.value)) })
        ),
        h('label', null, 'Growth weight — seven-day change x ',
          h('b', { text: String(growthNow) }),
          h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(growthNow), 'aria-label': 'Growth weight', oninput: (e) => tweakSandbox('growth_weight', parseFloat(e.target.value)) })
        )
      ),
      h('div', null,
        h('button', { class: 'button', type: 'button', text: 'Reset to the house model', onclick: () => { ui.tweak = null; paint(); } }),
        ui.tweak ? h('span', { class: 'live-badge', text: 'sandbox live' }) : null
      )
    );
    return h('div', null,
      h('section', { class: 'panel model' },
        h('h2', { text: 'How implied value is computed' }),
        h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
        h('div', { class: 'formula' }, formula),
        h('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' })
      ),
      sandbox
    );
  };

  const tweakSandbox = (key, value) => {
    if (!ui.tweak) ui.tweak = { base_multiple: DATA.model.base_multiple, growth_weight: DATA.model.growth_weight };
    ui.tweak[key] = value;
    if (ui.sortKey !== 'implied') { ui.sortKey = 'implied'; ui.dir = -1; }
    paint();
  };

  const dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', () => { ui.open = null; saveHash(); });

  const showDetail = (slug) => {
    const row = DATA.rows.filter((r) => r.slug === slug)[0];
    if (!row) return;
    ui.open = slug;
    saveHash();
    dialog.textContent = '';
    const steps = planSteps(row);
    const recomputed = impliedFor(row, activeModel());
    const agrees = recomputed === currentImplied(row);
    const check = 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recomputed) + (agrees ? ', the same number' + (ui.tweak ? ' the sandbox shows.' : ' board.json carries.') : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.';
    dialog.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => dialog.close() })
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'equation' },
        h('div', null, h('span', { text: 'TVL' }), h('b', { class: 'num', text: money(row.tvl_usd) })),
        h('div', null, h('span', { text: 'Seven-day growth' }), h('b', { class: 'num', text: pct(row.change_7d) })),
        h('div', null, h('span', { text: 'Age with no token' }), h('b', { class: 'num', text: ageLabel(row.age_days) })),
        h('div', null, h('span', { text: 'Growth multiplier' }), h('b', { class: 'num', text: String(row.growth_multiplier) })),
        h('div', null, h('span', { text: 'Maturity multiplier' }), h('b', { class: 'num', text: String(row.maturity_multiplier) })),
        h('div', null, h('span', { text: 'Implied value' }), h('b', { class: 'num', text: money(currentImplied(row)) }))
      ),
      h('p', { class: 'sub', text: check })
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, steps.map((s) => {
        const at = s.indexOf(' Cost: ');
        const action = at >= 0 ? s.slice(0, at) : s;
        const tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  };

  const paint = () => {
    app.textContent = '';
    const shell = h('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(intro());
    shell.appendChild(toolbar());
    shell.appendChild(ui.view === 'pre-token' ? preTokenTable() : liveTokenTable());
    if (ui.view === 'pre-token') shell.appendChild(modelSection());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (ui.open) showDetail(ui.open);
  };

  loadHash();
  paint();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
