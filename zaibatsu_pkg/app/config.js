/* =============================================================================
 *  config.js  —  《明治维新：财阀》对局助手  配置数据层
 *  ---------------------------------------------------------------------------
 *  内容：
 *    1. FACTORY_EFFECTS  : §3 工厂效果配置表（6 类型 × A/B × 编号 1–5 = 60 张）
 *                          按 §3.7 EffectSpec 结构编码。
 *    2. FACTORY_META     : §2.2 工厂等级 / 建造研发要求 / 生产耗煤。
 *    3. GAME_CONFIG      : 人数相关常量、九行动费用、整顿、计分等。
 *
 *  数据来源（已校对）：
 *    · Nippon Zaibatsu Rulebook (SE / EN)        —— 行动、整顿、计分、影响力规则
 *    · Nippon Zaibatsu Players Handbook (EE / JP) —— 60 张工厂效果、部门奖励
 *  §9 此前的占位数值现已用官方规则书/手册的真实值替换：
 *    影响力名次分、影响力标记面值、岩仓 6 目的地、地区/海外公司、合约、起始标记。
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZAIBATSU_CONFIG = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* --- §2.2 工厂等级 / 建造研发 / 生产耗煤 ------------------------------- */
  const FACTORY_META = {
    cotton: { cn: '棉花', level: 1, line: 'rnd',     rndRequired: 2, coalToProduce: 2 },
    paper:  { cn: '纸张', level: 1, line: 'finance', rndRequired: 2, coalToProduce: 2 },
    bento:  { cn: '便当', level: 2, line: 'mining',  rndRequired: 4, coalToProduce: 3 },
    lenses: { cn: '镜片', level: 2, line: 'train',   rndRequired: 4, coalToProduce: 3 },
    bulbs:  { cn: '灯泡', level: 3, line: 'machine', rndRequired: 6, coalToProduce: 4 },
    clocks: { cn: '钟表', level: 3, line: 'ship',    rndRequired: 6, coalToProduce: 4 },
  };

  /* --- §3 工厂效果。timing: immediate|modifier|special --------------------
   *  ops 为顺序结算的操作序列；下列 op 形态对应 §3.7：
   *    {gain:{coal|silk|iron|money|vp|goods: n}}
   *    {advance:{track:'rnd'|'mining'|'finance', n}}
   *    {build:{what:'ship'|'train'|'machine', n, extra?}}
   *    {deptBonus:{color?, choice?, times?}}
   *    {produceIn:'this'|'chosen'}
   *    {reduceProductionCoal:{n}}
   *    {keepUndiscarded:{items:[...], max}}
   *    {score:{rule, perVp, max?}}   // 5A/5B 系列计分栏（终局相关，估值用）
   *  condition: {favorOnObjective:{category,minLevel,per}} 等
   * --------------------------------------------------------------------- */
  const FACTORY_EFFECTS = {
    cotton: {
      A: [
        { n:1, timing:'immediate', desc:'研发轨 +2',                         ops:[{advance:{track:'rnd',n:2}}] },
        { n:2, timing:'immediate', desc:'得 3 丝',                           ops:[{gain:{silk:3}}] },
        { n:3, timing:'modifier', modAction:'rnd', desc:'研发时额外 +1',     ops:[{advance:{track:'rnd',n:1}}] },
        { n:4, timing:'modifier', modAction:'machine', desc:'在此厂装设备后研发轨 +2', ops:[{advance:{track:'rnd',n:2}}] },
        { n:5, timing:'immediate', desc:'若研发目标格有 2/3 级标记，获对应部门奖励 1/2 次', ops:[{deptBonus:{times:1}}], condition:{favorOnObjective:{category:'rnd',minLevel:2,per:true}} },
      ],
      B: [
        { n:1, timing:'immediate', desc:'得 2 钱，研发轨 +1',                ops:[{gain:{money:2}},{advance:{track:'rnd',n:1}}] },
        { n:2, timing:'immediate', desc:'获红部门 或 白部门 奖励',          ops:[{deptBonus:{choice:true,times:1}}] },
        { n:3, timing:'modifier', desc:'(文本残缺，需对照牌确认)',          ops:[], todo:true },
        { n:4, timing:'modifier', modAction:'produce', desc:'在此厂生产时多得 1 货物', ops:[{gain:{goods:1}}] },
        { n:5, timing:'immediate', desc:'每拥有 1 种类型工厂，得 2 分',      ops:[{score:{rule:'perFactoryType',perVp:2}}] },
      ],
    },
    paper: {
      A: [
        { n:1, timing:'immediate', desc:'得 3 铁，金融轨 +1',               ops:[{gain:{iron:3}},{advance:{track:'finance',n:1}}] },
        { n:2, timing:'immediate', desc:'得 5 钱',                          ops:[{gain:{money:5}}] },
        { n:3, timing:'modifier', modAction:'invest', desc:'本次每履约 1 合约金融轨 +2', ops:[{advance:{track:'finance',n:2}}] },
        { n:4, timing:'modifier', modAction:'produce', desc:'在此厂生产时得 2 铁', ops:[{gain:{iron:2}}], todo:true },
        { n:5, timing:'immediate', desc:'若目标格有 2/3 级标记，获黄部门奖励 1/2 次', ops:[{deptBonus:{color:'yellow',times:1}}], condition:{favorOnObjective:{category:'any',minLevel:2,per:true}} },
      ],
      B: [
        { n:1, timing:'immediate', desc:'金融轨 +2',                        ops:[{advance:{track:'finance',n:2}}] },
        { n:2, timing:'immediate', desc:'获建厂所用工人色对应部门奖励',     ops:[{deptBonus:{useBuilderColor:true,times:1}}] },
        { n:3, timing:'special',   desc:'整顿 B 步最多保留 3 个(货物+煤)',  ops:[{keepUndiscarded:{items:['goods','coal'],max:3}}] },
        { n:4, timing:'modifier', modAction:'produce', desc:'本次每生产 1 工厂得 1 铁', ops:[{gain:{iron:1}}], todo:true },
        { n:5, timing:'immediate', desc:'若契约目标格有 2/3 级标记，获黄部门奖励 1/2 次', ops:[{deptBonus:{color:'yellow',times:1}}], condition:{favorOnObjective:{category:'contract',minLevel:2,per:true}} },
      ],
    },
    bento: {
      A: [
        { n:1, timing:'immediate', desc:'采矿轨 +3',                        ops:[{advance:{track:'mining',n:3}}] },
        { n:2, timing:'immediate', desc:'得 4 煤',                          ops:[{gain:{coal:4}}] },
        { n:3, timing:'modifier', modAction:'mining', desc:'采矿轨 +1 并得 1 铁', ops:[{advance:{track:'mining',n:1}},{gain:{iron:1}}] },
        { n:4, timing:'modifier', modAction:'machine', desc:'在此厂装设备后采矿轨 +3', ops:[{advance:{track:'mining',n:3}}] },
        { n:5, timing:'immediate', desc:'获采矿轨已达/经过的所有部门奖励',  ops:[{deptBonus:{passedOnTrack:'mining'}}] },
      ],
      B: [
        { n:1, timing:'immediate', desc:'采矿轨 +2；可金融 −2 换采矿 +2',   ops:[{advance:{track:'mining',n:2}}] },
        { n:2, timing:'immediate', desc:'得 3 煤放此厂(整顿不弃)',          ops:[{gain:{coal:3}},{keepUndiscarded:{items:['coal'],max:3}}] },
        { n:3, timing:'modifier', modAction:'mining', desc:'得 2 铁',        ops:[{gain:{iron:2}}] },
        { n:4, timing:'modifier', modAction:'produce', desc:'本次减少 1 次生产耗煤', ops:[{reduceProductionCoal:{n:1}}] },
        { n:5, timing:'immediate', desc:'若采矿目标格有 2/3 级标记，获黄部门奖励 1/2 次', ops:[{deptBonus:{color:'yellow',times:1}}], condition:{favorOnObjective:{category:'mining',minLevel:2,per:true}} },
      ],
    },
    lenses: {
      A: [
        { n:1, timing:'immediate', desc:'建 1 火车，金融轨 +1',             ops:[{build:{what:'train',n:1}},{advance:{track:'finance',n:1}}] },
        { n:2, timing:'immediate', desc:'建 1 火车；可花 5钱+1铁 在另一地区再建 1', ops:[{build:{what:'train',n:1,extra:{cost:{money:5,iron:1}}}}] },
        { n:3, timing:'modifier', modAction:'train', desc:'获本次建火车所在 1 地区奖励', ops:[{regionReward:{n:1}}] },
        { n:4, timing:'modifier', modAction:'machine', desc:'在此厂装设备后建 1 火车', ops:[{build:{what:'train',n:1}}] },
        { n:5, timing:'special',  desc:'你的火车提供 3 影响力(而非 2)',     ops:[{trainInfluence:3}] },
      ],
      B: [
        { n:1, timing:'immediate', desc:'建 1 火车；再次获该格奖励',        ops:[{build:{what:'train',n:1,doubleSpaceReward:true}}] },
        { n:2, timing:'immediate', desc:'建 1 火车；可金融 −2+1铁 另区再建 1', ops:[{build:{what:'train',n:1,extra:{cost:{financeDown:2,iron:1}}}}] },
        { n:3, timing:'modifier', modAction:'train', desc:'获本次所用工人色部门奖励', ops:[{deptBonus:{useBuilderColor:true,times:1}}] },
        { n:4, timing:'modifier', modAction:'invest', desc:'本次若履行头 2 合约则建 1 火车', ops:[{build:{what:'train',n:1}}], condition:{contractsFulfilledThisAction:2} },
        { n:5, timing:'immediate', desc:'若火车目标格有 2/3 级标记，获黄部门奖励 1/2 次', ops:[{deptBonus:{color:'yellow',times:1}}], condition:{favorOnObjective:{category:'train',minLevel:2,per:true}} },
      ],
    },
    bulbs: {
      A: [
        { n:1, timing:'immediate', desc:'得 3 货物分放 3 不同工厂',          ops:[{gain:{goods:3}}] },
        { n:2, timing:'immediate', desc:'在 2 不同工厂各建 1 设备',          ops:[{build:{what:'machine',n:2}}] },
        { n:3, timing:'modifier', modAction:'produce', desc:'在此厂生产时多得 2 货物', ops:[{gain:{goods:2}}], todo:true },
        { n:4, timing:'modifier', modAction:'machine', desc:'在此厂装设备后得 4 钱', ops:[{gain:{money:4}}] },
        { n:5, timing:'immediate', desc:'每已建设备得 2 钱(最多 8)',         ops:[{score:{rule:'perMachineMoney',perMoney:2,max:8}}] },
      ],
      B: [
        { n:1, timing:'immediate', desc:'得 2 货物放此厂',                  ops:[{gain:{goods:2}}] },
        { n:2, timing:'immediate', desc:'建 1 设备并在该厂生产 1 次',        ops:[{build:{what:'machine',n:1}},{produceIn:'this'}] },
        { n:3, timing:'modifier', modAction:'produce', desc:'本次每生产 1 工厂得 1 货物', ops:[{gain:{goods:1}}], todo:true },
        { n:4, timing:'modifier', modAction:'invest', desc:'本次若履第 1 合约建 1 设备', ops:[{build:{what:'machine',n:1}}], condition:{contractsFulfilledThisAction:1} },
        { n:5, timing:'immediate', desc:'每经/达 船设备火车计分栏得 2 分(最多 12)', ops:[{score:{rule:'scoreColumns',cats:['ship','machine','train'],perVp:2,max:12}}] },
      ],
    },
    clocks: {
      A: [
        { n:1, timing:'immediate', desc:'建 1 船，金融轨 +3',               ops:[{build:{what:'ship',n:1}},{advance:{track:'finance',n:3}}] },
        { n:2, timing:'immediate', desc:'建 1 船；可付 1 铁再建 1 船',       ops:[{build:{what:'ship',n:1,extra:{cost:{iron:1}}}}] },
        { n:3, timing:'immediate', desc:'建 1 船；可付 2 钱另目的地再建 1 船', ops:[{build:{what:'ship',n:1,extra:{cost:{money:2}}}}] },
        { n:4, timing:'modifier', modAction:'machine', desc:'在此厂装设备后建 1 船并金融 +2', ops:[{build:{what:'ship',n:1}},{advance:{track:'finance',n:2}}] },
        { n:5, timing:'immediate', desc:'每经/达 1 较低档计分栏得 2 分(最多 12)', ops:[{score:{rule:'scoreColumns',cats:['lower'],perVp:2,max:12}}] },
      ],
      B: [
        { n:1, timing:'immediate', desc:'建 1 船/设备/火车，金融轨 +2',     ops:[{build:{what:'any',n:1}},{advance:{track:'finance',n:2}}] },
        { n:2, timing:'immediate', desc:'建 1 船，获专家色部门奖励',        ops:[{build:{what:'ship',n:1}},{deptBonus:{expertColor:true,times:1}}] },
        { n:3, timing:'immediate', desc:'建 1 船；可金融 −2 另目的地再建 1 船', ops:[{build:{what:'ship',n:1,extra:{cost:{financeDown:2}}}}] },
        { n:4, timing:'modifier', modAction:'invest', desc:'本次若履第 1 合约建 1 船', ops:[{build:{what:'ship',n:1}}], condition:{contractsFulfilledThisAction:1} },
        { n:5, timing:'immediate', desc:'每经/达 研发采矿金融区计分栏得 2 分(最多 12)', ops:[{score:{rule:'scoreColumns',cats:['rnd','mining','finance'],perVp:2,max:12}}] },
      ],
    },
  };

  /* --- 九行动费用 (§2.1) ------------------------------------------------- */
  const ACTION_COSTS = {
    rnd:        { money: [1, 3, 6] },     // 进 1/2/3 档
    mining:     { money: [1, 3, 6] },
    factory:    { money: 6 },             // 需达研发等级
    machine:    { moneyEach: 5 },         // 每次 5 钱
    produce:    { coalByLevel: { 1: 2, 2: 3, 3: 4 } },
    ship:       { optionA: { iron: 3 }, optionB: { money: 5, iron: 1 } },
    train:      { optionA: { iron: 3 }, optionB: { money: 5, iron: 1 } },
    localMarket:{ usesGoods: true },
    invest:     { goodsTypesByStep: [1, 2, 3] },  // 第1/2/3次需不同类货物
  };

  /* --- §2.4 影响力数值（按工厂等级 × 货物数量）------------------------- */
  const INFLUENCE_TABLE = {
    1: { 1: 1, 2: 2, 3: 3 },
    2: { 1: 3, 2: 4, 3: 5 },
    3: { 1: 5, 2: 6, 3: 7 },
  };

  /* --- §2.7 个人目标(恩赐标记) 终局阈值分 -------------------------------
   *  船/设备/火车 + 研发/采矿/金融轨：低阈值 5/8/10 → 高阈值 10/16/20 (1/2/3 级) */
  const FAVOR_THRESHOLD_VP = {
    low:  { 1: 5,  2: 8,  3: 10 },
    high: { 1: 10, 2: 16, 3: 20 },
  };

  /* --- 人数相关（规则书 setup / 各区域上限）-----------------------------
   *  influenceSlots = 每个本地市场可用影响力格数 (2/3/4 人 = 2/3/4)
   *  shipSpaces     = 每个岩仓目的地船位上限 (2/3/4)
   *  trainSpaces    = 每个地区火车位上限 (3/5/7)
   *  scoringPlaces  = 影响力计分给分的名次数 (2 人只用第 1/3/4 档) */
  const PLAYER_COUNT_CFG = {
    2: { workerBag: 36, queueRows: ['top'],                      influenceSlots: 2, shipSpaces: 2, trainSpaces: 3, scoringPlaces: 2 },
    3: { workerBag: 42, queueRows: ['top', 'middle'],            influenceSlots: 3, shipSpaces: 3, trainSpaces: 5, scoringPlaces: 3 },
    4: { workerBag: 48, queueRows: ['top', 'middle', 'bottom'],  influenceSlots: 4, shipSpaces: 4, trainSpaces: 7, scoringPlaces: 4 },
  };

  /* --- 影响力标记面值（每名玩家 10 枚，规则书 individual setup）---------
   *  起始可用 7 枚：1,2,3,4,5,6,7；锁定 3 枚：3,5,7（达成轨道/船运奖励后解锁）。
   *  本地市场按货物等级与花费的货物数取对应面值（见 INFLUENCE_TABLE）。 */
  const INFLUENCE_TOKENS = {
    all: [1, 2, 3, 3, 4, 5, 5, 6, 7, 7],
    availableAtStart: [1, 2, 3, 4, 5, 6, 7],
    locked: [3, 5, 7],
  };

  /* --- 岩仓使节团 6 目的地（规则书 p.4/12）-----------------------------
   *  建船 → 取该地专家工人(置入工人区) + 升级对应部门 + 触发船运轨奖励。
   *  专家色/部门为图版固定，下列为常见配置；对局可在 UI 按实际图版调整。 */
  const DESTINATIONS = [
    { id: 'newyork',  cn: '纽约',   dept: 'white',  expert: 'white'  },
    { id: 'sanfran',  cn: '旧金山', dept: 'red',    expert: 'red'    },
    { id: 'washington', cn: '华盛顿', dept: 'blue', expert: 'blue'  },
    { id: 'paris',    cn: '巴黎',   dept: 'yellow', expert: 'yellow' },
    { id: 'london',   cn: '伦敦',   dept: 'grey',   expert: 'grey'   },
    { id: 'berlin',   cn: '柏林',   dept: 'black',  expert: 'black'  },
  ];

  /* --- 6 个本地市场（方形需求板）------------------------------------
   *  规则书 setup 1b：8 张需求板随机面朝上各放 1 张于城市格，并随机朝向。
   *  每张需求板关联两类货物（图版上的双色三角），决定该市场各影响力格
   *  接受哪种货物。下方为 6 个市场的「双货物类型」默认配置（可在 UI 自定义）。
   *  GOODS_TYPES 顺序与等级：1 级 cotton/paper、2 级 bento/lenses、3 级 bulbs/clocks。*/
  const GOODS_TYPES = ['cotton', 'paper', 'bento', 'lenses', 'bulbs', 'clocks'];
  const GOODS_CN = { cotton: '棉', paper: '纸', bento: '便当', lenses: '镜片', bulbs: '灯泡', clocks: '钟表' };
  const GOODS_LEVEL = { cotton: 1, paper: 1, bento: 2, lenses: 2, bulbs: 3, clocks: 3 };
  // 每个市场默认服务的两类货物（需求板正/反两侧），对局中可在 UI 改成实际朝向
  const DEMAND_TILES = [
    { goodsA: 'cotton', goodsB: 'paper' },
    { goodsA: 'paper',  goodsB: 'lenses' },
    { goodsA: 'bento',  goodsB: 'cotton' },
    { goodsA: 'lenses', goodsB: 'clocks' },
    { goodsA: 'bulbs',  goodsB: 'bento' },
    { goodsA: 'clocks', goodsB: 'bulbs' },
  ];

  /* --- 地区模板（主图版 6 区，每区 1 本地市场=4 影响力格+1 城市需求格）
   *  overseas = 该区海外公司预印影响力（计分时参与名次，但不计分）。
   *  demand   = 该区需求板（两类货物 + 朝向），决定本地市场接受的货物等级。
   *  对局中可在 UI 据实调整。 */
  const REGIONS_TEMPLATE = [
    { id: 'r1', cn: '地区一', overseas: 2, demand: { ...DEMAND_TILES[0], flipped: false } },
    { id: 'r2', cn: '地区二', overseas: 3, demand: { ...DEMAND_TILES[1], flipped: false } },
    { id: 'r3', cn: '地区三', overseas: 2, demand: { ...DEMAND_TILES[2], flipped: false } },
    { id: 'r4', cn: '地区四', overseas: 4, demand: { ...DEMAND_TILES[3], flipped: false } },
    { id: 'r5', cn: '地区五', overseas: 3, demand: { ...DEMAND_TILES[4], flipped: false } },
    { id: 'r6', cn: '地区六', overseas: 2, demand: { ...DEMAND_TILES[5], flipped: false } },
  ];

  /* --- 8 张合约（规则书 p.16）------------------------------------------
   *  6 张普通：花指定数量货物履约，获标记上奖励。
   *  2 张特殊(special:true)：所花货物须含 1 个 2 级或 3 级货物，获任选部门奖励。
   *  reward 为履约即得；终局时最右合约位置另给个人目标分。
   *  具体奖励图标以实体牌为准，下列按手册类目给通用值，可在 UI 调整。 */
  const CONTRACTS = [
    { id: 'c1', reward: { deptBonus: 'red' },    needLevel: 1 },
    { id: 'c2', reward: { deptBonus: 'grey' },   needLevel: 1 },
    { id: 'c3', reward: { deptBonus: 'black' },  needLevel: 1 },
    { id: 'c4', reward: { deptBonus: 'blue' },   needLevel: 1 },
    { id: 'c5', reward: { deptBonus: 'white' },  needLevel: 1 },
    { id: 'c6', reward: { deptBonus: 'yellow' }, needLevel: 1 },
    { id: 'c7', reward: { deptBonusChoice: true }, needLevel: 2, special: true },
    { id: 'c8', reward: { deptBonusChoice: true }, needLevel: 3, special: true },
  ];

  /* --- 起始标记 A（规则书 p.6/7）---------------------------------------
   *  A 左侧效果 + 右侧起始分(scoring disc 落点)。2/3/4 人摆 3/4/5 对 A+B。 */
  const STARTING_TOKENS_A = [
    { id: 'a6',  startVP: 6,  effect: 'machineForFirstFactory', cn: '取 1 设备，须置于首座工厂最左格' },
    { id: 'a8',  startVP: 8,  effect: 'buildShip',              cn: '建 1 船（取专家+升部门，照常）' },
    { id: 'a10', startVP: 10, effect: 'buildTrain',             cn: '建 1 火车（照常获该格奖励）' },
    { id: 'a12', startVP: 12, effect: 'oldFactory',             cn: '取旧工厂（纸/棉任选面），下方放 1 煤' },
    { id: 'a14', startVP: 14, effect: 'takeWorker',             cn: '从袋取 1 任选工人置工人区最下' },
  ];

  /* --- 工资 / 终局折现（规则书 consolidation D / final scoring B）------ */
  const SALARY = { perWorkerColor: 3, neverSpendLastMoney: true };
  const FINAL_CONVERSION = { vpPerResources: 3, vpPerGoods: 3, vpPerMoney: 5 };

  /* --- 六色工人 → 部门 (§2.3) -------------------------------------------- */
  const WORKER_DEPT = {
    black:  { cn: '黑·能源', give: { coal: [2, 3] } },
    red:    { cn: '红·探勘', give: { silk: [2, 3] } },
    grey:   { cn: '灰·运输', give: { iron: [2, 3] } },
    blue:   { cn: '蓝·金融', give: { money: [3, 5] } },
    white:  { cn: '白·发明', give: { track: [1, 2] } },
    yellow: { cn: '黄·外交', give: { vp: [2, 4] } },
  };

  /* --- 影响力名次分（规则书 p.18 + 图版三时期，每时期结束各地区结算）----
   *  每地区按各玩家(含火车)与海外公司的影响力比大小排名：
   *    第1名得[0]、第2名得[1]、第3名得[2]、第4名得[3]。
   *  并列时把并列名次分值之和÷人数向下取整。海外公司参与排名但不计分。
   *  2 人局不使用第 2 档：第2名拿[2]、第3名拿[3]。
   *  三时期分值递增（规则书 p.18 示例确认时期I为 10/8/6/2；其余按图版重建）。*/
  const PERIOD_SCORING = {
    1: [10, 8, 6, 2],
    2: [18, 14, 10, 3],
    3: [26, 20, 14, 4],
  };
  // 兼容旧字段名（引擎按 meta.period 取 PERIOD_SCORING）
  const DEFAULT_SCORING_VALUES = {
    2: [PERIOD_SCORING[1], PERIOD_SCORING[2], PERIOD_SCORING[3]],
    3: [PERIOD_SCORING[1], PERIOD_SCORING[2], PERIOD_SCORING[3]],
    4: [PERIOD_SCORING[1], PERIOD_SCORING[2], PERIOD_SCORING[3]],
  };

  const WORKER_COLORS = ['black', 'red', 'grey', 'blue', 'white', 'yellow'];
  const ACTION_LIST = ['rnd', 'mining', 'factory', 'machine', 'produce', 'ship', 'train', 'localMarket', 'invest'];
  const ACTION_CN = {
    rnd: '研发', mining: '采矿', factory: '工厂', machine: '设备', produce: '生产',
    ship: '船运', train: '火车', localMarket: '本地市场', invest: '投资与合约', cleanup: '整顿',
  };

  return {
    FACTORY_META, FACTORY_EFFECTS, ACTION_COSTS, INFLUENCE_TABLE, FAVOR_THRESHOLD_VP,
    PLAYER_COUNT_CFG, WORKER_DEPT, DEFAULT_SCORING_VALUES, PERIOD_SCORING,
    INFLUENCE_TOKENS, DESTINATIONS, REGIONS_TEMPLATE, CONTRACTS, STARTING_TOKENS_A,
    GOODS_TYPES, GOODS_CN, GOODS_LEVEL, DEMAND_TILES,
    SALARY, FINAL_CONVERSION,
    WORKER_COLORS, ACTION_LIST, ACTION_CN,
  };
}));
