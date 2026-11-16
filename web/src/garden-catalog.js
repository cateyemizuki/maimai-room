// Derived from feiyu-room-template 201a4ec (MIT).
// Display fallback catalog. Growth, transactions and saves belong to the server.
const MINUTE = 60_000;

export const GARDEN_RULES = Object.freeze({
  version: 1, plotCount: 8, compostCost: 8,
  waterDurationFactor: 0.75, fertilizerGrowth: 1.2, fertilizerYield: 2
});

export const CROPS = Object.freeze([
  { id: 'radish', name: '小萝卜', icon: '🥬', color: 0xdb5268, growMs: 2 * MINUTE, seedCost: 2, sellPrice: 2, yield: 3, type: 'root', description: '最先成熟的入门作物，饱满的红萝卜藏在叶丛下。' },
  { id: 'carrot', name: '胡萝卜', icon: '🥕', color: 0xe98935, growMs: 4 * MINUTE, seedCost: 3, sellPrice: 3, yield: 3, type: 'root', description: '羽状叶逐渐长高，成熟后可以拔出橙色根茎。' },
  { id: 'lettuce', name: '生菜', icon: '🥬', color: 0x83b84d, growMs: 3 * MINUTE, seedCost: 2, sellPrice: 2, yield: 4, type: 'leaf', description: '层层嫩叶向外舒展，适合快速补满菜篮。' },
  { id: 'tomato', name: '番茄', icon: '🍅', color: 0xd94b35, growMs: 6 * MINUTE, seedCost: 4, sellPrice: 4, yield: 4, type: 'fruit', description: '沿支架长大，从绿叶间结出一串红果实。' },
  { id: 'cucumber', name: '黄瓜', icon: '🥒', color: 0x43804b, growMs: 7 * MINUTE, seedCost: 4, sellPrice: 4, yield: 4, type: 'vine', description: '藤蔓攀着竹架向上，垂下细长的翠绿黄瓜。' },
  { id: 'eggplant', name: '茄子', icon: '🍆', color: 0x714078, growMs: 9 * MINUTE, seedCost: 5, sellPrice: 5, yield: 4, type: 'fruit', description: '宽大的叶片下面，长出有光泽的紫色茄子。' },
  { id: 'pepper', name: '甜椒', icon: '🫑', color: 0xde7840, growMs: 8 * MINUTE, seedCost: 5, sellPrice: 5, yield: 4, type: 'fruit', description: '小巧的灌丛里结出厚实甜椒，成熟时色彩鲜亮。' },
  { id: 'pumpkin', name: '南瓜', icon: '🎃', color: 0xd68c31, growMs: 12 * MINUTE, seedCost: 7, sellPrice: 9, yield: 3, type: 'vine', description: '藤叶铺满土面，等待几颗带棱纹的大南瓜长成。' },
  { id: 'corn', name: '玉米', icon: '🌽', color: 0xe6bd50, growMs: 10 * MINUTE, seedCost: 6, sellPrice: 6, yield: 4, type: 'corn', description: '挺拔的秆叶和金黄玉米棒，是菜园里最高的风景。' },
  { id: 'strawberry', name: '草莓', icon: '🍓', color: 0xdc4e62, growMs: 6 * MINUTE, seedCost: 5, sellPrice: 5, yield: 5, type: 'berry', description: '矮矮的叶丛开花结果，红草莓成熟后一次收进篮子。' },
  { id: 'potato', name: '土豆', icon: '🥔', color: 0xb18a54, growMs: 8 * MINUTE, seedCost: 4, sellPrice: 4, yield: 5, type: 'root', description: '地上的叶丛慢慢茂盛，收获时挖出一窝土豆。' },
  { id: 'cabbage', name: '卷心菜', icon: '🥬', color: 0x8bac66, growMs: 11 * MINUTE, seedCost: 6, sellPrice: 7, yield: 4, type: 'leaf', description: '叶片一层层抱拢，最终长成圆滚滚的菜球。' }
].map((crop) => Object.freeze(crop)));

