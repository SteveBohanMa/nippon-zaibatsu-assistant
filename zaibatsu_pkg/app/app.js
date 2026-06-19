/* =============================================================================
 *  app.js  —  对局助手 UI 控制器
 *  连接 config.js / engine.js，实现三步向导 + 双栏对局界面 + 求解。
 * ========================================================================== */
(function () {
  'use strict';
  const CFG = window.ZAIBATSU_CONFIG;
  const ENG = window.ZAIBATSU_ENGINE;
  const $ = (s) => document.querySelector(s);
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

  const WK_HEX = { black:'#2b2f38', red:'#c0392b', grey:'#8a93a3', blue:'#2e6fb0', white:'#e8e4d8', yellow:'#d9b54a' };
  const WK_CN  = { black:'黑',red:'红',grey:'灰',blue:'蓝',white:'白',yellow:'黄' };
  const ACT_ICON = { rnd:'⚗', mining:'⛏', factory:'🏭', machine:'⚙', produce:'📦', ship:'⛵', train:'🚂', localMarket:'⛩', invest:'💰' };
  const FACTORY_HEX = { cotton:'#c79a4b', paper:'#b9b09a', bento:'#8a4a3a', lenses:'#8a3030', bulbs:'#d9b54a', clocks:'#5a6a7a' };
  const CONTRACT_ICON = { black:'⚙', red:'⛏', grey:'🚂', blue:'💰', white:'⚗', yellow:'⛩', any:'★' };

  /* ---------------- 全局状态 ---------------- */
  let setup = { playerCount: null, myPosition: 1, preference: null };
  let game = null;             // GameState
  let curTab = 0;              // 当前查看的玩家 tab
  let undoStack = [];
  let highlights = { fields: [], regions: [] };
  let selRegion = null;        // 当前在海图上选中的地区索引
  let wizardStep = 1;

  /* ============================================================
   *  起始向导
   * ============================================================ */
  function renderWizard() {
    const body = $('#wizardBody');
    $('#stepsNav').querySelectorAll('div').forEach(d => d.classList.toggle('on', +d.dataset.s === wizardStep));
    $('#wzBack').disabled = wizardStep === 1;
    $('#wzNext').textContent = wizardStep === 3 ? '开始对局 ⚑' : '下一步 →';

    if (wizardStep === 1) {
      body.innerHTML = '';
      body.appendChild(el('label', 'fld', '人数'));
      const pc = el('div', 'optgrid c3'); body.appendChild(pc);
      [2, 3, 4].forEach(n => {
        const card = el('button', 'optcard' + (setup.playerCount === n ? ' sel' : ''),
          `<b>${n} 人局</b><small>入袋工人 ${CFG.PLAYER_COUNT_CFG[n].workerBag}・工人列 ${CFG.PLAYER_COUNT_CFG[n].queueRows.length} 行・市场 ${CFG.PLAYER_COUNT_CFG[n].influenceSlots} 格・船位 ${CFG.PLAYER_COUNT_CFG[n].shipSpaces}・火车位 ${CFG.PLAYER_COUNT_CFG[n].trainSpaces}</small>`);
        card.onclick = () => { setup.playerCount = n; renderWizard(); };
        pc.appendChild(card);
      });

      const row = el('div', 'field-row'); row.style.marginTop = '20px'; body.appendChild(row);
      const posWrap = el('div'); posWrap.appendChild(el('label', 'fld', '我的位次（首家右侧起逆顺位选起始标记）'));
      const posSel = el('select');
      const maxP = setup.playerCount || 4;
      for (let i = 1; i <= maxP; i++) posSel.appendChild(new Option(i + ' 号位', i, false, setup.myPosition === i));
      posSel.value = setup.myPosition; posSel.onchange = e => setup.myPosition = +e.target.value;
      posWrap.appendChild(posSel); row.appendChild(posWrap);

      body.appendChild(el('label', 'fld', '决策偏好（调评估权重 §5.3）'));
      const pref = el('div', 'optgrid c3'); body.appendChild(pref);
      [['winRate', '稳健胜率', '抬当前分/影响力权重，压方差'],
       ['maxScore', '期望分数最大化', '抬三轨/引擎/个人目标权重，搏高分'],
       ['balanced', '平衡', '均衡评估，默认推荐']].forEach(([k, t, d]) => {
        const card = el('button', 'optcard' + (setup.preference === k ? ' sel' : ''), `<b>${t}</b><small>${d}</small>`);
        card.onclick = () => { setup.preference = k; renderWizard(); };
        pref.appendChild(card);
      });

      // —— 扩展模组（严格遵照规则书 setup 4b / solo p.20-23）——
      body.appendChild(el('label', 'fld', '扩展模组（规则书）'));
      const mods = el('div', 'optgrid c2');
      setup.modules = setup.modules || { lateFactories: false, solo: false };
      const lateCard = el('button', 'optcard' + (setup.modules.lateFactories ? ' sel' : ''),
        `<b>后期工厂模组</b><small>加入编号5工厂：2/3/4 人加 3/4/5 张（setup 4b）。可在工厂池用「编号5」加入</small>`);
      lateCard.onclick = () => { setup.modules.lateFactories = !setup.modules.lateFactories; renderWizard(); };
      mods.appendChild(lateCard);
      const soloCard = el('button', 'optcard' + (setup.modules.solo ? ' sel' : ''),
        `<b>单人模式 (Automa)</b><small>2 人局规则，对手为 Automa：仅执行火车/本地市场。难度=Solo目标数 1/2/3</small>`);
      soloCard.onclick = () => {
        setup.modules.solo = !setup.modules.solo;
        if (setup.modules.solo) { setup.playerCount = 2; setup.myPosition = 1; }
        renderWizard();
      };
      mods.appendChild(soloCard);
      body.appendChild(mods);
    }

    if (wizardStep === 2) {
      body.innerHTML =
        '<div class="note">先选择一对起始标记（图见下），系统会按规则书将右侧分数计入起始分；再用下方步进器补录 B 标记的资源/钱/轨道加成。</div>';
      const sp = setup._myInit = setup._myInit || { vp: 0, money: 0, coal: 0, silk: 0, iron: 0, goods: 0, rnd: 0, mining: 0, finance: 0, ships: 6, machines: 6, trains: 6 };

      body.appendChild(el('label', 'fld', '起始标记 A（点选 → 自动计入起始分）'));
      const tg = el('div', 'token-grid');
      const TOKEN_ICON = { machineForFirstFactory: '⚙', buildShip: '⛵', buildTrain: '🚂', oldFactory: '🏭', takeWorker: '👤' };
      CFG.STARTING_TOKENS_A.forEach((tk) => {
        const card = el('div', 'token-card' + (setup._startToken === tk.id ? ' sel' : ''));
        const a = el('div', 'token-a');
        a.appendChild(el('div', 'ic', TOKEN_ICON[tk.effect] || '◆'));
        const val = el('div', 'val', String(tk.startVP)); a.appendChild(val);
        card.appendChild(a);
        const bcard = el('div', 'token-b');
        bcard.appendChild(el('small', null, tk.cn));
        card.appendChild(bcard);
        card.onclick = () => { setup._startToken = tk.id; sp.vp = tk.startVP; renderWizard(); };
        tg.appendChild(card);
      });
      body.appendChild(tg);

      const lbl2 = el('label', 'fld', '其余初始数值（起始分已由标记 A 自动填入「当前分」）');
      lbl2.style.marginTop = '18px';
      body.appendChild(lbl2);
      const grid = el('div'); grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px 22px;margin-top:8px'; body.appendChild(grid);
      const fields = [['vp','当前分'],['money','钱'],['coal','煤'],['silk','丝'],['iron','铁'],['goods','货物'],
                      ['rnd','研发轨'],['mining','采矿轨'],['finance','金融轨'],
                      ['ships','船(剩余)'],['machines','设备(剩余)'],['trains','火车(剩余)']];
      fields.forEach(([k, label]) => {
        const w = el('div'); w.appendChild(el('label', 'fld', label));
        w.appendChild(mkStepper(sp[k], v => sp[k] = v, 0, 30));
        grid.appendChild(w);
      });
      body.appendChild(el('div', 'note',
        '✓ 已按官方规则书/玩家手册载入：影响力名次分（10/8/6/2 → 18/14/10/3 → 26/20/14/4）、' +
        '影响力标记面值(1–7)、岩仓 6 目的地、6 类工厂等级与 60 张效果、部门奖励、8 张契约。' +
        '地区海外公司值与需求板朝向因图版而异，可在对局中据实微调。'));
    }

    if (wizardStep === 3) {
      const okPc = !!setup.playerCount, okPref = !!setup.preference;
      body.innerHTML =
        `<div style="text-align:center;padding:14px 0">
          <div class="seal" style="width:64px;height:64px;font-size:36px;margin:0 auto 18px">財</div>
          <h2 style="font-size:20px;margin-bottom:8px">准备就绪</h2>
          <p style="color:var(--muted);max-width:440px;margin:0 auto;line-height:1.6">
            ${okPc ? setup.playerCount + ' 人局' : '<span style="color:var(--danger)">未选人数</span>'}・
            我为 ${setup.myPosition} 号位・
            偏好「${okPref ? prefCN(setup.preference) : '<span style="color:var(--danger)">未选</span>'}」。<br>
            进入对局后，按「记录对手回合」逐位录入，轮到我时点「求最优解」。
          </p>
        </div>`;
    }
  }

  function prefCN(k){return {winRate:'稳健胜率',maxScore:'期望分数最大化',balanced:'平衡'}[k]||k;}

  function mkStepper(val, onChange, min, max) {
    const s = el('span', 'stepper');
    const dec = el('button', null, '−'), valSpan = el('span', 'val', String(val)), inc = el('button', null, '+');
    const clamp = v => Math.max(min ?? -99, Math.min(max ?? 999, v));
    dec.onclick = () => { val = clamp(val - 1); valSpan.textContent = val; s.classList.toggle('hot', val !== 0); onChange(val); };
    inc.onclick = () => { val = clamp(val + 1); valSpan.textContent = val; s.classList.toggle('hot', val !== 0); onChange(val); };
    if (val !== 0) s.classList.add('hot');
    s.append(dec, valSpan, inc);
    return s;
  }

  $('#wzBack').onclick = () => { if (wizardStep > 1) { wizardStep--; renderWizard(); } };
  $('#wzNext').onclick = () => {
    if (wizardStep === 1) {
      if (!setup.playerCount) return toast('请先选择人数');
      if (!setup.preference) return toast('请选择决策偏好');
    }
    if (wizardStep < 3) { wizardStep++; renderWizard(); return; }
    startGame();
  };

  /* ============================================================
   *  开始对局 — 构造 GameState
   * ============================================================ */
  function startGame() {
    if (!setup.playerCount || !setup.preference) { toast('设置不完整'); wizardStep = 1; return renderWizard(); }
    game = ENG.createInitialState(setup);
    const m = ENG.me(game), init = setup._myInit;
    if (init) {
      m.money = init.money; m.goods = init.goods; m.vp = init.vp || 0;
      m.resources = { coal: init.coal, silk: init.silk, iron: init.iron };
      m.tracks = { rnd: init.rnd, mining: init.mining, finance: init.finance };
      m.ships = init.ships; m.machines = init.machines; m.trains = init.trains;
    }
    // 8 张契约对所有玩家固定一致（卡片化展示，§图3）
    game.players.forEach(pl => { pl.contracts = CFG.CONTRACTS.map(c => ({ id: c.id, fulfilled: false })); });
    // 记录扩展模组
    game.meta.modules = setup.modules || { lateFactories: false, solo: false };
    if (game.meta.modules.solo) game.meta.solo = true;
    // 地区沿用引擎按规则书初始化的对象（含 overseas / rivals / myTrains）；
    // 这里仅赋予日本本土地区名（图版地理分区，便于对照）。
    const REGION_CN = ['关东', '近畿', '中部', '九州', '东北', '中国·四国'];
    game.regions.forEach((rg, i) => { rg.cn = REGION_CN[i] || rg.cn; });
    // 雇用区占位（行动条 9 行动）—— 实际由用户在海图上点选录入
    game.hiringArea = CFG.ACTION_LIST.map(a => ({ actionType: a, workers: [] }));
    // 可用工厂池：每类型 A1（规则书 setup 4a）；若开后期模组，追加各类型 编号5
    game.availableFactories = ENG._internal.defaultFactoryPool();
    if (game.meta.modules.lateFactories) {
      Object.keys(CFG.FACTORY_META).forEach(k => game.availableFactories.push({ key: k, side: 'A', n: 5 }));
    }

    curTab = game.meta.myPlayerIndex;
    undoStack = [];
    $('#setup').style.display = 'none';
    $('#game').classList.add('show');
    $('#bottombar').style.display = 'flex';
    renderAll();
  }

  /* ============================================================
   *  渲染：题头 / 地图 / 玩家板
   * ============================================================ */
  function renderAll() { renderTop(); renderMap(); renderTabs(); renderPlayerBody(); renderTurnInd(); }

  function renderTop() {
    if (!game) { $('#topMeta').innerHTML = ''; return; }
    const M = game.meta;
    $('#topMeta').innerHTML =
      `<span class="chip">时期 <b>${M.period}/3</b></span>
       <span class="chip">第 <b>${M.roundIndex}</b> 轮</span>
       <span class="chip">${M.playerCount} 人</span>
       <span class="chip">偏好 <b>${prefCN(M.preference)}</b></span>
       ${M.isFinalRound ? '<span class="chip" style="border-color:var(--vermilion);color:var(--vermilion)">最终轮</span>' : ''}`;
  }

  function renderMap() {
    const b = $('#mapBody'); b.innerHTML = '';

    // —— 时期/轮 控制 ——
    const ctrl = section('对局进程');
    const cr = el('div'); cr.style.cssText = 'display:flex;gap:18px;flex-wrap:wrap;align-items:center';
    cr.appendChild(stat('时期', mkStepper(game.meta.period, v => { game.meta.period = Math.max(1, Math.min(3, v)); renderTop(); renderMap(); }, 1, 3)));
    cr.appendChild(stat('轮次', mkStepper(game.meta.roundIndex, v => { game.meta.roundIndex = Math.max(1, v); renderTop(); }, 1, 12)));
    const fr = el('button', 'btn sm' + (game.meta.isFinalRound ? ' primary' : ' ghost'), '最终轮');
    fr.onclick = () => { pushUndo(); game.meta.isFinalRound = !game.meta.isFinalRound; renderTop(); renderMap(); };
    cr.appendChild(fr);
    ctrl.appendChild(cr); b.appendChild(ctrl);

    // ============ 海图视图（忠实盘面布局，image2）============
    const chartSec = section('主图版 · 海图（点击地区/目的地编辑；点击工人格填色）');
    const chart = el('div', 'chart');
    chart.appendChild(el('div', 'land'));

    // —— 顶部：工人列 + 雇用区/行动条（覆盖在海图顶部，呼应 3b/3c/行动条）——
    const topstrip = el('div', 'chart-topstrip');

    // 工人列候补（左上 3c）
    const queueBox = el('div', 'chart-queue');
    queueBox.appendChild(el('div', 'qttl', '工人列'));
    const rows = CFG.PLAYER_COUNT_CFG[game.meta.playerCount].queueRows;
    rows.forEach(r => {
      const row = el('div', 'queue-row'); row.style.marginBottom = '3px';
      const wk = el('div', 'workers');
      const arr = game.workerQueue[r];
      for (let i = 0; i < 3; i++) {
        const w = arr[i];
        const d = el('div', 'wk' + (w ? '' : ' empty')); d.style.cssText = 'width:15px;height:15px;border-radius:50%';
        if (w) d.style.background = WK_HEX[w];
        d.onclick = () => { pushUndo(); arr[i] = nextColor(w); renderMap(); };
        wk.appendChild(d);
      }
      row.appendChild(wk); queueBox.appendChild(row);
    });
    topstrip.appendChild(queueBox);

    // 雇用区/行动条（3b + 行动条）
    const hireBox = el('div', 'chart-hiring');
    hireBox.appendChild(el('div', 'hh', '雇用区 · 行动条（上方工人槛 / 下方行动）'));
    const hg = el('div', 'hiring-strip');
    game.hiringArea.forEach((cell) => {
      const c = el('div', 'hire-cell2'); c.style.width = '92px';
      const wkRow = el('div', 'wk-row');
      for (let i = 0; i < 3; i++) {
        const w = cell.workers[i];
        const d = el('div', 'wk' + (w ? '' : ' empty')); d.style.cssText = 'width:15px;height:15px;border-radius:50%';
        if (w) d.style.background = WK_HEX[w];
        d.title = w ? WK_CN[w] : '点选填色';
        d.onclick = () => cycleWorker(cell, i);
        wkRow.appendChild(d);
      }
      c.appendChild(wkRow);
      const tile = el('div', 'act-tile act-' + cell.actionType); tile.style.minHeight = '44px';
      tile.appendChild(el('div', 'ic', ACT_ICON[cell.actionType] || '◆'));
      tile.appendChild(el('div', 'nm', CFG.ACTION_CN[cell.actionType] || cell.actionType));
      c.appendChild(tile);
      hg.appendChild(c);
    });
    hireBox.appendChild(hg);
    topstrip.appendChild(hireBox);
    chart.appendChild(topstrip);

    // —— 6 个市场（菱形）按盘面分布定位（百分比坐标，呼应 image2 散布）——
    // 坐标参照盘面：本州沿线斜向分布，海外公司丸数字置于地区旁。
    const POS = [
      { x: 24, y: 56, ox: 33, oy: 64 },  // r1 西南
      { x: 40, y: 50, ox: 49, oy: 60 },  // r2
      { x: 50, y: 70, ox: 50, oy: 78 },  // r3 南
      { x: 62, y: 46, ox: 71, oy: 52 },  // r4
      { x: 70, y: 64, ox: 60, oy: 72 },  // r5
      { x: 80, y: 40, ox: 88, oy: 46 },  // r6 东北
    ];
    const QUAD = ['#c0392b', '#46a07a', '#2e6fb0', '#d9b54a'];
    game.regions.forEach((rg, ri) => {
      const pos = POS[ri] || { x: 50, y: 50, ox: 56, oy: 56 };
      const node = el('div', 'chart-region' + (selRegion === ri ? ' sel' : (highlights.regions.includes(ri) ? ' sel' : '')));
      node.style.left = pos.x + '%'; node.style.top = pos.y + '%';
      const dia = el('div', 'dia');
      [0, 1, 2, 3].forEach(qi => { const qd = el('div', 'quad q' + (qi + 1)); qd.style.background = QUAD[(qi + ri) % 4]; dia.appendChild(qd); });
      // 中心显示需求板两类货物的简称（呼应海图地区瓦片上的货物图标）
      const dm = rg.demand || {};
      const gA = dm.flipped ? dm.goodsB : dm.goodsA, gB = dm.flipped ? dm.goodsA : dm.goodsB;
      dia.appendChild(el('div', 'gx', (CFG.GOODS_CN[gA] || '') + '\n' + (CFG.GOODS_CN[gB] || '')));
      node.appendChild(dia);
      const myTotal = (rg.myInfluence || 0) + (rg.myInfluence > 0 ? (rg.myTrains || 0) * 2 : 0);
      const lbl = el('div', 'rlabel'); lbl.innerHTML = `${rg.cn} · 我 <b>${myTotal}</b>`;
      node.appendChild(lbl);
      node.onclick = () => { selRegion = (selRegion === ri ? null : ri); renderMap(); };
      chart.appendChild(node);

      // 海外公司丸数字
      if (rg.overseas > 0) {
        const ov = el('div', 'chart-overseas'); ov.style.left = pos.ox + '%'; ov.style.top = pos.oy + '%';
        ov.textContent = rg.overseas; ov.title = rg.cn + ' 海外公司影响力';
        chart.appendChild(ov);
      }
    });

    // —— 岩仓使节团（海图右下角覆盖层，呼应 2a/2b）——
    const iwBox = el('div', 'chart-iwakura');
    const table = el('div', 'iwakura-table');
    table.appendChild(el('div', 'iwakura-title', 'IWAKURA MISSION'));
    const igrid = el('div', 'iwakura-grid');
    const colPairs = [[0, 3], [1, 4], [2, 5]];
    colPairs.forEach(([li, rih]) => {
      [li, rih].forEach((idx) => {
        const d = (game.destinations || [])[idx]; if (!d) { igrid.appendChild(el('div')); return; }
        const cell = el('div', 'iwakura-cell' + (d.expertAvailable ? '' : ' taken'));
        const head = el('div', 'iw-head');
        head.appendChild(el('span', 'iw-name', d.cn));
        const sw = el('div', 'iw-swatches');
        const s1 = el('div'); s1.className = 'iw-swatch'; s1.style.background = WK_HEX[d.expert]; s1.title = WK_CN[d.expert] + ' 专家';
        const s2 = el('div'); s2.className = 'iw-swatch'; s2.style.background = WK_HEX[d.dept]; s2.title = WK_CN[d.dept] + ' 部门';
        sw.append(s1, s2); head.appendChild(sw);
        cell.appendChild(head);
        cell.appendChild(el('div', 'iw-state', d.expertAvailable ? '可取·船' + (d.ships || 0) : '已取走'));
        cell.onclick = () => { pushUndo(); d.expertAvailable = !d.expertAvailable; renderMap(); };
        igrid.appendChild(cell);
      });
    });
    table.appendChild(igrid);
    iwBox.appendChild(table);
    chart.appendChild(iwBox);

    chartSec.appendChild(chart);
    b.appendChild(chartSec);

    // —— 选中地区的编辑面板（需求板自定义 + 影响力名次录入）——
    if (selRegion != null && game.regions[selRegion]) {
      b.appendChild(renderRegionEditor(game.regions[selRegion], selRegion));
    } else {
      b.appendChild(el('div', 'note', '点击海图上的任一菱形市场，可在此自定义其需求板（接受的货物种类/朝向）、海外公司值，并录入我方与各对手的影响力以计算名次分。'));
    }

    // —— 工厂池 ——
    const pool = section('工厂池（可建工厂 · A/B 面 · 编号）');
    const pl = el('div', 'pool-strip');
    game.availableFactories.forEach((ft, fi) => {
      const meta = CFG.FACTORY_META[ft.key];
      const t = el('button', 'pill'); t.style.cssText = 'padding:5px 9px;font-size:11px';
      t.textContent = `${meta.cn}${ft.n}${ft.side}·L${meta.level}`;
      t.title = '点击移除（已被建造/不在池中）';
      t.onclick = () => { pushUndo(); game.availableFactories.splice(fi, 1); renderMap(); };
      pl.appendChild(t);
    });
    pool.appendChild(pl);
    const addF = el('div', 'add-row');
    const selKey = el('select'); Object.entries(CFG.FACTORY_META).forEach(([k, v]) => selKey.appendChild(new Option(v.cn + '·L' + v.level, k)));
    const selSide = el('select'); ['A', 'B'].forEach(s => selSide.appendChild(new Option(s + ' 面', s)));
    const selN = el('select'); [1, 2, 3, 4, 5].forEach(n => selN.appendChild(new Option('编号' + n, n)));
    const addBtn = el('button', 'btn sm', '+ 入池');
    addBtn.onclick = () => { pushUndo(); game.availableFactories.push({ key: selKey.value, side: selSide.value, n: +selN.value }); renderMap(); };
    addF.append(selKey, selSide, selN, addBtn); pool.appendChild(addF);
    b.appendChild(pool);
  }

  // —— 地区编辑面板：自定义需求板 + 影响力名次录入 ——
  function renderRegionEditor(rg, ri) {
    const box = el('div', 'region-editor');
    box.appendChild(el('h4', null, '✦ ' + rg.cn + ' · 市场编辑'));
    const dm = rg.demand || (rg.demand = { goodsA: 'cotton', goodsB: 'paper', flipped: false });
    const gA = dm.flipped ? dm.goodsB : dm.goodsA, gB = dm.flipped ? dm.goodsA : dm.goodsB;
    box.appendChild(el('div', 'meta-line',
      `需求板：当前正面接受 ${CFG.GOODS_CN[gA]}(L${CFG.GOODS_LEVEL[gA]}) / ${CFG.GOODS_CN[gB]}(L${CFG.GOODS_LEVEL[gB]})。影响力面值由货物等级与花费数量决定（L1:1/2/3，L2:3/4/5，L3:5/6/7）。`));

    // 需求板两类货物选择 + 朝向翻转
    const drow = el('div', 'demand-row');
    const mkGoodsChip = (which) => {
      const cur = dm[which];
      const chip = el('div', 'demand-chip');
      const sw = el('span', 'goods-sw'); sw.style.background = FACTORY_HEX[cur]; chip.appendChild(sw);
      chip.appendChild(el('span', null, CFG.GOODS_CN[cur]));
      chip.appendChild(el('span', 'lv', 'L' + CFG.GOODS_LEVEL[cur]));
      chip.title = '点击切换货物种类';
      chip.onclick = () => {
        pushUndo();
        const order = CFG.GOODS_TYPES; const idx = order.indexOf(cur);
        dm[which] = order[(idx + 1) % order.length];
        renderMap();
      };
      return chip;
    };
    drow.appendChild(el('span', 'fld', '需求货物：'));
    drow.appendChild(mkGoodsChip('goodsA'));
    drow.appendChild(el('span', null, '/'));
    drow.appendChild(mkGoodsChip('goodsB'));
    const flip = el('button', 'btn sm ghost', '翻转朝向 ⇄');
    flip.onclick = () => { pushUndo(); dm.flipped = !dm.flipped; renderMap(); };
    drow.appendChild(flip);
    box.appendChild(drow);

    // 市场 4 影响力格示意（哪格被谁占）
    const slots = CFG.PLAYER_COUNT_CFG[game.meta.playerCount].influenceSlots;
    const ms = el('div', 'market-spaces');
    rg.market = rg.market || [];
    for (let i = 0; i < slots; i++) {
      const occ = rg.market[i];
      const sp = el('div', 'mk-space' + (occ === 'me' ? ' mine' : occ === 'rival' ? ' rival' : ''));
      sp.appendChild(el('div', 'who', occ === 'me' ? '我' : occ === 'rival' ? '对手' : '空'));
      sp.appendChild(el('div', 'val', occ ? (rg.marketVal && rg.marketVal[i] ? rg.marketVal[i] : '·') : '·'));
      sp.title = '点击循环：空→我→对手→空';
      sp.onclick = () => {
        pushUndo();
        const next = { undefined: 'me', me: 'rival', rival: undefined };
        rg.market[i] = next[occ];
        renderMap();
      };
      ms.appendChild(sp);
    }
    box.appendChild(el('label', 'fld', `本地市场 ${slots} 格（点选占用方，示意用）`));
    box.appendChild(ms);

    // 影响力名次录入网格
    const grid = el('div', 'rg-grid');
    const mk = (label, val, setter, max) => {
      const c = el('span'); c.appendChild(el('label', 'fld', label));
      c.appendChild(mkStepper(val, v => { setter(v); renderMap(); }, 0, max || 14)); return c;
    };
    grid.appendChild(mk('我影响力', rg.myInfluence || 0, v => rg.myInfluence = v, 21));
    grid.appendChild(mk('我火车', rg.myTrains || 0, v => rg.myTrains = v, 7));
    grid.appendChild(mk('海外公司', rg.overseas || 0, v => rg.overseas = v, 12));
    (rg.rivals || []).forEach((rv, ki) => grid.appendChild(mk('对手' + (ki + 1), rv, v => rg.rivals[ki] = v, 21)));
    box.appendChild(grid);

    // 名次提示
    const myTotal = (rg.myInfluence || 0) + (rg.myInfluence > 0 ? (rg.myTrains || 0) * 2 : 0);
    const parts = [myTotal].concat((rg.rivals || []).filter(x => x > 0));
    if (rg.overseas) parts.push(rg.overseas);
    const myRank = (rg.myInfluence > 0) ? parts.filter(v => v > myTotal).length + 1 : '—';
    const ps = CFG.PERIOD_SCORING[Math.min(3, game.meta.period)] || [];
    box.appendChild(el('div', 'meta-line',
      `我方合计影响力 ${myTotal}（含火车×2）→ 当前名次 ${myRank}；本时期名次分 ${ps.join('/')}。`));
    return box;
  }

  function section(title) { const s = el('div', 'board-section'); s.appendChild(el('h4', null, title)); return s; }
  function stat(k, control) { const w = el('div'); w.appendChild(el('label', 'fld', k)); w.appendChild(control); return w; }

  function cycleWorker(cell, i) { pushUndo(); cell.workers[i] = nextColor(cell.workers[i]); renderMap(); }
  function nextColor(c) {
    const order = [null, ...CFG.WORKER_COLORS];
    const idx = order.indexOf(c ?? null);
    return order[(idx + 1) % order.length];
  }

  /* ---------------- 玩家板 ---------------- */
  function renderTabs() {
    const t = $('#playerTabs'); t.innerHTML = '';
    game.players.forEach((p, i) => {
      const isMe = i === game.meta.myPlayerIndex;
      const tab = el('button', 'tab' + (i === curTab ? ' on' : '') + (isMe ? ' me' : ''),
        `<span class="dot" style="background:${p.color}"></span>${p.name}`);
      tab.onclick = () => { curTab = i; renderTabs(); renderPlayerBody(); };
      t.appendChild(tab);
    });
  }

  function renderPlayerBody() {
    const b = $('#playerBody'); b.innerHTML = '';
    const p = game.players[curTab];
    const isMe = curTab === game.meta.myPlayerIndex;

    // 资源 / 钱 / 分
    b.appendChild(el('div', 'subhead', '资源 · 钱 · 分'));
    const sg = el('div', 'stat-grid');
    const numFields = [
      ['money', '钱'], ['vp', '当前分'], ['goods', '货物'],
      ['coal', '煤'], ['silk', '丝'], ['iron', '铁'],
    ];
    numFields.forEach(([k, label]) => {
      const cur = (k in p.resources) ? p.resources[k] : p[k];
      const st = el('div', 'stat' + (highlights.fields.includes(k) ? ' hl' : ''));
      st.appendChild(el('span', 'k', label));
      st.appendChild(mkStepper(cur, v => { if (k in p.resources) p.resources[k] = v; else p[k] = v; }, 0, 99));
      sg.appendChild(st);
    });
    b.appendChild(sg);

    // —— 财阀板（呼应图2布局：部门列 ｜ 三轨+计分轨 ｜ 船/设备/火车阶梯）——
    b.appendChild(el('div', 'subhead', '财阀板'));
    const zb = el('div', 'zb-board');
    const row1 = el('div', 'zb-row');

    // 部门列（左）
    const depts = el('div', 'zb-depts');
    CFG.WORKER_COLORS.forEach((c) => {
      const got = p.departments.find(d => d.color === c);
      const tile = el('div', 'dept-tile' + (got ? (got.upgraded ? ' upgraded' : '') : ' off'));
      const sw = el('span', 'sw'); sw.style.background = WK_HEX[c]; tile.appendChild(sw);
      tile.appendChild(el('span', null, WK_CN[c] + '部门'));
      const dv = CFG.WORKER_DEPT[c]; const give = dv && dv.give ? Object.values(dv.give)[0] : null;
      tile.appendChild(el('span', 'v', give ? (got && got.upgraded ? give[1] : give[0]) : ''));
      tile.title = '点击切换：未获得 → 基础 → 升级';
      tile.onclick = () => {
        pushUndo();
        if (!got) p.departments.push({ color: c, upgraded: false });
        else if (!got.upgraded) got.upgraded = true;
        else p.departments = p.departments.filter(d => d.color !== c);
        renderPlayerBody();
      };
      depts.appendChild(tile);
    });
    row1.appendChild(depts);

    // 中部：三轨 + 计分轨
    const mid = el('div', 'zb-mid');
    [['rnd', '研发'], ['mining', '采矿'], ['finance', '金融']].forEach(([k, label]) => {
      const row = el('div', 'zb-track');
      row.appendChild(el('span', 'tn', label));
      const ladder = el('div', 'zb-ladder');
      for (let i = 0; i <= 12; i++) {
        const pip = el('div', 'zb-pip' + (i <= p.tracks[k] ? ' on' : '') + ([5, 8, 10].includes(i) ? ' bonus' : ''));
        pip.textContent = [5, 8, 10].includes(i) ? i : '';
        pip.onclick = () => { pushUndo(); p.tracks[k] = i; renderPlayerBody(); };
        ladder.appendChild(pip);
      }
      row.appendChild(ladder);
      mid.appendChild(row);
    });
    const scoreRow = el('div', 'zb-score-row');
    for (let i = 0; i <= 40; i += 1) {
      const sp = el('div', 'zb-score-pip' + (i <= p.vp ? ' on' : ''));
      sp.title = String(i);
      sp.onclick = () => { pushUndo(); p.vp = i; renderPlayerBody(); };
      scoreRow.appendChild(sp);
    }
    mid.appendChild(el('div', 'subhead', '计分轨（点选定位）'));
    mid.appendChild(scoreRow);
    row1.appendChild(mid);

    // 右侧：船 / 设备 / 火车 阶梯（剩余越少越接近个人目标清空阈值）
    const side = el('div', 'zb-side');
    [['ships', '船', '⛵'], ['machines', '设备', '⚙'], ['trains', '火车', '🚂']].forEach(([k, label, ic]) => {
      const grp = el('div', 'zb-side-group');
      grp.appendChild(el('div', 'zb-side-h', label + (p[k] === 0 ? ' ✓' : '')));
      const r = el('div', 'zb-ship-row');
      r.appendChild(el('span', null, ic));
      r.appendChild(mkStepper(p[k], v => { p[k] = v; renderPlayerBody(); }, 0, 6));
      grp.appendChild(r);
      side.appendChild(grp);
    });
    row1.appendChild(side);
    zb.appendChild(row1);

    // 工厂区（横排，呼应图2底部建筑剪影行）
    const factRow = el('div', 'zb-factories');
    factRow.appendChild(el('div', 'subhead', '已建工厂（点 × 移除）'));
    const fr = el('div', 'factory-row');
    p.factories.forEach((f, fi) => {
      const meta = CFG.FACTORY_META[f.key];
      const slot = el('div', 'factory-slot');
      slot.style.borderTopColor = FACTORY_HEX[f.key]; slot.style.borderTopWidth = '3px';
      slot.appendChild(el('div', 'ftype', meta.cn + f.n + f.side));
      slot.appendChild(el('div', 'flv', 'L' + meta.level + ' · 研发需 ' + meta.rndRequired));
      const goods = el('div', 'fgoods');
      for (let i = 0; i < (f.goods || 0); i++) goods.appendChild(el('span', 'fgoods-pip'));
      slot.appendChild(goods);
      slot.appendChild(el('div', 'fmach', '设备 ' + (f.machines || 0) + '/2'));
      if (isMe) {
        const x = el('span', 'x', '×'); x.onclick = () => { pushUndo(); p.factories.splice(fi, 1); renderPlayerBody(); }; slot.appendChild(x);
        slot.onclick = (e) => { if (e.target === x) return; };
        const gp = el('div'); gp.style.cssText = 'display:flex;gap:4px;margin-top:2px';
        const gMinus = el('button', 'btn sm', '货-'); gMinus.onclick = () => { pushUndo(); f.goods = Math.max(0, (f.goods || 0) - 1); renderPlayerBody(); };
        const gPlus = el('button', 'btn sm', '货+'); gPlus.onclick = () => { pushUndo(); f.goods = Math.min(4, (f.goods || 0) + 1); renderPlayerBody(); };
        const mPlus = el('button', 'btn sm', '装设备'); mPlus.onclick = () => { pushUndo(); f.machines = Math.min(2, (f.machines || 0) + 1); renderPlayerBody(); };
        gp.append(gMinus, gPlus, mPlus); slot.appendChild(gp);
      }
      fr.appendChild(slot);
    });
    if (isMe) {
      const addSlot = el('div', 'factory-slot empty', '+ 建厂');
      addSlot.style.cursor = 'pointer';
      addSlot.onclick = () => openFactoryPicker(p);
      fr.appendChild(addSlot);
    }
    factRow.appendChild(fr);
    zb.appendChild(factRow);

    // 个人目标 · 恩赐标记行
    const favRow = el('div', 'zb-favors');
    const FAVOR_CATS = [['ship','船'],['train','火车'],['machine','设备'],['rnd','研发轨'],['mining','采矿轨'],['finance','金融轨']];
    FAVOR_CATS.forEach(([cat, cn]) => {
      const got = p.favorsOnObjectives.find(f => f.category === cat);
      const slot = el('div', 'favor-slot' + (got ? ' lv' + got.level : ''));
      slot.appendChild(el('span', null, cn));
      slot.appendChild(el('span', 'lv', got ? got.level + '级' : '—'));
      slot.title = '点击循环：无 → 1级 → 2级 → 3级 → 无';
      slot.onclick = () => {
        pushUndo();
        if (!got) p.favorsOnObjectives.push({ category: cat, level: 1 });
        else if (got.level < 3) got.level++;
        else p.favorsOnObjectives = p.favorsOnObjectives.filter(f => f.category !== cat);
        renderPlayerBody();
      };
      favRow.appendChild(slot);
    });
    zb.appendChild(favRow);
    b.appendChild(zb);

    if (isMe) {
      // —— 契约（图3样式：紫框卡片 + 绿色对勾）——
      b.appendChild(el('div', 'subhead', '契约 · 8 张（点击切换已履约）'));
      const cg = el('div', 'contract-grid');
      ensurePlayerContracts(p);
      CFG.CONTRACTS.forEach((c) => {
        const rec = p.contracts.find(x => x.id === c.id);
        const done = !!(rec && rec.fulfilled);
        const card = el('div', 'contract-card' + (done ? ' done' : ''));
        const ic = el('div', 'c-ic'); const color = c.reward.deptBonus ? WK_HEX[c.reward.deptBonus] : '#7d4fb8';
        ic.style.background = color; ic.textContent = CONTRACT_ICON[c.reward.deptBonus || 'any'];
        card.appendChild(ic);
        card.appendChild(el('div', 'c-lv', c.special ? '特殊·需 L' + c.needLevel + '货物' : '部门奖励'));
        card.appendChild(el('div', 'c-check', '✓'));
        card.title = c.id;
        card.onclick = () => { pushUndo(); rec.fulfilled = !rec.fulfilled; renderPlayerBody(); };
        cg.appendChild(card);
      });
      b.appendChild(cg);

      // 工人列表（保留简洁文字列表，非图1/2核心呈现对象）
      renderListEditor(b, '工人（手中/已雇）', p.workers, (w) =>
        `<span class="wk" style="display:inline-block;background:${WK_HEX[w.color]};vertical-align:middle"></span> ${WK_CN[w.color]}部门${w.isExpert ? ' · 专家' : ''}`,
        () => workerAddRow(p));
    } else {
      b.appendChild(el('div', 'note', '对手板仅录入影响力相关与关键引擎信息（左侧地图含其地区影响力/火车）。求解只针对「我」，对手状态用于影响力计分模拟。'));
    }
  }

  function ensurePlayerContracts(p) {
    if (!p.contracts || p.contracts.length !== CFG.CONTRACTS.length || !p.contracts.every(c => CFG.CONTRACTS.some(x => x.id === c.id))) {
      p.contracts = CFG.CONTRACTS.map(c => ({ id: c.id, fulfilled: false }));
    }
  }

  function openFactoryPicker(p) {
    const m = $('#modal');
    let html = '<h3>选择要建造的工厂</h3><div class="mbody"><div class="contract-grid">';
    CFG.FACTORY_META && Object.entries(CFG.FACTORY_META).forEach(([key, meta]) => {
      html += `<div class="contract-card" data-key="${key}" style="cursor:pointer">
        <div class="c-ic" style="background:${FACTORY_HEX[key]}">🏭</div>
        <div class="c-lv">${meta.cn} · L${meta.level}</div>
      </div>`;
    });
    html += '</div></div><div class="mfoot"><button class="btn ghost" id="mNo">取消</button></div>';
    m.innerHTML = html;
    $('#modalBg').classList.add('show');
    $('#mNo').onclick = () => $('#modalBg').classList.remove('show');
    m.querySelectorAll('.contract-card').forEach(card => {
      card.onclick = () => {
        const key = card.dataset.key; const meta = CFG.FACTORY_META[key];
        pushUndo();
        p.factories.push({ key, side: 'A', n: 1, level: meta.level, line: meta.line, machines: 0, goods: 0 });
        $('#modalBg').classList.remove('show');
        renderPlayerBody();
      };
    });
  }

  function renderListEditor(parent, title, arr, fmt, addRowFn) {
    parent.appendChild(el('div', 'subhead', title + ` <span class="pill">${arr.length}</span>`));
    if (!arr.length) parent.appendChild(el('div', 'empty-hint', '（暂无，点下方添加）'));
    arr.forEach((item, i) => {
      const line = el('div', 'list-line', fmt(item));
      const x = el('span', 'x', '×'); x.onclick = () => { pushUndo(); arr.splice(i, 1); renderPlayerBody(); };
      line.appendChild(x); parent.appendChild(line);
    });
    if (addRowFn) parent.appendChild(addRowFn());
  }

  function favorCN(c){return {ship:'船',train:'火车',machine:'设备',rnd:'研发轨',mining:'采矿轨',finance:'金融轨',contract:'合约',factory:'工厂',any:'通用'}[c]||c;}
  function WCN(c){return {black:'黑',red:'红',grey:'灰',blue:'蓝',white:'白',yellow:'黄'}[c]||c;}

  function workerAddRow(p) {
    const r = el('div', 'add-row');
    const c = el('select'); CFG.WORKER_COLORS.forEach(col => c.appendChild(new Option(WK_CN[col] + '部门', col)));
    const exp = el('select'); exp.appendChild(new Option('普通', '0')); exp.appendChild(new Option('专家', '1'));
    const btn = el('button', 'btn sm', '+');
    btn.onclick = () => { pushUndo(); p.workers.push({ color: c.value, isExpert: exp.value === '1', onGreySpace: false }); renderPlayerBody(); };
    r.append(c, exp, btn); return r;
  }


  /* ============================================================
   *  底栏行动
   * ============================================================ */
  function renderTurnInd() {
    const M = game.meta;
    const cur = game.players[M.currentTurnPlayer];
    const isMine = M.currentTurnPlayer === M.myPlayerIndex;
    $('#turnInd').innerHTML = `当前回合：<b style="color:${cur.color}">${cur.name}</b>` + (isMine ? ' · 轮到我' : '');
    $('#btnSolve').disabled = false;
  }

  $('#btnOpp').onclick = () => {
    pushUndo();
    game.meta.currentTurnPlayer = (game.meta.currentTurnPlayer + 1) % game.meta.playerCount;
    curTab = game.meta.currentTurnPlayer;
    toast(`轮到 ${game.players[curTab].name}，录入其执行结果`);
    renderTabs(); renderPlayerBody(); renderTurnInd();
  };

  $('#btnRound').onclick = () => {
    confirmModal('轮重置重录', '新一轮开始：雇用区补满、工人列按人数行数重置。是否清空当前雇用区与工人列以便重录？', () => {
      pushUndo();
      game.meta.roundIndex++;
      game.hiringArea.forEach(c => c.workers = []);
      game.workerQueue = { top: [], middle: [], bottom: [] };
      // 约 5 轮后进入最终轮
      if (game.meta.roundIndex >= 6) game.meta.isFinalRound = true;
      toast('已进入第 ' + game.meta.roundIndex + ' 轮，请重录工人');
      renderAll();
    });
  };

  $('#btnUndo').onclick = () => {
    if (!undoStack.length) return toast('无可撤销');
    game = undoStack.pop();
    renderAll(); toast('已撤销');
  };

  $('#btnSave').onclick = () => {
    const blob = new Blob([JSON.stringify(game, null, 2)], { type: 'application/json' });
    const a = el('a'); a.href = URL.createObjectURL(blob);
    a.download = `财阀对局_P${game.meta.period}R${game.meta.roundIndex}.json`;
    a.click(); URL.revokeObjectURL(a.href); toast('已保存对局 JSON');
  };
  $('#btnLoad').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { try { pushUndo(); game = JSON.parse(rd.result); curTab = game.meta.myPlayerIndex; renderAll(); toast('已读取对局'); } catch (err) { toast('读取失败：文件格式有误'); } };
    rd.readAsText(f); e.target.value = '';
  };

  function pushUndo() { if (game) { undoStack.push(ENG.cloneState(game)); if (undoStack.length > 50) undoStack.shift(); } }

  /* ============================================================
   *  求解
   * ============================================================ */
  $('#btnSolve').onclick = () => {
    if (!game) return;
    game.meta.currentTurnPlayer = game.meta.myPlayerIndex;
    curTab = game.meta.myPlayerIndex;
    const result = ENG.solve(game);
    renderSolver(result);
    applyHighlights(result);
    $('#solver').classList.add('open');
    renderTabs(); renderPlayerBody(); renderTurnInd();
  };
  $('#solverClose').onclick = () => { $('#solver').classList.remove('open'); clearHighlights(); };

  function renderSolver(r) {
    const b = $('#solverBody');
    if (!r.best) { b.innerHTML = '<div class="empty-hint">无可行行动，建议整顿。</div>'; return; }
    const m = r.best.move;
    let html = `
      <div class="rec-card">
        <div class="stamp">推</div>
        <div class="eyebrow">推荐最优解 · ${prefCN(r.preference)}</div>
        <div class="title">${m.label}</div>
        <div class="detail">${m.detail}</div>
        <div class="delta">局面评估 ${r.best.delta >= 0 ? '+' : ''}${r.best.delta}（总分 ${r.best.score}）</div>
      </div>
      <h4 style="font-family:var(--serif);font-size:12px;letter-spacing:.1em;color:var(--brass);text-transform:uppercase;margin-bottom:10px">推荐理由</h4>
      <ul class="reasons">${r.reasons.map(x => `<li>${x}</li>`).join('')}</ul>`;

    if (r.alternatives && r.alternatives.length) {
      html += `<div class="alts"><h4>备选行动（评分差）</h4>`;
      r.alternatives.forEach((a, i) => {
        html += `<div class="alt">
          <div class="rank">${['弐','参','肆'][i] || (i + 2)}</div>
          <div class="info"><b>${a.move.label}</b><small>${a.move.detail}</small></div>
          <div class="gap">−${(r.best.score - a.score).toFixed(2)}</div>
        </div>`;
      });
      html += `</div>`;
    }

    // 评估维度拆解
    const bd = r.best.breakdown;
    const parts = Object.entries(bd).filter(([, v]) => Math.abs(v) > 0.01)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([k, v]) => `<span>${dimName(k)}</span> ${v >= 0 ? '+' : ''}${(+v).toFixed(2)}`).join('　');
    html += `<div class="breakdown" style="margin-top:16px;border-top:1px dashed var(--line);padding-top:12px">推荐步后评估拆解：<br>${parts}</div>`;

    b.innerHTML = html;
  }
  function dimName(k){return {vp:'当前分',tracks:'三轨终局',influence:'地区影响力',engine:'引擎产能',favor:'个人目标',resources:'资源/合约',tempo:'工人节奏',cleanupCost:'整顿成本',opportunity:'机会成本'}[k]||k;}

  function applyHighlights(r) {
    clearHighlights();
    if (!r.best) return;
    const a = r.best.move.action;
    const map = { rnd: ['track_rnd'], mining: ['track_mining'], invest: ['goods'], produce: ['coal', 'goods'],
      factory: ['money'], machine: ['money'], ship: ['iron', 'ships'], train: ['iron', 'trains'], localMarket: ['goods'] };
    highlights.fields = map[a] || [];
    if (a === 'train' || a === 'localMarket') highlights.regions = [0];
    renderMap(); renderPlayerBody();
  }
  function clearHighlights() { highlights = { fields: [], regions: [] }; if (game) { renderMap(); renderPlayerBody(); } }

  /* ============================================================
   *  小工具：toast / 模态
   * ============================================================ */
  let toastTimer;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }
  function confirmModal(title, msg, onYes) {
    const m = $('#modal');
    m.innerHTML = `<h3>${title}</h3><div class="mbody">${msg}</div>
      <div class="mfoot"><button class="btn ghost" id="mNo">取消</button><button class="btn primary" id="mYes">确定</button></div>`;
    $('#modalBg').classList.add('show');
    $('#mNo').onclick = () => $('#modalBg').classList.remove('show');
    $('#mYes').onclick = () => { $('#modalBg').classList.remove('show'); onYes(); };
  }

  /* ---------------- 启动 ---------------- */
  renderWizard();
})();
