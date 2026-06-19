/* =============================================================================
 *  engine.js  —  《明治维新：财阀》对局助手  决策引擎 (MVP, §4–§5)
 *  ---------------------------------------------------------------------------
 *  流程 (§5.1):
 *     GameState → MoveGenerator → 模拟(应用 EffectSpec) → Evaluator → Searcher → Explainer
 *
 *  本 MVP 实现 §5.4 的第一档「贪心」搜索器：枚举单步合法行动，模拟其效果，
 *  以 V(state)(§5.3) 评估并排序，输出推荐 + 理由 + 前 3 备选评分差(§5.5)。
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./config.js'));
  } else {
    root.ZAIBATSU_ENGINE = factory(root.ZAIBATSU_CONFIG);
  }
}(typeof self !== 'undefined' ? self : this, function (CFG) {
  'use strict';

  /* ---------------------------------------------------------------------- *
   *  数据模型 (§4 摘要)
   * ---------------------------------------------------------------------- */
  function emptyPlayer(index, color) {
    return {
      playerIndex: index,
      color: color || ['#c0392b', '#2980b9', '#27ae60', '#8e44ad'][index] || '#555',
      name: index === 0 ? '我' : ('对手' + index),
      tracks: { rnd: 0, mining: 0, finance: 0 },   // 轨道档位 (0 起)
      ships: 6, machines: 6, trains: 6,            // 初始 6，清空区域=个人目标阈值
      factories: [],   // {key, side, n, level, line, machines, goods}
      workers: [],     // {color, isExpert, onGreySpace}
      departments: [], // {color, upgraded}
      contracts: [],   // {id, fulfilled, needsHighLevelGoods}
      favorsOnObjectives: [], // {category, level}
      influenceLocked: [],    // 已锁定影响力数值 (各地区)
      influenceAvail: 0,
      resources: { coal: 0, silk: 0, iron: 0 },
      goods: 0,        // MVP: 货物总数（不分类型）
      money: 0,
      vp: 0,
      keepFlags: { goods: 0, coal: 0 }, // 纸3B/便当2B 整顿保留额度
    };
  }

  function createInitialState(setup) {
    const pc = setup.playerCount;
    const pcfg = CFG.PLAYER_COUNT_CFG[pc];
    const players = [];
    for (let i = 0; i < pc; i++) players.push(emptyPlayer(i));
    // 我方位次（setup.myPosition: 1-based）→ myPlayerIndex
    const myIdx = (setup.myPosition || 1) - 1;
    players[myIdx].name = '我（' + (setup.myPosition || 1) + '号位）';

    return {
      meta: {
        playerCount: pc,
        myPlayerIndex: myIdx,
        preference: setup.preference || 'balanced',
        period: 1,
        roundIndex: 1,
        isFinalRound: false,
        currentTurnPlayer: 0,
        scoringValues: CFG.DEFAULT_SCORING_VALUES[pc],
        influenceSlots: pcfg.influenceSlots,
        workerBag: pcfg.workerBag,
      },
      hiringArea: [],   // [{actionType, workers:[color,...]}]
      workerQueue: { top: [], middle: [], bottom: [] },
      // 地区：每区记录我的影响力/火车、各对手影响力、海外公司预印值、需求板。
      regions: (CFG.REGIONS_TEMPLATE || []).map(t => ({
        id: t.id, cn: t.cn, overseas: t.overseas || 0,
        myInfluence: 0, myTrains: 0,
        rivals: Array(Math.max(0, pc - 1)).fill(0),
        demand: t.demand ? { goodsA: t.demand.goodsA, goodsB: t.demand.goodsB, flipped: !!t.demand.flipped } : { goodsA: 'cotton', goodsB: 'paper', flipped: false },
      })),
      // 岩仓 6 目的地：是否仍有专家（取走即不可再派船取专家/升部门）
      destinations: (CFG.DESTINATIONS || []).map(d => ({
        id: d.id, cn: d.cn, dept: d.dept, expert: d.expert, expertAvailable: true, ships: 0,
      })),
      players,
    };
  }

  function cloneState(s) { return JSON.parse(JSON.stringify(s)); }
  function me(s) { return s.players[s.meta.myPlayerIndex]; }

  /* ---------------------------------------------------------------------- *
   *  EffectSpec 模拟器 (§3.7) — 应用工厂/合约/起始标记的 immediate 效果
   *  注：modifier/special 不在建造时立即结算；估值时由 evaluator 给潜力分。
   * ---------------------------------------------------------------------- */
  function applyOps(state, p, ops, ctx) {
    const log = [];
    (ops || []).forEach(function (op) {
      if (op.gain) {
        for (const k in op.gain) {
          const v = op.gain[k];
          if (k === 'money') p.money += v;
          else if (k === 'vp') p.vp += v;
          else if (k === 'goods') p.goods += v;
          else if (k in p.resources) p.resources[k] += v;
          log.push('得 ' + v + ' ' + zhRes(k));
        }
      }
      if (op.advance) {
        p.tracks[op.advance.track] = (p.tracks[op.advance.track] || 0) + op.advance.n;
        log.push(zhTrack(op.advance.track) + '轨 +' + op.advance.n);
      }
      if (op.build) {
        const w = op.build.what, n = op.build.n || 1;
        applyBuild(p, w, n);
        log.push('建 ' + n + ' ' + zhBuild(w));
        // 连锁 extra（条件造船/火车）—— 估值时计入潜力，这里仅当资源足时尝试
        if (op.build.extra && op.build.extra.cost) {
          if (canPay(p, op.build.extra.cost)) {
            pay(p, op.build.extra.cost);
            applyBuild(p, w === 'any' ? 'ship' : w, 1);
            log.push('连锁再建 1 ' + zhBuild(w));
          }
        }
      }
      if (op.deptBonus) {
        // 近似：部门奖励折算为少量即时收益（真实结算按部门色，估值用）
        p.vp += 1;
        log.push('部门奖励(≈+1分估值)');
      }
      if (op.score) {
        const est = estimateScoreRule(p, op.score);
        p.vp += est;
        log.push('计分栏估值 +' + est + ' 分');
      }
      if (op.keepUndiscarded) {
        const it = op.keepUndiscarded.items;
        if (it.indexOf('goods') >= 0) p.keepFlags.goods = Math.max(p.keepFlags.goods, op.keepUndiscarded.max);
        if (it.indexOf('coal') >= 0) p.keepFlags.coal = Math.max(p.keepFlags.coal, op.keepUndiscarded.max);
        log.push('整顿保留额度 +' + op.keepUndiscarded.max);
      }
      if (op.trainInfluence) { p._trainInfluence = op.trainInfluence; }
    });
    return log;
  }

  function applyBuild(p, what, n) {
    for (let i = 0; i < n; i++) {
      if (what === 'ship' && p.ships > 0) p.ships--;
      else if (what === 'train' && p.trains > 0) p.trains--;
      else if (what === 'machine' && p.machines > 0) p.machines--;
      else if (what === 'any') { // 优先船
        if (p.ships > 0) p.ships--; else if (p.trains > 0) p.trains--; else if (p.machines > 0) p.machines--;
      }
    }
  }

  // 统一扣费：{money,iron,silk,coal,goods} 任意组合
  function payCost(p, cost) {
    if (!cost) return;
    if (cost.money) p.money -= cost.money;
    if (cost.iron) p.resources.iron -= cost.iron;
    if (cost.silk) p.resources.silk -= cost.silk;
    if (cost.coal) p.resources.coal -= cost.coal;
    if (cost.goods) p.goods -= cost.goods;
  }

  const _WORKER_CN = { black: '黑', red: '红', grey: '灰', blue: '蓝', white: '白', yellow: '黄' };
  function WORKER_CN(c) { return _WORKER_CN[c] || c; }

  function estimateScoreRule(p, sr) {
    let est = 0;
    if (sr.rule === 'perFactoryType') {
      const types = new Set(p.factories.map(f => f.key));
      est = types.size * (sr.perVp || 2);
    } else if (sr.rule === 'perMachineMoney') {
      const built = p.factories.reduce((a, f) => a + (f.machines || 0), 0);
      est = Math.min((sr.max || 8), built * (sr.perMoney || 2)) / 5; // 钱→分折现
    } else if (sr.rule === 'scoreColumns') {
      // 计分栏堆分潜力：按已造 船/设备/火车/轨道进度粗估
      const built = (6 - p.ships) + (6 - p.machines) + (6 - p.trains);
      est = Math.min((sr.max || 12), Math.round(built * (sr.perVp || 2) * 0.5));
    }
    return Math.round(est);
  }

  function canPay(p, cost) {
    if (cost.money && p.money < cost.money) return false;
    if (cost.iron && p.resources.iron < cost.iron) return false;
    if (cost.coal && p.resources.coal < cost.coal) return false;
    if (cost.silk && p.resources.silk < cost.silk) return false;
    if (cost.financeDown && p.tracks.finance < cost.financeDown) return false;
    return true;
  }
  function pay(p, cost) {
    if (cost.money) p.money -= cost.money;
    if (cost.iron) p.resources.iron -= cost.iron;
    if (cost.coal) p.resources.coal -= cost.coal;
    if (cost.silk) p.resources.silk -= cost.silk;
    if (cost.financeDown) p.tracks.finance -= cost.financeDown;
  }

  /* ---------------------------------------------------------------------- *
   *  合法行动生成器 (§5.2)
   *  返回 [{action, label, detail, apply(state)->state, builderColor?}]
   * ---------------------------------------------------------------------- */
  function generateMoves(state) {
    const p = me(state);
    const moves = [];
    const C = CFG.ACTION_COSTS;

    // —— 研发 / 采矿（花 1/3/6 钱进 1/2/3 档）——
    [['rnd', 'rnd'], ['mining', 'mining']].forEach(([act, tk]) => {
      C[act].money.forEach((cost, i) => {
        if (p.money >= cost) {
          moves.push(mkMove(act, `${CFG.ACTION_CN[act]} 进 ${i + 1} 档（花 ${cost} 钱）`,
            `${zhTrack(tk)}轨 +${i + 1}`, (s) => {
              const q = me(s); q.money -= cost; q.tracks[tk] += (i + 1); return s;
            }));
        }
      });
    });

    // —— 工厂（花 6 钱，需达研发等级，建一座工厂并结算 immediate）——
    if (p.money >= 6) {
      const pool = (state.availableFactories && state.availableFactories.length)
        ? state.availableFactories
        : defaultFactoryPool();
      pool.forEach((ft) => {
        const meta = CFG.FACTORY_META[ft.key];
        if (!meta) return;
        if (p.tracks.rnd + 0 < meta.rndRequired) return; // 需达研发等级
        const eff = (CFG.FACTORY_EFFECTS[ft.key][ft.side] || []).find(e => e.n === ft.n);
        moves.push(mkMove('factory',
          `建造 ${meta.cn}厂 ${ft.n}${ft.side}（等级${meta.level}，花 6 钱）`,
          eff ? eff.desc : '建造工厂',
          (s) => {
            const q = me(s); q.money -= 6;
            q.factories.push({ key: ft.key, side: ft.side, n: ft.n, level: meta.level, line: meta.line, machines: 0, goods: 0 });
            if (eff && eff.timing === 'immediate') applyOps(s, q, eff.ops, {});
            if (eff && eff.timing === 'special') applyOps(s, q, eff.ops, {});
            return s;
          }, { effect: eff }));
      });
    }

    // —— 设备（每次 5 钱，在已有工厂上装）——
    if (p.money >= 5 && p.factories.some(f => (f.machines || 0) < 2)) {
      const target = p.factories.find(f => (f.machines || 0) < 2);
      moves.push(mkMove('machine', `装设备 ×1（花 5 钱，于 ${CFG.FACTORY_META[target.key].cn}厂）`,
        '+1 设备 → 提升该厂产能', (s) => {
          const q = me(s); q.money -= 5;
          const t = q.factories.find(f => (f.machines || 0) < 2); if (t) t.machines++;
          return s;
        }));
    }

    // —— 生产（按等级耗煤，产 1 + 每设备多 1）——
    p.factories.forEach((f, idx) => {
      const coalNeed = CFG.FACTORY_META[f.key].coalToProduce;
      if (p.resources.coal >= coalNeed) {
        const out = 1 + (f.machines || 0);
        moves.push(mkMove('produce',
          `生产 @${CFG.FACTORY_META[f.key].cn}厂（耗 ${coalNeed} 煤）`,
          `产 ${out} 货物`, (s) => {
            const q = me(s); q.resources.coal -= coalNeed; q.goods += out; return s;
          }));
      }
    });

    // —— 船运（按目的地：取专家工人 + 升级对应部门，触发船运轨奖励）——
    if (p.ships > 0) {
      (state.destinations || []).forEach((d) => {
        if (!d.expertAvailable) return;
        const pay = [];
        if (p.resources.iron >= 3) pay.push({ label: '付 3 铁', cost: { iron: 3 } });
        if (p.money >= 5 && p.resources.iron >= 1) pay.push({ label: '付 5 钱+1 铁', cost: { money: 5, iron: 1 } });
        pay.forEach((opt) => {
          moves.push(mkMove('ship', `船运→${d.cn}（${opt.label}）`,
            `取${WORKER_CN(d.expert)}专家工人 + 升级${WORKER_CN(d.dept)}部门`, (s) => {
              const q = me(s); payCost(q, opt.cost); applyBuild(q, 'ship', 1);
              q.workers.push({ color: d.expert, isExpert: true });
              if (!q.departments.some(x => x.color === d.dept)) q.departments.push({ color: d.dept, upgraded: true });
              const dd = (s.destinations || []).find(x => x.id === d.id); if (dd) { dd.expertAvailable = false; dd.ships++; }
              return s;
            }, { destId: d.id }));
        });
      });
    }

    // —— 火车（按地区：放火车，计分时每火车给 2 影响力，且不会被对手挤掉）——
    if (p.trains > 0) {
      (state.regions || []).forEach((r, ri) => {
        const pay = [];
        if (p.resources.iron >= 3) pay.push({ label: '付 3 铁', cost: { iron: 3 } });
        if (p.money >= 5 && p.resources.iron >= 1) pay.push({ label: '付 5 钱+1 铁', cost: { money: 5, iron: 1 } });
        pay.forEach((opt) => {
          moves.push(mkMove('train', `火车→${r.cn}（${opt.label}）`,
            '该地区计分时 +2 影响力（需该区有我的影响力标记）', (s) => {
              const q = me(s); payCost(q, opt.cost); applyBuild(q, 'train', 1);
              const rr = s.regions[ri]; if (rr) rr.myTrains = (rr.myTrains || 0) + 1;
              q.vp += 1; // 火车格子奖励近似
              return s;
            }, { regionIdx: ri }));
        });
      });
    }

    // —— 本地市场（按地区：花 1–3 货物放影响力标记 → 提升该区名次 + 2 分）——
    if (p.goods >= 1 && p.factories.length) {
      const f = p.factories.slice().sort((a, b) => b.level - a.level)[0];
      (state.regions || []).forEach((r, ri) => {
        for (let g = 1; g <= 3; g++) {
          if (p.goods < g) break;
          const inf = CFG.INFLUENCE_TABLE[f.level][g];
          moves.push(mkMove('localMarket',
            `本地市场→${r.cn}：花 ${g} 货物放 ${inf} 影响力`,
            `${CFG.FACTORY_META[f.key].cn}/等级${f.level} → 提升「${r.cn}」名次，并得 2 分`, (s) => {
              const q = me(s); q.goods -= g;
              const rr = s.regions[ri];
              if (rr) rr.myInfluence = (rr.myInfluence || 0) + inf; // 叠加一处影响力标记
              q.influenceLocked.push(inf);
              q.vp += 2; // 服务奖励取 2 分（亦可改取地区资源奖励）
              return s;
            }, { regionIdx: ri, inf }));
        }
      });
    }

    // —— 投资与合约（第 1 次花 1 个货物推 2 格金融，或履约）——
    if (p.goods >= 1) {
      moves.push(mkMove('invest', `投资：花 1 类货物 → 金融轨 +2`,
        '推进金融轨（影响整顿钱收入与终局阈值）', (s) => {
          const q = me(s); q.goods -= 1; q.tracks.finance += 2; return s;
        }));
      if (p.contracts.some(c => !c.fulfilled)) {
        moves.push(mkMove('invest', `合约：花 1 类货物 → 履行 1 份合约`,
          '履约（终局个人目标 + 合约分）', (s) => {
            const q = me(s); q.goods -= 1;
            const c = q.contracts.find(x => !x.fulfilled); if (c) c.fulfilled = true;
            return s;
          }));
      }
    }

    // —— 整顿 (§2.5)（收入 + 弃钱煤 + 工资），择时关键 ——
    moves.push(mkMove('cleanup', '整顿（结算收入 / 弃钱煤 / 付工资）',
      '触发部门收入与个人目标恩赐；弃光钱与煤', (s) => {
        const q = me(s);
        // C 收入：按采矿/金融轨给煤/钱（近似：每档少量）
        q.resources.coal += Math.min(3, 1 + Math.floor(q.tracks.mining / 2));
        q.money += Math.min(5, 1 + Math.floor(q.tracks.finance / 2));
        // B 弃钱煤（保留 keepFlags + 最后 1 钱）
        q.resources.coal = Math.min(q.resources.coal, q.keepFlags.coal);
        q.goods = q.goods; // 货物不在 B 弃（仅钱与煤）
        q.money = Math.max(1, q.money);
        // 工资近似：每种工人色 3 钱
        const colors = new Set(q.workers.map(w => w.color));
        q.money = Math.max(1, q.money - colors.size * 3);
        return s;
      }));

    return moves;
  }

  function mkMove(action, label, detail, apply, meta) {
    return { action, label, detail, apply, meta: meta || {} };
  }

  function defaultFactoryPool() {
    // 当未录入实际工厂池时，给每类型一张代表牌（A 面 1 号）供演示/估值
    return Object.keys(CFG.FACTORY_META).map(k => ({ key: k, side: 'A', n: 1 }));
  }

  /* ---------------------------------------------------------------------- *
   *  地区影响力名次分模型（规则书 p.18）—— 取胜主路径
   *  每地区：我的总影响力 = Σ我放置的影响力标记面值 + (有≥1标记时) 2×我的火车；
   *  与各对手总影响力、海外公司预印值一同排名；按 PERIOD_SCORING 给分。
   *  并列：并列名次分值之和 ÷ 并列人数 向下取整。海外参与排名但不计分。
   * ---------------------------------------------------------------------- */
  function myRegionInfluence(r, trainInf) {
    const tokens = (r.myInfluence || 0);
    const hasToken = tokens > 0 || (r.myTokens && r.myTokens.length);
    const trains = (r.myTrains || 0) * (hasToken ? (trainInf || 2) : 0);
    return tokens + trains;
  }

  // 给定本地区各方影响力，返回「我」所在名次的得分（按某时期分值表）
  function regionVPForPeriod(state, r, scoreVals, trainInf) {
    const mine = myRegionInfluence(r, trainInf);
    if (mine <= 0) return 0; // 该区无影响力不参与计分

    const places = state.meta._scoringPlaces || 4;
    // 参与者影响力：我 + 各对手 + 海外公司
    const rivals = (r.rivals || []).filter(x => x > 0);
    const overseas = (r.overseas || 0);
    const all = [{ me: true, v: mine }];
    rivals.forEach(v => all.push({ me: false, v }));
    if (overseas > 0) all.push({ me: false, v: overseas, overseas: true });
    all.sort((a, b2) => b2.v - a.v);

    // 找出我的并列名次区间
    const myV = mine;
    const higher = all.filter(x => x.v > myV).length;          // 严格高于我的人数
    const tiedCount = all.filter(x => x.v === myV).length;      // 与我同值(含我)
    const startRank = higher;                                   // 0-based 起始名次
    // 2 人局跳过第 2 档：名次映射 0→0,1→2,2→3
    const mapRank = (rk) => (places === 2 ? [0, 2, 3][Math.min(rk, 2)] : rk);
    // 并列：取连续名次分值平均（向下取整）
    let sum = 0, cnt = 0;
    for (let k = 0; k < tiedCount; k++) {
      const rk = mapRank(startRank + k);
      sum += (scoreVals[rk] || 0);
      cnt++;
    }
    return Math.floor(sum / Math.max(1, cnt));
  }

  // 全局影响力期望：对每个地区，计「本时期立即结算」+「未来剩余时期」的折算
  function expectedInfluenceVP(state) {
    const regions = state.regions || [];
    if (!regions.length) {
      // 无地区录入时的回退启发：用已锁定影响力近似（避免无数据时评估全 0）
      const p = me(state);
      const trainInf = (p._trainInfluence || 2);
      return (p.influenceLocked || []).reduce((a, x) => a + x, 0)
        + (6 - p.trains) * trainInf * 0.5;
    }
    const p = me(state);
    const trainInf = (p._trainInfluence || 2);
    const period = Math.min(3, state.meta.period || 1);
    // 剩余计分次数（含本时期）：时期1→3次, 2→2次, 3→1次
    const remaining = 4 - period;
    const PS = CFG.PERIOD_SCORING;
    state.meta._scoringPlaces = (CFG.PLAYER_COUNT_CFG[state.meta.playerCount] || {}).scoringPlaces || 4;

    let total = 0;
    for (const r of regions) {
      // 即将到来的最近一次结算（本时期）权重 1，更远时期按位置取该时期分值表，
      // 但远期影响力会被对手蚕食 → 以衰减系数体现不确定性。
      for (let k = 0; k < remaining; k++) {
        const per = period + k;
        const vals = PS[per] || PS[3];
        const decay = k === 0 ? 1.0 : Math.pow(0.55, k); // 远期打折
        total += regionVPForPeriod(state, r, vals, trainInf) * decay;
      }
    }
    return round2(total);
  }

  /* ---------------------------------------------------------------------- *
   *  评估函数 V(state) (§5.3)
   * ---------------------------------------------------------------------- */
  function getWeights(pref) {
    // 基准权重
    const base = { w1: 1.0, w2: 1.2, w3: 1.4, w4: 1.0, w5: 1.6, w6: 0.8, w7: 0.5, w8: 0.6, w9: 0.4 };
    if (pref === 'winRate') { base.w1 += 0.6; base.w3 += 0.8; base.w2 -= 0.3; base.w5 -= 0.3; } // 抬 w1/w3 压方差
    if (pref === 'maxScore') { base.w2 += 0.6; base.w4 += 0.5; base.w5 += 0.7; }                 // 搏分抬 w2/w4/w5
    return base;
  }

  function evaluate(state, prefOverride) {
    const p = me(state);
    const w = getWeights(prefOverride || state.meta.preference);
    const b = {};

    b.vp = w.w1 * p.vp;

    // w2 三轨终局期望（轨道档位越高，越接近 5/8/10→10/16/20 阈值）
    const trackScore = trackEndgame(p.tracks.rnd) + trackEndgame(p.tracks.mining) + trackEndgame(p.tracks.finance);
    b.tracks = w.w2 * trackScore;

    // w3 ★地区影响力名次分期望（取胜主路径）：逐地区按名次给分，
    //    并按「本时期 + 剩余时期」加权。详见 expectedInfluenceVP。
    b.influence = w.w3 * expectedInfluenceVP(state);

    // w4 引擎价值（工厂等级 × (1+设备)）
    const engine = p.factories.reduce((a, f) => a + f.level * (1 + (f.machines || 0)), 0)
      + p.tracks.mining * 0.3 + p.tracks.finance * 0.3;
    b.engine = w.w4 * engine;

    // w5 ★个人目标(恩赐)价值
    const favorVP = p.favorsOnObjectives.reduce((a, f) => {
      const cleared = isObjectiveCleared(p, f.category);
      const tier = cleared ? CFG.FAVOR_THRESHOLD_VP.high[f.level] : CFG.FAVOR_THRESHOLD_VP.low[f.level];
      return a + tier;
    }, 0);
    // 即便暂无恩赐标记，也对「能冲高阈值的线」给前瞻潜力分
    const potential = objectivePotential(p);
    b.favor = w.w5 * (favorVP * 0.4 + potential);

    // w6 资源/货物终局折现 + 合约进度
    const res = p.resources.coal + p.resources.silk + p.resources.iron + p.goods;
    const discount = Math.floor(res / 3) + Math.floor(p.money / 5);
    const contractProg = p.contracts.filter(c => c.fulfilled).length * 2;
    b.resources = w.w6 * (discount + contractProg);

    // w7 工人节奏
    b.tempo = w.w7 * (p.workers.length * 0.5);

    // w8 整顿成本（颜色种类 × 3 钱的潜在损失，越多越扣）
    const colorKinds = new Set(p.workers.map(x => x.color)).size;
    b.cleanupCost = -w.w8 * (colorKinds * 0.5);

    // w9 机会成本（终局逼近：最终轮时压低长线投资价值）
    b.opportunity = state.meta.isFinalRound ? -w.w9 * 2 : 0;

    const total = Object.values(b).reduce((a, x) => a + x, 0);
    return { total: round2(total), breakdown: b };
  }

  function trackEndgame(pos) {
    // 档位 → 终局期望分（粗略映射到 5/8/10→10/16/20 阶梯）
    if (pos >= 10) return 16;
    if (pos >= 8) return 12;
    if (pos >= 6) return 9;
    if (pos >= 5) return 7;
    if (pos >= 3) return 4;
    return pos * 0.8;
  }

  function isObjectiveCleared(p, cat) {
    if (cat === 'ship') return p.ships === 0;
    if (cat === 'train') return p.trains === 0;
    if (cat === 'machine') return p.machines === 0;
    if (cat === 'rnd') return p.tracks.rnd >= 10;
    if (cat === 'mining') return p.tracks.mining >= 10;
    if (cat === 'finance') return p.tracks.finance >= 10;
    return false;
  }

  function objectivePotential(p) {
    // 识别「最接近清空/冲高阈值」的线，给前瞻分（§5.3 个人目标规划）
    const lines = [
      { cat: 'ship', prog: (6 - p.ships) / 6 },
      { cat: 'train', prog: (6 - p.trains) / 6 },
      { cat: 'machine', prog: (6 - p.machines) / 6 },
      { cat: 'rnd', prog: Math.min(1, p.tracks.rnd / 10) },
      { cat: 'mining', prog: Math.min(1, p.tracks.mining / 10) },
      { cat: 'finance', prog: Math.min(1, p.tracks.finance / 10) },
    ];
    const best = Math.max(...lines.map(l => l.prog));
    return best * 6; // 最强线的推进度给潜力分
  }

  /* ---------------------------------------------------------------------- *
   *  搜索器 (§5.4) — 贪心打分 + 对头部候选做 2 步前瞻精排 + 解释器 (§5.5)
   *  前瞻：对单步评分最高的若干候选，再向前走一步（取我方最优后续），
   *  用「本步 + 0.6×最优后续」组合分精排，缓解短视，提升取胜质量。
   * ---------------------------------------------------------------------- */
  function bestNextScore(state) {
    // 一步贪心的最优后续评估分（用于前瞻），不再递归
    let best = -Infinity;
    const moves = generateMoves(state);
    for (const m of moves) {
      try {
        const ev = evaluate(m.apply(cloneState(state)));
        if (ev.total > best) best = ev.total;
      } catch (e) { /* skip */ }
    }
    return best === -Infinity ? evaluate(state).total : best;
  }

  function solve(state, opts) {
    const lookahead = !opts || opts.lookahead !== false;
    const base = evaluate(state);
    const moves = generateMoves(state);
    const scored = moves.map((m) => {
      let after, ev;
      try {
        after = m.apply(cloneState(state));
        ev = evaluate(after);
      } catch (e) {
        ev = { total: -999, breakdown: {} };
        after = null;
      }
      return { move: m, after, score: ev.total, delta: round2(ev.total - base.total), breakdown: ev.breakdown };
    });
    scored.sort((a, b) => b.score - a.score);

    // 2 步前瞻：仅对头部 6 个候选精排（控制开销）
    if (lookahead && scored.length > 1) {
      const K = Math.min(6, scored.length);
      for (let i = 0; i < K; i++) {
        const c = scored[i];
        if (!c.after) { c.combined = c.score; continue; }
        const nxt = bestNextScore(c.after);
        c.combined = round2(c.score * 1.0 + (nxt - c.score) * 0.6); // 本步 + 0.6×后续增益
      }
      // 头部按组合分重排；其余维持单步分顺序
      const head = scored.slice(0, K).sort((a, b) => (b.combined - a.combined) || (b.score - a.score));
      for (let i = 0; i < K; i++) scored[i] = head[i];
    }

    const best = scored[0];
    const alts = scored.slice(1, 4);
    return {
      baseScore: base.total,
      best,
      alternatives: alts,
      all: scored,
      reasons: best ? explain(state, best, alts) : ['无可行行动，建议整顿。'],
      preference: state.meta.preference,
    };
  }

  function explain(state, best, alts) {
    const reasons = [];
    const m = best.move;
    reasons.push(`推荐：「${m.label}」 —— ${m.detail}`);
    reasons.push(`该步使局面评估 +${best.delta}（评估总分 ${best.score}）。`);

    // 找出贡献最大的评估维度
    const top = Object.entries(best.breakdown).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    if (top) reasons.push(`主要价值来自「${dimName(top[0])}」维度（${round2(top[1])}）。`);

    if (m.action === 'factory' && m.meta.effect) {
      reasons.push(`工厂连招：${m.meta.effect.desc}${m.meta.effect.todo ? '（⚠ 该效果数值待对照实体牌）' : ''}。`);
    }

    // 地区影响力类推荐：说明落子前后该区名次变化（取胜主路径的关键解释）
    if ((m.action === 'localMarket' || m.action === 'train') && m.meta && m.meta.regionIdx != null) {
      const r0 = state.regions[m.meta.regionIdx];
      if (r0 && best.after) {
        const r1 = best.after.regions[m.meta.regionIdx];
        const rk0 = rankInRegion(state, r0), rk1 = rankInRegion(best.after, r1);
        const ord = ['第1', '第2', '第3', '第4', '未上榜'];
        const before = r0.myInfluence > 0 ? ord[Math.min(4, rk0)] : '未上榜';
        const after = ord[Math.min(4, rk1)];
        const per = Math.min(3, state.meta.period || 1);
        const remaining = 4 - per;
        reasons.push(`「${r0.cn}」名次：${before} → ${after}（我方影响力 ${r0.myInfluence}+${(r0.myTrains||0)?'火车':''} → ${r1.myInfluence}；对手 ${(r0.rivals||[]).filter(x=>x>0).join('/')||'0'}，海外 ${r0.overseas||0}）。`);
        reasons.push(`本时期及之后还有 ${remaining} 次影响力结算（本时期分值 ${CFG.PERIOD_SCORING[per].join('/')}），抢占名次收益随时期递增。`);
      }
    }

    if (state.meta.isFinalRound) reasons.push('当前为最终轮：已压低长线投资权重，优先即时分与已铺线收口。');

    if (alts.length) {
      const a = alts[0];
      reasons.push(`次选「${a.move.label}」评分差 ${round2(best.score - a.score)}；二者价值取向差异见备选列表。`);
    }
    return reasons;
  }

  /* ---------------------------------------------------------------------- *
   *  辅助
   * ---------------------------------------------------------------------- */
  function round2(x) { return Math.round(x * 100) / 100; }
  // 我在某地区的 0-based 名次（严格高于我的参与方数量）
  function rankInRegion(state, r) {
    const trainInf = (me(state)._trainInfluence || 2);
    const mine = myRegionInfluence(r, trainInf);
    if (mine <= 0) return 99;
    const all = [mine, ...(r.rivals || []).filter(x => x > 0)];
    if ((r.overseas || 0) > 0) all.push(r.overseas);
    return all.filter(v => v > mine).length;
  }
  function zhRes(k) { return ({ coal: '煤', silk: '丝', iron: '铁', money: '钱', vp: '分', goods: '货物' })[k] || k; }
  function zhTrack(k) { return ({ rnd: '研发', mining: '采矿', finance: '金融' })[k] || k; }
  function zhBuild(k) { return ({ ship: '船', train: '火车', machine: '设备', any: '船/设备/火车' })[k] || k; }
  function dimName(k) {
    return ({
      vp: '当前分数', tracks: '三轨终局期望', influence: '地区影响力', engine: '引擎/产能',
      favor: '个人目标(恩赐)', resources: '资源折现/合约', tempo: '工人节奏',
      cleanupCost: '整顿成本', opportunity: '机会成本',
    })[k] || k;
  }

  return {
    createInitialState, cloneState, me,
    generateMoves, evaluate, solve, applyOps,
    _internal: { trackEndgame, objectivePotential, defaultFactoryPool },
  };
}));
