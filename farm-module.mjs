// src/routes/farm.ts
import { Hono as Hono6 } from "hono";

// src/lib/http.ts
import { HTTPException } from "hono/http-exception";
var fail = (status, message, code) => {
  throw new HTTPException(status, { message, cause: code ? { code } : void 0 });
};
function sameOrigin(c) {
  if (c.req.header("origin") !== new URL(c.req.url).origin) fail(403, "\u975E\u6CD5\u6765\u6E90");
}
async function boundedJson(c, maxBytes = 16384) {
  if (!/^application\/json(?:;|$)/i.test(c.req.header("content-type") ?? "")) fail(415, "\u8BF7\u4F7F\u7528 JSON \u8BF7\u6C42");
  const reader = c.req.raw.body?.getReader();
  if (!reader) fail(400, "\u8BF7\u6C42\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
  let size = 0, text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        fail(413, "\u8BF7\u6C42\u5185\u5BB9\u8FC7\u5927");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    fail(400, "\u8BF7\u6C42\u683C\u5F0F\u4E0D\u6B63\u786E");
  }
  if (!body || Array.isArray(body) || typeof body !== "object") fail(400, "\u8BF7\u6C42\u683C\u5F0F\u4E0D\u6B63\u786E");
  return body;
}

// src/services/auth.ts
var needUser = (c) => {
  const user = c.get("user") ?? fail(401, "\u8BF7\u5148\u767B\u5F55");
  if (user.disabled || user.kind === "bot") fail(403, "\u8D26\u53F7\u5DF2\u505C\u7528\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458");
  return user;
};
var isOwner = (c, u) => !!u && (c.env.ADMIN_USER_IDS ?? "").split(",").some((raw) => /^-?\d+$/.test(raw.trim()) && Number(raw.trim()) === u.id);

// src/lib/time.ts
var now = () => Math.floor(Date.now() / 1e3);

// src/lib/crypto.ts
var hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
var sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

// src/farm/community-species.ts
var COMMUNITY_CROPS = [
  ["baobao_blessing_rice", "\u9971\u9971\u798F\u7B7E\u7A3B", "corn", "grain", 14136940, 8823150, "star", "\u80D6\u9C7C\u628A\u798F\u7B7E\u85CF\u8FDB\u7A3B\u7A57\uFF0C\u795D\u6BCF\u4E2A\u5E72\u996D\u4EBA\u90FD\u6709\u6536\u6210\u3002"],
  ["baobao_big_banana", "\u5403\u5927\u4EFD\u91D1\u8549", "jiba_banana", "banana", 14990954, 7837282, "coin", "\u7FA4\u91CC\u7684\u4E00\u53E5\u201C\u5403\u5927\u7684\u201D\uFF0C\u957F\u6210\u4E86\u6C89\u7538\u7538\u7684\u91D1\u8549\u3002"],
  ["iron_armour_eggplant", "\u94C1\u7537\u8F7B\u7532\u8304", "grok_eggplant", "pepper", 8885406, 7247480, "gear", "\u94F6\u7070\u5C0F\u7532\u7247\u88F9\u4F4F\u8304\u5B50\uFF0C\u4ECA\u5929\u4E5F\u7EDD\u4E0D\u7A7A\u6536\u3002"],
  ["iron_offwork_mint", "\u4E0B\u73ED\u6478\u9C7C\u8584\u8377", "cabbage", "flower", 10731443, 5541248, "clock", "\u7B49\u5230\u4E0B\u73ED\u94C3\u54CD\uFF0C\u5C31\u628A\u70E6\u607C\u7559\u5728\u7530\u57C2\u5916\u3002"],
  ["polaris_star_lotus", "Polaris\u5BFB\u661F\u83B2", "naizi_peach", "flower", 11183826, 7904158, "star", "\u5317\u6781\u661F\u6765\u81EA\u6635\u79F0\uFF0C\u661F\u70B9\u5728\u83B2\u5FC3\u6084\u6084\u53D1\u4EAE\u3002"],
  ["polaris_water_berry", "\u591A\u559D\u6C34\u9732\u8393", "gemini_berry", "berry", 9287361, 7577218, "bubble", "\u628A\u7FA4\u91CC\u7684\u4E00\u53E5\u201C\u591A\u559D\u70B9\u6C34\u201D\uFF0C\u6536\u6210\u4E00\u7C07\u6E05\u51C9\u9732\u8393\u3002"],
  ["bigrice_little_grain", "BigRice\u7A3B\u5149\u7A57", "wheat", "grain", 14468748, 8756071, "sun", "\u7C73\u7C92\u5C0F\u7CBE\u7075\uFF0C\u540D\u5B57\u53D6\u81EA\u7FA4\u53CB\u516C\u5F00\u6635\u79F0\u3002"],
  ["bigrice_rice_mushroom", "\u7C73\u7C92\u7ED2\u7ED2\u83C7", "mole_mushroom", "mushroom", 14932929, 10728345, "cloud", "\u50CF\u5C0F\u996D\u56E2\u4E00\u6837\u7684\u83CC\u5E3D\uFF0C\u9897\u9897\u9971\u6EE1\u3002"],
  ["soup_morning_pumpkin", "\u65E9\u8336\u7FB9\u7FB9\u74DC", "pumpkin", "pumpkin", 13348989, 8625514, "sun", "\u7ED9\u6E05\u6668\u7684\u95EE\u5019\u7559\u4E00\u7897\u70ED\u4E4E\u4E4E\u7684\u7530\u56ED\u6C64\u3002"],
  ["soup_cosmos_flower", "\u5929\u5730\u65E0\u6781\u82B1", "meme_sunflower", "flower", 14202009, 7835768, "twin", "\u540D\u5B57\u6765\u81EA\u5929\u5730\u65E0\u6781\u7FB9\uFF0C\u82B1\u5FC3\u50CF\u65CB\u8F6C\u7684\u5C0F\u6C64\u7897\u3002"],
  ["group_coupon_pepper", "\u56FD\u8865\u706F\u7B3C\u6912", "tomato", "pepper", 13998711, 8165727, "lamp", "\u7FA4\u804A\u7EA2\u5305\u7684\u201C\u56FD\u8865\u201D\u6897\uFF0C\u7ED3\u6210\u4E00\u4E32\u5C0F\u706F\u7B3C\u3002"],
  ["group_shared_clover", "\u4E92\u52A9\u5238\u5238\u8349", "wheat", "flower", 10992526, 6589803, "clover", "\u628A\u4E92\u52A9\u5C0F\u5238\u6298\u6210\u56DB\u53F6\uFF0C\u6536\u597D\u6BCF\u4E00\u6B21\u987A\u624B\u5E2E\u5FD9\u3002"]
];
var COMMUNITY_FISH = [
  ["baobao", "\u9971\u9971\u798F\u9C7C", 8, "#c6ad75"],
  ["ironfish", "\u94C1\u7537\u94F6\u7532\u9C88", 7, "#8c9b9e"],
  ["offwork", "\u4E0B\u73ED\u949F\u6446\u9C80", 6, "#afa58b"],
  ["polaris", "Polaris\u661F\u5C3E\u9CC9", 8, "#9c9ac0"],
  ["waterplease", "\u9732\u6C34\u9752\u9CA4", 5, "#88ada8"],
  ["bigrice", "\u7C73\u5149\u94F6\u9C7C", 6, "#c4bc9f"],
  ["soup", "\u65E9\u8336\u6696\u9CCD\u9CAB", 6, "#c6a084"],
  ["coupon", "\u56FD\u8865\u7EA2\u5305\u9CB7", 7, "#bd8b83"]
];
function communityCrops(base) {
  return COMMUNITY_CROPS.map(([id, name, tier, , , , , story], i) => {
    const p = base.find((p2) => p2.id === tier);
    if (!p) throw Error("\u7FA4\u53CB\u7269\u79CD\u6863\u4F4D\u7F3A\u5931");
    return { ...p, id, name, frame: 600 + i, collection: "\u7FA4\u53CB\u9650\u5B9A", story };
  });
}

// src/farm/theme-species.ts
var THEME_CROPS = [
  ["huan_catmint", "\u6B22\u6B22\u732B\u8584\u8377", "cabbage", "flower", 16046540, 7253123, "cat"],
  ["dcoin_banana", "D\u5E01\u91D1\u73AF\u8549", "jiba_banana", "banana", 15715161, 7969870, "coin"],
  ["gentle_lotus", "\u6B63\u4EBA\u541B\u5B50\u83B2", "naizi_peach", "flower", 16115663, 7314558, "fan"],
  ["turbo_vine", "\u6709\u6302\u9F7F\u8F6E\u85E4", "deepseek_rice", "bean", 10139315, 5737074, "gear"],
  ["holy_star_rice", "\u795E\u4E86\u661F\u5149\u7A3B", "claude_wheat", "grain", 15915144, 10135398, "star"],
  ["shadow_nightberry", "\u9B54\u4E86\u591C\u8393", "gemini_berry", "berry", 11171773, 6782053, "horn"],
  ["fiftytwo_cocoa", "52\u53EF\u53EF\u8C46", "kimi_bean", "bean", 11829857, 7641167, "coin"],
  ["guess_wordpea", "\u731C\u8BCD\u5B57\u8C1C\u8C46", "carrot", "bean", 9550704, 5540697, "question"],
  ["yesno_pistachio", "\u662F\u975E\u5F00\u5FC3\u679C", "jev_pepper", "peach", 14010764, 7446649, "split"],
  ["hint_lantern", "\u7EBF\u7D22\u706F\u7B3C\u6912", "tomato", "pepper", 15706981, 7051861, "lamp"],
  ["winrate_clover", "\u80DC\u7387\u56DB\u53F6\u8349", "wheat", "flower", 8829325, 6132321, "clover"],
  ["queue_bambooshoot", "\u6392\u961F\u8282\u8282\u7B0B", "corn", "bamboo", 11978129, 7182433, "steps"],
  ["lucky_dice_mushroom", "\u624B\u6C14\u738B\u9AB0\u5B50\u83C7", "mole_mushroom", "mushroom", 15320436, 14272931, "dice"],
  ["unlucky_bittermelon", "\u624B\u6C14\u4EA1\u82E6\u74DC", "grok_eggplant", "pepper", 10203773, 6261088, "tear"],
  ["waterchat_cattail", "\u6C34\u7FA4\u84B2\u8349", "pumpkin", "grain", 12429171, 6857611, "bubble"],
  ["nightowl_coffee", "\u591C\u804A\u5496\u5561\u8C46", "glm_bamboo", "bean", 9333624, 5400428, "moon"],
  ["earlybird_glory", "\u65E9\u5B89\u7275\u725B\u82B1", "tomato", "flower", 10267370, 7641704, "sun"],
  ["r2_cloudberry", "\u4E91\u76D8\u4E91\u8393", "qwen_cotton", "berry", 13034725, 8496551, "cloud"],
  ["d1_index_cactus", "\u7D22\u5F15\u4ED9\u4EBA\u638C", "mole_mushroom", "bamboo", 8892576, 5145202, "grid"],
  ["worker_clockflower", "\u6253\u5DE5\u65F6\u949F\u82B1", "claude_wheat", "flower", 14396008, 8035179, "clock"],
  ["jev_scale_bean", "Jev\u5929\u5E73\u8C46", "jev_pepper", "bean", 9682331, 6130033, "scale"],
  ["muse_mint", "Muse\u97F3\u7B26\u8584\u8377", "cabbage", "flower", 12756692, 8301202, "note"],
  ["llama_woolfruit", "Llama\u7ED2\u679C", "qwen_cotton", "cotton", 15261123, 10398838, "ear"],
  ["opencode_fern", "\u5F00\u6E90\u62EC\u53F7\u8568", "glm_bamboo", "bamboo", 10012338, 5146738, "bracket"],
  ["nsfw_tulip", "NSFW\u5E18\u5E55\u90C1\u91D1\u9999", "gemini_berry", "flower", 11898537, 6650216, "curtain"],
  ["linux_penguin_radish", "L\u7AD9\u4F01\u9E45\u841D\u535C", "carrot", "root", 15328462, 5274731, "penguin"],
  ["capy_taro", "\u677E\u5F1B\u6C34\u8C5A\u828B", "naizi_peach", "peach", 12559755, 8755824, "capy"],
  ["malou_mandarin", "\u5417\u55BD\u7802\u7CD6\u6A58", "tomato", "fruit", 15180877, 7182422, "tail"],
  ["tangping_melon", "\u8EBA\u5E73\u897F\u74DC", "linux_pumpkin", "pumpkin", 10139516, 6131032, "sleep"],
  ["xianyan_dragonfruit", "\u663E\u773C\u5305\u706B\u9F99\u679C", "meme_sunflower", "peach", 14256548, 9680755, "crown"]
];
var THEME_ANIMALS = [
  ["huan_blushrabbit", "\u6B22\u6B22\u8138\u7EA2\u5154", "\u6B22\u6B22\u7ED2\u56E2", "huan_cat", "rabbit", 15982541, 14459041, "heart"],
  ["dcoin_hamster", "D\u5E01\u4ED3\u9F20", "\u9999\u8549\u679C\u4EC1", "chicken", "hamster", 15321224, 13213269, "coin"],
  ["jiba_banana_slug", "\u51E0\u628A\u5927\u9999\u8549\u86DE\u8753", "\u91D1\u8549\u51DD\u73E0", "sheep", "slug", 15256688, 12362062, "banana"],
  ["naizi_peach_cow", "\u67F0\u5B50\u871C\u6843\u725B", "\u871C\u6843\u9C9C\u5976", "cow", "cow", 15781838, 13474985, "peach"],
  ["gentle_crane", "\u6B63\u4EBA\u541B\u5B50\u9E64", "\u541B\u5B50\u957F\u7FBD", "gentle_swan", "crane", 15920602, 5860204, "fan"],
  ["turbo_cheetah", "\u6709\u6302\u75BE\u98CE\u8C79", "\u75BE\u98CE\u7ED2", "turbo_bull", "cat", 14138745, 5470844, "bolt"],
  ["holy_unicorn", "\u795E\u4E86\u72EC\u89D2\u517D", "\u661F\u8F89\u9B03\u6BDB", "holy_deer", "deer", 15918267, 13873258, "star"],
  ["mole_bat", "\u9B54\u4E86\u6708\u7FFC\u8760", "\u591C\u7FFC\u7ED2", "nsfw_sheep", "bat", 8745118, 12755394, "horn"],
  ["deepseek_whale", "DeepSeek\u6D6E\u7A7A\u9CB8", "\u9CB8\u68A6\u6CE1\u6CE1", "cow", "whale", 8632028, 14870748, "wave"],
  ["gpt_knot_turtle", "GPT\u7ED3\u7EF3\u9F9F", "\u7ED3\u7EF3\u73E0", "sheep", "turtle", 8827296, 5143664, "knot"],
  ["claude_sunfox", "Claude\u6696\u9633\u72D0", "\u6696\u9633\u7ED2", "huan_cat", "fox", 14393205, 15783860, "sun"],
  ["gemini_twinbird", "Gemini\u53CC\u661F\u96C0", "\u53CC\u661F\u7FBD", "gentle_swan", "bird", 10135245, 13083854, "twin"],
  ["qwen_cloudcat", "Qwen\u4E91\u56E2\u732B", "\u4E91\u56E2\u7ED2", "nsfw_sheep", "cat", 14077159, 10134730, "cloud"],
  ["kimi_moonrabbit", "Kimi\u6708\u82BD\u5154", "\u6708\u82BD\u7ED2", "huan_cat", "rabbit", 14604995, 9477550, "moon"],
  ["glm_memoryelephant", "GLM\u8BB0\u5FC6\u8C61", "\u8BB0\u5FC6\u6676\u73E0", "holy_deer", "elephant", 10401971, 14272934, "grid"],
  ["grok_nightcrow", "Grok\u591C\u5DE1\u9E26", "\u591C\u5DE1\u7FBD", "gentle_swan", "bird", 7433095, 11641022, "moon"],
  ["jev_balanceowl", "Jev\u5929\u5E73\u9E2E", "\u662F\u975E\u7FBD", "turbo_bull", "owl", 9809820, 14734246, "scale"],
  ["muse_songlark", "Muse\u6B4C\u4E91\u96C0", "\u65CB\u5F8B\u7FBD", "meme_chicken", "bird", 12231629, 8956576, "note"],
  ["llama_packet_alpaca", "Llama\u80CC\u5305\u9A7C", "\u80CC\u5305\u7ED2", "llama", "llama", 14471349, 10256752, "pack"],
  ["linux_penguin", "L\u7AD9\u4F01\u9E45", "\u793E\u533A\u8F6F\u7ED2", "linux_sheep", "penguin", 5399402, 15716227, "sprout"],
  ["nsfw_nightmoth", "NSFW\u591C\u5E18\u86FE", "\u591C\u5E18\u4E1D", "nsfw_sheep", "moth", 10256287, 14004931, "curtain"],
  ["guess_raccoon", "\u731C\u8BCD\u9762\u7F69\u6D63\u718A", "\u8C1C\u9898\u7ED2", "huan_cat", "raccoon", 11186592, 6648423, "question"],
  ["lucky_goldkoi", "\u624B\u6C14\u738B\u9526\u9CA4", "\u597D\u8FD0\u9CDE", "holy_deer", "fish", 15123059, 14391665, "crown"],
  ["unlucky_greyduck", "\u624B\u6C14\u4EA1\u7070\u9E2D", "\u5B89\u6170\u8F6F\u7FBD", "chicken", "bird", 10332582, 13872759, "tear"],
  ["waterchat_otter", "\u6C34\u7FA4\u6CE1\u6CE1\u736D", "\u6CE1\u6CE1\u73E0", "cow", "otter", 12100747, 9221557, "bubble"],
  ["nightwatch_owl", "\u591C\u804A\u5B88\u671B\u9E2E", "\u5B88\u591C\u7FBD", "sheep", "owl", 8491161, 14272411, "clock"],
  ["earlybird_rooster", "\u65E9\u5B89\u62A5\u6653\u9E21", "\u671D\u9732\u86CB", "meme_chicken", "bird", 15122309, 13074536, "sun"],
  ["capy_capybara", "\u677E\u5F1B\u6C34\u8C5A", "\u6E29\u6CC9\u7ED2", "cow", "capy", 12559753, 9152403, "orange"],
  ["malou_monkey", "\u5417\u55BD\u62B1\u6A58\u7334", "\u7802\u7CD6\u6A58", "huan_cat", "monkey", 12228725, 15118701, "orange"],
  ["xianyan_peacock", "\u663E\u773C\u5305\u5B54\u96C0", "\u663E\u773C\u5F69\u7FBD", "holy_deer", "peacock", 8365995, 11903175, "crown"]
];
function themeCrops(base) {
  return THEME_CROPS.map(([id, name, tier], i) => {
    const p = base.find((p2) => p2.id === tier);
    if (!p) throw Error("\u4F5C\u7269\u6536\u76CA\u6863\u4F4D\u7F3A\u5931\uFF1A" + tier);
    return { id, name, seconds: p.seconds, legacySeconds: p.legacySeconds, seedPrice: p.seedPrice, sellPrice: p.sellPrice, xp: p.xp, unlock: p.unlock, frame: 300 + i };
  });
}
function themeAnimals(base) {
  return THEME_ANIMALS.map(([id, name, product, tier], i) => {
    const p = base.find((p2) => p2.id === tier);
    if (!p) throw Error("\u52A8\u7269\u6536\u76CA\u6863\u4F4D\u7F3A\u5931\uFF1A" + tier);
    return { id, name, product, price: p.price, sellPrice: p.sellPrice, seconds: p.seconds, xp: p.xp, unlock: p.unlock, frame: 330 + i };
  });
}

// src/farm/stock-origin.ts
function stockBreakdown(s, key, total) {
  const saved = s.stockOrigins?.[key], grown = Math.min(total, Math.max(0, saved?.grown ?? 0)), stolen = Math.min(total - grown, Math.max(0, saved?.stolen ?? 0));
  return { grown, stolen, legacy: Math.max(0, total - grown - stolen) };
}
function addStock(s, key, source, n) {
  s.stockOrigins ??= {};
  const entry = s.stockOrigins[key] ??= { grown: 0, stolen: 0 };
  entry[source] += n;
}
function consumeStock(s, key, total, n, source) {
  const parts = stockBreakdown(s, key, total);
  if (source !== void 0 && (typeof source !== "string" || !["grown", "stolen", "legacy"].includes(source))) throw Error("\u5E93\u5B58\u6765\u6E90\u65E0\u6548");
  if (source !== void 0) {
    const k = source;
    if (parts[k] < n) throw Error("\u6240\u9009\u6765\u6E90\u7684\u5E93\u5B58\u4E0D\u8DB3");
    parts[k] -= n;
  } else {
    let left = n;
    for (const k of ["legacy", "grown", "stolen"]) {
      const take = Math.min(left, parts[k]);
      parts[k] -= take;
      left -= take;
    }
  }
  s.stockOrigins ??= {};
  if (parts.grown || parts.stolen) s.stockOrigins[key] = { grown: parts.grown, stolen: parts.stolen };
  else delete s.stockOrigins[key];
}

// src/farm/capacity.ts
var MAX_FARM_PLOTS = 60;
var FARM_EXPANSIONS = [
  { plots: 6, coins: 25, xp: 60 },
  { plots: 12, coins: 50, xp: 120 },
  { plots: 18, coins: 75, xp: 220 },
  { plots: 24, coins: 300, xp: 400 },
  { plots: 30, coins: 600, xp: 800 },
  { plots: 36, coins: 1e3, xp: 1500 },
  { plots: 42, coins: 1600, xp: 2500 },
  { plots: 48, coins: 2400, xp: 4e3 },
  { plots: 54, coins: 3600, xp: 6e3 }
];
var RANCH_EXPANSIONS = [{ slots: 6, coins: 600, xp: 500 }, { slots: 12, coins: 1800, xp: 1800 }, { slots: 18, coins: 4e3, xp: 4e3 }];

// src/farm/market-rules.ts
var MARKET_RULES = { tickSeconds: 600, cooldownSeconds: 600, shopPremiumPercent: 10, rottenPercent: 10, maxTrade: 1e4, minLife: 7200, maxLife: 172800 };
function consumeLegacy(s, key, n, source) {
  if (!s.market) return false;
  const total = s.market.legacy[key] ?? 0, old = s.market.legacyOrigins[key] ?? { grown: 0, stolen: 0 };
  const parts = { grown: Math.min(total, old.grown), stolen: Math.min(total - Math.min(total, old.grown), old.stolen), legacy: 0 };
  parts.legacy = total - parts.grown - parts.stolen;
  if (source !== void 0 && !["grown", "stolen", "legacy"].includes(String(source))) throw Error("\u5E93\u5B58\u6765\u6E90\u65E0\u6548");
  if (total < n || source !== void 0 && parts[source] < n) throw Error("\u6240\u9009\u5386\u53F2\u5E93\u5B58\u4E0D\u8DB3\uFF1B\u65B0\u589E\u6536\u6210\u8BF7\u5230\u884C\u60C5\u4ED3\u5E93\u51FA\u552E");
  let left = n;
  for (const k of source === void 0 ? ["legacy", "grown", "stolen"] : [source]) {
    const take = Math.min(left, parts[k]);
    left -= take;
    if (k !== "legacy") {
      old[k] -= take;
      if (s.stockOrigins?.[key]) s.stockOrigins[key][k] -= take;
    }
  }
  s.market.legacyOrigins[key] = old;
  s.market.legacy[key] -= n;
  return true;
}
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function shelfLife(seconds) {
  return clamp(seconds * 4, MARKET_RULES.minLife, MARKET_RULES.maxLife);
}
function marketPrice(p) {
  if (![p.price, p.base].every((n) => Number.isSafeInteger(n) && n > 0) || ![p.fresh, p.sold, p.bought].every((n) => Number.isSafeInteger(n) && n >= 0)) throw Error("\u884C\u60C5\u6570\u636E\u65E0\u6548");
  if (!p.sold && !p.bought) return p.price;
  const depth = Math.max(100, p.sold + p.bought), targetStock = Math.max(200, depth * 2);
  const stock = clamp((targetStock - p.fresh) / targetStock, -2, 1), flow = clamp((p.bought - p.sold) / depth, -1, 1);
  const target = clamp(p.base * Math.exp(0.45 * stock + 0.45 * flow), p.base * 0.35, p.base * 3);
  return Math.max(1, Math.round(clamp(p.price + 0.25 * (target - p.price), p.price * 0.85, p.price * 1.15)));
}
function marketSplit(quantity, carry) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isInteger(carry) || carry < 0 || carry > 9) throw Error("\u5206\u6D41\u6570\u91CF\u65E0\u6548");
  const shop = Math.floor((quantity + carry) / 10);
  return { shop, consumed: quantity - shop, carry: (quantity + carry) % 10 };
}
function marketMoney(balance, remainder, deltaCents) {
  if (![balance, remainder, deltaCents].every(Number.isSafeInteger) || balance < 0 || remainder < 0 || remainder > 99) throw Error("\u7ED3\u7B97\u91D1\u989D\u65E0\u6548");
  const total = remainder + deltaCents, whole = Math.floor(total / 100), next = balance + whole;
  if (!Number.isSafeInteger(next) || next < 0) throw Error("D\u5E01\u4F59\u989D\u4E0D\u8DB3\u6216\u8D85\u51FA\u53EF\u7ED3\u7B97\u8303\u56F4");
  return { balance: next, remainder: total - whole * 100, delta: whole };
}

// src/farm/care.ts
function compostManure(s, n) {
  if (!Number.isSafeInteger(n) || n <= 0) throw Error("\u6682\u65E0\u9700\u8981\u6E05\u6D01\u7684\u7CAA\u6C61");
  if (!s.fishing) throw Error("\u8BF7\u5148\u52A0\u8F7D\u5B8C\u6574\u519C\u573A\u5B58\u6863");
  const care = s.care ?? { compostUnits: 0, cleaned: 0 }, items = s.fishing.items ?? {}, total = care.compostUnits + n, made = Math.floor(total / 4);
  if ((items.compost ?? 0) + made > 9999) throw Error("\u5806\u80A5\u5DF2\u6EE1\uFF0C\u8BF7\u5148\u4F7F\u7528");
  items.compost = (items.compost ?? 0) + made;
  s.fishing.items = items;
  s.care = { compostUnits: total % 4, cleaned: care.cleaned + n };
  return made ? `\u6E05\u6D01\u5B8C\u6210\uFF0C\u5236\u6210\u6C34\u8349\u5806\u80A5 \xD7${made}` : `\u6E05\u6D01\u5B8C\u6210\uFF0C\u5806\u80A5\u539F\u6599 ${total % 4}/4`;
}

// src/farm/ranch.ts
var ORIGINAL_ANIMALS = [
  { id: "chicken", name: "\u56E2\u56E2\u9E21", product: "\u9E21\u86CB", price: 80, sellPrice: 6, seconds: 600, xp: 2, unlock: 0, frame: 6 },
  { id: "cow", name: "\u5976\u7CD6\u725B", product: "\u9C9C\u5976", price: 160, sellPrice: 14, seconds: 3600, xp: 5, unlock: 80, frame: 7 },
  { id: "sheep", name: "\u4E91\u6735\u7F8A", product: "\u7F8A\u6BDB", price: 200, sellPrice: 22, seconds: 7200, xp: 7, unlock: 200, frame: 8 },
  { id: "huan_cat", name: "\u6B22\u6B22\u732B", product: "\u6B22\u6B22\u732B\u6BDB\u7403", price: 120, sellPrice: 10, seconds: 1800, xp: 3, unlock: 100, frame: 100 },
  { id: "gentle_swan", name: "\u6B63\u4EBA\u541B\u5B50\u9E45", product: "\u541B\u5B50\u7FBD", price: 240, sellPrice: 24, seconds: 7200, xp: 7, unlock: 240, frame: 103 },
  { id: "turbo_bull", name: "\u6709\u6302\u725B", product: "\u95EA\u7535\u5976", price: 280, sellPrice: 12, seconds: 1800, xp: 3, unlock: 300, frame: 104 },
  { id: "holy_deer", name: "\u795E\u4E86\u9E7F", product: "\u661F\u5149\u7ED2", price: 400, sellPrice: 38, seconds: 14400, xp: 10, unlock: 500, frame: 105 },
  { id: "meme_chicken", name: "meme\u56E2\u5B50\u9E21", product: "\u8FF7\u56E0\u86CB", price: 180, sellPrice: 9, seconds: 1200, xp: 3, unlock: 180, frame: 107 },
  { id: "nsfw_sheep", name: "NSFW\u591C\u7ED2\u7F8A", product: "\u591C\u7ED2", price: 320, sellPrice: 32, seconds: 10800, xp: 9, unlock: 400, frame: 109 },
  { id: "linux_sheep", name: "L\u7AD9\u6B22\u805A\u7F8A", product: "\u6B22\u805A\u7ED2", price: 360, sellPrice: 35, seconds: 14400, xp: 10, unlock: 450, frame: 111 },
  { id: "llama", name: "Llama\u7ED2\u9A7C", product: "\u7ED2\u9A7C\u6BDB", price: 300, sellPrice: 30, seconds: 10800, xp: 8, unlock: 360, frame: 209 }
];
var BASE_ANIMALS = ORIGINAL_ANIMALS.map((a) => ({ ...a, legacySellPrice: a.sellPrice, sellPrice: 2 + (a.sellPrice - 2) * 2 + Math.ceil(a.seconds / 3600 * 4) }));
var ANIMALS = [...BASE_ANIMALS, ...themeAnimals(BASE_ANIMALS)];
var RANCH_RULES = { slots: 6, maxSlots: 24, expansions: RANCH_EXPANSIONS, capacity: 12, feedPrice: 2, maxFedSeconds: 86400, maxFeed: 1e4, starvationSeconds: 48 * 3600 };
var newRanch = () => ({ animals: [], feed: 0, products: {}, discovery: {}, collected: 0 });
function projectRanch(input, t) {
  const r = input ? structuredClone(input) : newRanch();
  r.slots ??= 6;
  for (const [index2, a] of r.animals.entries()) {
    a.id ??= `legacy-${index2}-${a.kind}-${a.fedUntil}`;
    a.productionEpoch ??= a.producedAt;
    const spec = ANIMALS.find((x) => x.id === a.kind);
    if (!spec) throw Error("\u7267\u573A\u7269\u79CD\u6682\u4E0D\u652F\u6301\uFF0C\u8BF7\u5237\u65B0\u9875\u9762");
    if (a.deadAt !== void 0) continue;
    const elapsed = Math.max(0, Math.floor((Math.min(t, a.fedUntil) - a.producedAt) / spec.seconds));
    const added = Math.min(RANCH_RULES.capacity - a.stored, elapsed);
    a.manure = a.manure === void 0 ? 0 : Math.min(12, a.manure + added);
    if (added > 0) a.productionEpoch = a.producedAt + added * spec.seconds;
    a.stored += added;
    a.producedAt += elapsed * spec.seconds;
    const deadline = a.fedUntil + RANCH_RULES.starvationSeconds;
    if (t >= deadline) a.deadAt = deadline;
  }
  return r;
}
function applyRanchAction(s, a, t, permissions = {}) {
  const r = s.ranch = projectRanch(s.ranch, t);
  const require3 = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const fields4 = (keys) => require3(Object.keys(a).every((k) => k === "type" || keys.includes(k)), "\u64CD\u4F5C\u5305\u542B\u4E0D\u652F\u6301\u7684\u5B57\u6BB5");
  const count4 = () => {
    require3(Number.isSafeInteger(a.count) && Number(a.count) > 0 && Number(a.count) <= 99, "\u6570\u91CF\u5E94\u4E3A1\u81F399\u7684\u6574\u6570");
    return Number(a.count);
  };
  if (a.type === "ranch_expand") {
    fields4([]);
    const expansion = RANCH_EXPANSIONS.find((x) => x.slots === r.slots);
    require3(expansion, "\u7267\u573A\u680F\u4F4D\u5DF2\u5168\u90E8\u5F00\u653E");
    require3(permissions.allUnlocked || s.xp >= expansion.xp, `\u6269\u5EFA\u9700\u8981\u8FBE\u5230${expansion.xp}\u7ECF\u9A8C`);
    require3(s.coins >= expansion.coins, "D\u5E01\u4E0D\u8DB3");
    s.coins -= expansion.coins;
    r.slots += 6;
    return "\u65B0\u589E6\u4E2A\u7267\u573A\u680F\u4F4D";
  }
  if (a.type === "animal_buy") {
    fields4(["kind", "count"]);
    const n = a.count === void 0 ? 1 : count4(), spec2 = ANIMALS.find((x) => x.id === a.kind);
    require3(spec2, "\u672A\u77E5\u52A8\u7269");
    require3(permissions.allUnlocked || s.xp >= spec2.unlock, "\u7ECF\u9A8C\u4E0D\u8DB3\uFF0C\u5C1A\u672A\u89E3\u9501\u8FD9\u79CD\u52A8\u7269");
    require3(r.animals.length + n <= r.slots, `\u7267\u573A\u7A7A\u680F\u4F4D\u4E0D\u8DB3\uFF0C\u5F53\u524D\u53EF\u9972\u517B${r.slots}\u53EA\u52A8\u7269\uFF0C\u53EF\u5728\u6269\u5EFA\u4E2D\u589E\u52A0\u680F\u4F4D`);
    require3(s.coins >= spec2.price * n, "D\u5E01\u4E0D\u8DB3");
    s.coins -= spec2.price * n;
    for (let i = 0; i < n; i++) r.animals.push({ id: crypto.randomUUID(), productionEpoch: t, kind: spec2.id, fedUntil: t, producedAt: t, stored: 0, manure: 0 });
    return "\u8FCE\u6765" + spec2.name + " \xD7" + n;
  }
  if (a.type === "feed_buy") {
    fields4(["count"]);
    const n = count4();
    require3(r.feed + n <= RANCH_RULES.maxFeed, "\u9972\u6599\u4ED3\u5DF2\u6EE1");
    require3(s.coins >= n * RANCH_RULES.feedPrice, "D\u5E01\u4E0D\u8DB3");
    s.coins -= n * RANCH_RULES.feedPrice;
    r.feed += n;
    return "\u8D2D\u5165\u9972\u6599 \xD7" + n;
  }
  if (a.type === "product_sell") {
    fields4(["kind", "count", "source"]);
    const spec2 = ANIMALS.find((x) => x.id === a.kind), n = count4();
    require3(spec2, "\u672A\u77E5\u755C\u4EA7");
    require3((r.products[spec2.id] ?? 0) >= n, "\u755C\u4EA7\u6570\u91CF\u4E0D\u8DB3");
    if (!consumeLegacy(s, "animal:" + spec2.id, n, a.source)) consumeStock(s, "animal:" + spec2.id, r.products[spec2.id], n, a.source);
    r.products[spec2.id] -= n;
    s.coins += n * spec2.sellPrice;
    return "\u552E\u51FA" + spec2.product + " \xD7" + n;
  }
  fields4(a.type === "animal_feed" ? ["animal", "count", "autoBuy"] : a.type === "animal_remove" ? ["animal", "collect"] : ["animal"]);
  require3(Number.isInteger(a.animal) && Number(a.animal) >= 0 && Number(a.animal) < r.animals.length, "\u52A8\u7269\u4E0D\u5B58\u5728");
  const animal = r.animals[Number(a.animal)], spec = ANIMALS.find((x) => x.id === animal.kind);
  const collect = () => {
    const n = animal.stored;
    require3(n > 0, "\u6682\u65F6\u6CA1\u6709\u53EF\u6536\u53D6\u7684\u755C\u4EA7");
    require3((r.products[spec.id] ?? 0) + n <= 1e4, "\u755C\u4EA7\u4ED3\u5DF2\u6EE1\uFF0C\u8BF7\u5148\u51FA\u552E");
    animal.stored = 0;
    r.products[spec.id] = (r.products[spec.id] ?? 0) + n;
    addStock(s, "animal:" + spec.id, "grown", n);
    r.collected += n;
    s.xp += spec.xp * n;
    const d = r.discovery[spec.id];
    r.discovery[spec.id] = { firstAt: d?.firstAt ?? t, count: (d?.count ?? 0) + n };
    return n;
  };
  if (a.type === "animal_clean") {
    const message = compostManure(s, animal.manure ?? 0);
    animal.manure = 0;
    return message;
  }
  if (a.type === "animal_remove") {
    require3(animal.deadAt !== void 0, "\u5B58\u6D3B\u52A8\u7269\u4E0D\u80FD\u6E05\u7406");
    require3(a.collect === void 0 || typeof a.collect === "boolean", "\u6536\u53D6\u5F00\u5173\u65E0\u6548");
    const saved = a.collect === true && animal.stored > 0 ? collect() : 0;
    require3(animal.stored === 0, "\u8BF7\u5148\u6536\u53D6\u5DF2\u6709\u755C\u4EA7");
    r.animals.splice(Number(a.animal), 1);
    return "\u5DF2\u6E05\u7406" + spec.name + "\u7684\u680F\u4F4D" + (saved ? `\uFF0C${spec.product} \xD7${saved} \u5DF2\u5165\u4ED3` : "");
  }
  if (a.type === "animal_feed" || a.type === "animal_sell") require3(animal.deadAt === void 0, "\u52A8\u7269\u5DF2\u6B7B\u4EA1\uFF0C\u4E0D\u80FD\u5582\u517B\u6216\u51FA\u552E\uFF0C\u8BF7\u6E05\u7406\u680F\u4F4D");
  if (a.type === "animal_feed") {
    const n = count4();
    require3(a.autoBuy === void 0 || typeof a.autoBuy === "boolean", "\u8865\u7CAE\u5F00\u5173\u65E0\u6548");
    const start = Math.max(t, animal.fedUntil);
    require3(start + n * spec.seconds <= t + RANCH_RULES.maxFedSeconds, "\u6BCF\u53EA\u52A8\u7269\u6700\u591A\u9884\u590724\u5C0F\u65F6\u9972\u6599");
    const missing = Math.max(0, n - r.feed);
    if (a.autoBuy === true && missing) {
      require3(s.coins >= missing * RANCH_RULES.feedPrice, "D\u5E01\u4E0D\u8DB3\uFF0C\u672C\u6279\u8865\u7CAE\u672A\u5B8C\u6210");
      s.coins -= missing * RANCH_RULES.feedPrice;
      r.feed += missing;
    }
    require3(r.feed >= n, "\u9972\u6599\u4E0D\u8DB3\uFF0C\u8BF7\u5148\u8865\u5145");
    if (animal.fedUntil <= t) animal.producedAt = t;
    animal.fedUntil = start + n * spec.seconds;
    r.feed -= n;
    return spec.name + "\u6DFB\u7CAE\uFF0C\u5907\u597D" + n + "\u8F6E\u4EA7\u51FA";
  }
  if (a.type === "animal_collect") {
    return "\u6536\u53D6" + spec.product + " \xD7" + collect();
  }
  if (a.type === "animal_sell") {
    require3(animal.stored === 0, "\u8BF7\u5148\u6536\u53D6\u8FD9\u53EA\u52A8\u7269\u7684\u755C\u4EA7");
    r.animals.splice(Number(a.animal), 1);
    const refund = Math.floor(spec.price / 2);
    s.coins += refund;
    return "\u9001\u522B" + spec.name + "\uFF0C\u8FD4\u8FD8" + refund + " D\u5E01";
  }
  throw Error("\u4E0D\u652F\u6301\u7684\u7267\u573A\u64CD\u4F5C");
}

// src/farm/fishing-catalog.ts
var FISH = [
  ["huan", "\u6843\u816E\u9CD1\u9C8F", 4, "#c89b9d"],
  ["banana", "\u91D1\u5F2F\u6CE5\u9CC5", 5, "#c5ae70"],
  ["meme", "\u82B1\u6591\u5C0F\u9CA4", 4, "#c49b78"],
  ["linux", "\u58A8\u8863\u91D1\u9CCD", 6, "#65727c"],
  ["seek", "\u9CB8\u68A6\u84DD\u9CCD", 8, "#739da9"],
  ["gpt", "\u9752\u7ED3\u9CA4", 6, "#849c75"],
  ["claude", "\u6696\u6591\u6EAA\u9CDF", 6, "#be9677"],
  ["gemini", "\u53CC\u661F\u8776\u5C3E", 8, "#a39bbb"],
  ["jev", "\u4E24\u9762\u9752\u9C88", 5, "#8da6a1"],
  ["kimi", "\u6708\u7259\u94F6\u9CB3", 7, "#a9b5c1"],
  ["qwen", "\u4E91\u7EB9\u767D\u6761", 5, "#a0b5c4"],
  ["grok", "\u591C\u5DE1\u4E4C\u9C88", 9, "#72748a"],
  ["holy", "\u6D41\u91D1\u9526\u9CA4", 12, "#ccb47a"],
  ["mole", "\u8D64\u987B\u591C\u9CB6", 10, "#946d80"],
  ["capy", "\u56F0\u56F0\u5F39\u6D82", 3, "#b09c83"],
  ["bug", "\u75BE\u98CE\u9752\u68AD", 7, "#81a69f"],
  ...COMMUNITY_FISH
].map(([id, name, price, color], frame) => ({ id: String(id), name: String(name), price: Number(price), color: String(color), frame }));
var FISHING_ITEMS = [
  { id: "river_bait", name: "\u6EAA\u866B\u9975", description: "\u4E0B\u6B21\u624B\u52A8\u5782\u9493\u6D88\u80171\u4EFD\uFF0C\u975E\u9C7C\u6389\u843D\u753130%\u63D0\u9AD8\u81F340%\u3002" },
  { id: "strong_line", name: "\u97E7\u4E1D\u7EBF", description: "\u4E0B\u6B21\u624B\u52A8\u5782\u9493\u6D88\u80171\u4EFD\uFF0C\u5F20\u529B\u589E\u957F\u653E\u7F13\uFF1B\u57FA\u7840\u8131\u94A9\u7387\u964D\u81F32%\u3002" },
  { id: "compost", name: "\u6C34\u8349\u5806\u80A5", description: "\u7528\u4E8E\u672A\u52A0\u901F\u7684\u751F\u957F\u4E2D\u4F5C\u7269\uFF0C\u7F29\u77ED\u539F\u751F\u957F\u65F6\u95F410%\uFF0C\u6BCF\u832C\u4EC5\u4E00\u6B21\u3002" },
  { id: "ward_charm", name: "\u5DE1\u7530\u94C3", description: "\u5F00\u542F15\u5206\u949F\u9632\u6458\u5B88\u62A4\uFF0C\u4E0D\u53E0\u52A0\u5269\u4F59\u65F6\u95F4\u3002" },
  { id: "feed_bundle", name: "\u8C37\u7269\u5305", description: "\u6253\u5F00\u83B7\u5F976\u4EFD\u7267\u573A\u9972\u6599\u3002" },
  { id: "reed", name: "\u67D4\u97E7\u82A6\u82C7", description: "3\u4EFD\u53EF\u7F16\u62101\u6839\u97E7\u4E1D\u7EBF\u3002" }
];
var FISHING_RODS = [{ level: 0, name: "\u65E7\u7AF9\u7AFF", cost: 0 }, { level: 1, name: "\u6EAA\u884C\u7AFF", cost: 80 }, { level: 2, name: "\u542C\u6F6E\u7AFF", cost: 240 }, { level: 3, name: "\u661F\u6C50\u7AFF", cost: 600 }];
var FISHING_LOOT_RULES = { fish: 70, crop: 9, seeds: 7, coins: 5, item: 8, title: 1, baseEscapePercent: 8, lineEscapePercent: 2 };

// src/shared/fishing-game.ts
var FISHING_GAME = { step: 50, maxDuration: 24e3, maxMoves: 64, minMoveGap: 80 };
function fishingFrame(fight, moves, duration) {
  let tension = 28, progress = 8, high = 0, low = 0, move = 0, held = false, status = "playing", reason = "", elapsed = 0, force = 0;
  const end = Math.min(FISHING_GAME.maxDuration, Math.max(0, duration)), rod = Math.max(0, Math.min(3, fight.rod));
  for (let ms = 0; ms < end; ms += FISHING_GAME.step) {
    while (move < moves.length && moves[move][0] <= ms) {
      held = moves[move][1] === 1;
      move++;
    }
    force = fight.pattern[Math.min(fight.pattern.length - 1, Math.floor(ms / 2e3))] ?? 0.5;
    const dt = Math.min(FISHING_GAME.step, end - ms) / 1e3;
    tension = Math.max(0, Math.min(110, tension + (held ? 15 + force * 15 - rod * 1.8 - (fight.line ? 3 : 0) : -27) * dt));
    progress = Math.max(0, Math.min(100, progress + (held ? 14 - force * 3 + rod * 0.5 : -force * 0.75) * dt));
    high = tension >= 96 ? high + dt : 0;
    low = tension <= 4 ? low + dt : 0;
    elapsed = ms + dt * 1e3;
    if (high >= 0.65 || low >= 2) {
      status = "escaped";
      reason = high >= 0.65 ? "\u9C7C\u7EBF\u7EF7\u65AD\u4E86" : "\u9C7C\u7EBF\u592A\u677E\uFF0C\u9C7C\u513F\u8131\u94A9";
      break;
    }
    if (progress >= 100) {
      status = "landed";
      break;
    }
  }
  if (status === "playing" && elapsed >= FISHING_GAME.maxDuration) {
    status = "escaped";
    reason = "\u9C7C\u513F\u6323\u8131\u4E86\uFF0C\u8BF7\u518D\u8BD5\u4E00\u7AFF";
  }
  return { tension, progress, force, held, status, reason, elapsed };
}
function validateFishingMoves(raw, duration) {
  if (!Number.isSafeInteger(duration) || Number(duration) < 0 || Number(duration) > FISHING_GAME.maxDuration) throw Error("\u905B\u9C7C\u65F6\u957F\u65E0\u6548");
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > FISHING_GAME.maxMoves) throw Error("\u905B\u9C7C\u64CD\u4F5C\u8BB0\u5F55\u65E0\u6548");
  let previous = -FISHING_GAME.minMoveGap, value = -1;
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[0]) || entry[0] < 0 || entry[0] > Number(duration) || entry[0] - previous < FISHING_GAME.minMoveGap || ![0, 1].includes(entry[1]) || entry[1] === value) throw Error("\u905B\u9C7C\u64CD\u4F5C\u987A\u5E8F\u65E0\u6548");
    previous = entry[0];
    value = entry[1];
  }
  if (raw[0][0] !== 0 || raw[0][1] !== 1) throw Error("\u8BF7\u4ECE\u63D0\u7AFF\u5F00\u59CB\u8BB0\u5F55\u64CD\u4F5C");
}

// src/farm/fishing-v3.ts
var require2 = (ok, message) => {
  if (!ok) throw Error(message);
};
var random = (max) => {
  const x = new Uint32Array(1), limit = Math.floor(4294967296 / max) * max;
  do {
    crypto.getRandomValues(x);
  } while (x[0] >= limit);
  return x[0] % max;
};
function roll(seed, salt, max) {
  let x = (seed ^ salt) >>> 0;
  x = Math.imul(x ^ x >>> 16, 2146121005);
  x = Math.imul(x ^ x >>> 15, 2221713035);
  return ((x ^ x >>> 16) >>> 0) % max;
}
function fields(a, keys) {
  require2(Object.keys(a).every((k) => k === "type" || keys.includes(k)), "\u64CD\u4F5C\u5305\u542B\u4E0D\u652F\u6301\u7684\u5B57\u6BB5");
}
function fishingV3Action(s, a, t) {
  const f = s.fishing;
  f.items ??= {};
  f.gear ??= { rod: 0 };
  if (a.type === "fish_rod_upgrade") {
    fields(a, []);
    require2(!f.cast || t > f.cast.expires, "\u8BF7\u5148\u5B8C\u6210\u8FD9\u4E00\u7AFF");
    const next = FISHING_RODS[f.gear.rod + 1];
    require2(next, "\u9C7C\u7AFF\u5DF2\u6EE1\u7EA7");
    require2(s.coins >= next.cost, "D\u5E01\u4E0D\u8DB3");
    s.coins -= next.cost;
    f.gear.rod = next.level;
    return "\u9C7C\u7AFF\u5347\u7EA7\u4E3A" + next.name;
  }
  if (a.type === "fish_craft_line") {
    fields(a, []);
    require2((f.items.reed ?? 0) >= 3, "\u7F16\u7EBF\u9700\u89813\u4EFD\u67D4\u97E7\u82A6\u82C7");
    require2((f.items.strong_line ?? 0) < 9999, "\u97E7\u4E1D\u7EBF\u5DF2\u6EE1");
    f.items.reed -= 3;
    f.items.strong_line = (f.items.strong_line ?? 0) + 1;
    return "\u7F16\u6210\u97E7\u4E1D\u7EBF \xD71";
  }
  if (a.type === "fish_cast") {
    fields(a, ["point", "bait", "line", "rods"]);
    const rods = a.rods === void 0 ? 1 : Number(a.rods);
    require2(typeof a.rods === "undefined" || typeof a.rods === "number", "\u9C7C\u7AFF\u6570\u91CF\u65E0\u6548");
    require2([1, 3, 5].includes(rods), "\u8BF7\u9009\u62E91\u30013\u62165\u6746");
    require2(!f.idle, "\u8BF7\u5148\u7ED3\u675F\u6302\u673A");
    require2(!f.cast || t > f.cast.expires, "\u8FD9\u4E00\u7AFF\u5C1A\u672A\u7ED3\u675F");
    require2(a.bait === void 0 || typeof a.bait === "boolean", "\u9C7C\u9975\u9009\u9879\u65E0\u6548");
    require2(a.line === void 0 || typeof a.line === "boolean", "\u9C7C\u7EBF\u9009\u9879\u65E0\u6548");
    const p = a.point ?? { x: 0.54, y: 0.48 };
    require2(p && typeof p === "object" && Object.keys(p).every((k) => ["x", "y"].includes(k)) && typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x - 0.5) + Math.abs(p.y - 0.5) <= 0.8, "\u843D\u70B9\u4E0D\u5728\u6C34\u9762\u5185");
    require2(s.coins >= 2 * rods, `\u672C\u6B21${rods}\u6746\u9700\u8981${2 * rods}\u679AD\u5E01`);
    if (a.bait) require2((f.items.river_bait ?? 0) >= rods, "\u6EAA\u866B\u9975\u4E0D\u8DB3\uFF0C\u6BCF\u6746\u6D88\u80171\u4EFD");
    if (a.line) require2((f.items.strong_line ?? 0) >= rods, "\u97E7\u4E1D\u7EBF\u4E0D\u8DB3\uFF0C\u6BCF\u6746\u6D88\u80171\u4EFD");
    if (f.cast) {
      f.escaped = (f.escaped ?? 0) + (f.cast.rods ?? 1);
      f.lastOutcome = { id: f.cast.id ?? "legacy", at: t, ok: false, label: "\u4E0A\u4E00\u7AFF\u5DF2\u8131\u94A9", kind: "escape" };
    }
    s.coins -= 2 * rods;
    if (a.bait) f.items.river_bait -= rods;
    if (a.line) f.items.strong_line -= rods;
    delete f.lastOutcomes;
    const biteAt = t + 5 + random(7);
    f.cast = { v: 3, rods, id: crypto.randomUUID(), _secret: random(2147483647), rod: f.gear.rod, line: a.line === true, bait: a.bait === true, point: { x: Number(p.x), y: Number(p.y) }, pattern: Array.from({ length: 12 }, () => 0.2 + random(81) / 100), started: t, biteAt, expires: biteAt + 12 };
    return `\u5DF2\u629B\u51FA${rods}\u6746\uFF0C\u7B49\u5F85\u6D6E\u6F02\u4E0B\u6C89\uFF1B\u5171\u540C\u6536\u653E\u7EBF\uFF0C\u6BCF\u6746\u72EC\u7ACB\u6389\u843D\u4E0E\u8131\u94A9`;
  }
  const cast = f.cast;
  if (cast?.v !== 3) return null;
  if (a.type === "fish_reel") {
    fields(a, ["castId"]);
    require2(a.castId === cast.id, "\u9C7C\u7AFF\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0");
    require2(!cast.reelAt && t >= cast.biteAt && t <= cast.expires, "\u8BF7\u5728\u6D6E\u6F02\u4E0B\u6C89\u65F6\u63D0\u7AFF");
    cast.reelAt = t;
    cast.expires = t + 26;
    return "\u5DF2\u94A9\u4F4F\uFF1A\u6309\u4F4F\u6536\u7EBF\uFF0C\u5F20\u529B\u5347\u9AD8\u65F6\u677E\u5F00\u653E\u7EBF";
  }
  if (a.type === "fish_abandon") {
    fields(a, ["castId"]);
    require2(a.castId === cast.id, "\u9C7C\u7AFF\u5DF2\u53D8\u5316");
    f.escaped = (f.escaped ?? 0) + (cast.rods ?? 1);
    f.lastOutcome = { id: cast.id, at: t, ok: false, label: "\u5DF2\u6536\u8D77\u9C7C\u7AFF\uFF0C\u672C\u7EC4\u672A\u83B7\u5F97\u7269\u54C1", kind: "escape" };
    delete f.cast;
    return f.lastOutcome.label;
  }
  if (a.type !== "fish_catch") return null;
  fields(a, ["castId", "moves", "duration"]);
  require2(a.castId === cast.id && cast.reelAt !== void 0, "\u8BF7\u5148\u5728\u54AC\u94A9\u65F6\u63D0\u7AFF");
  validateFishingMoves(a.moves, a.duration);
  const ms = Number(a.duration);
  require2(ms <= (t - cast.reelAt) * 1e3 + 1e3, "\u905B\u9C7C\u65F6\u95F4\u5C1A\u672A\u6EE1\u8DB3");
  const replay = fishingFrame(cast, a.moves, ms);
  require2(replay.status !== "playing" || t > cast.expires, "\u8BF7\u7EE7\u7EED\u905B\u9C7C\uFF0C\u5C1A\u672A\u6536\u670D");
  require2(Number.isSafeInteger(cast._secret), "\u9C7C\u7AFF\u72B6\u6001\u65E0\u6548\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458");
  const outcomes = [], fishItems = {};
  for (let rod = 0; rod < (cast.rods ?? 1); rod++) {
    const seed = rod === 0 ? cast._secret : roll(cast._secret, 1009 * rod, 2147483647), escaped = replay.status !== "landed" || t > cast.expires || roll(seed, 71, 100) < (cast.line ? 2 : 8);
    if (escaped) {
      f.escaped = (f.escaped ?? 0) + 1;
      f.lastOutcome = { id: cast.id, at: t, ok: false, label: replay.reason || "\u9C7C\u513F\u6700\u540E\u4E00\u6323\uFF0C\u8131\u94A9\u4E86", kind: "escape" };
      outcomes.push({ ...f.lastOutcome, id: cast.id + ":" + rod });
      continue;
    }
    const draw = roll(seed, 19, 100), fishLimit = cast.bait ? 60 : 70, base = draw - fishLimit;
    let kind = "fish", item = "", n = 1, label = "";
    if (draw < fishLimit) {
      const spec = FISH[roll(seed, 37, FISH.length)];
      require2((f.basket[spec.id] ?? 0) < 1e3, "\u9C7C\u7BD3\u5DF2\u6EE1\uFF0C\u6574\u7406\u540E\u53EF\u91CD\u8BD5\u672C\u6B21\u5165\u7BD3");
      item = spec.id;
      f.basket[item] = (f.basket[item] ?? 0) + 1;
      f.discovery[item] = (f.discovery[item] ?? 0) + 1;
      f.caught++;
      fishItems[item] = (fishItems[item] ?? 0) + 1;
      label = spec.name + " \xD71";
    } else if (base < 9) {
      kind = "crop";
      item = ["carrot", "cabbage", "wheat"][roll(seed, 51, 3)];
      require2(s.produce && (s.produce[item] ?? 0) < 1e4, "\u4F5C\u7269\u4ED3\u5DF2\u6EE1\uFF0C\u6574\u7406\u540E\u53EF\u91CD\u8BD5");
      s.produce[item] = (s.produce[item] ?? 0) + 1;
      addStock(s, "crop:" + item, "grown", 1);
      label = ["\u80E1\u841D\u535C", "\u5305\u83DC", "\u5C0F\u9EA6"][["carrot", "cabbage", "wheat"].indexOf(item)] + " \xD71";
    } else if (base < 16) {
      kind = "seeds";
      item = ["carrot", "cabbage", "wheat"][roll(seed, 55, 3)];
      n = 2;
      require2(s.seeds && (s.seeds[item] ?? 0) + n <= 1e4, "\u79CD\u5B50\u4ED3\u5DF2\u6EE1\uFF0C\u6574\u7406\u540E\u53EF\u91CD\u8BD5");
      s.seeds[item] = (s.seeds[item] ?? 0) + n;
      label = ["\u80E1\u841D\u535C", "\u5305\u83DC", "\u5C0F\u9EA6"][["carrot", "cabbage", "wheat"].indexOf(item)] + "\u79CD\u5B50 \xD72";
    } else if (base < 21) {
      kind = "coins";
      n = 3 + roll(seed, 61, 6);
      s.coins += n;
      label = "\u6C89\u5E95\u96F6\u94B1\u888B \xB7 " + n + " D\u5E01";
    } else if (draw === 99) {
      kind = "title";
      f.treasures = (f.treasures ?? 0) + 1;
      label = "\u83B7\u5F97\u300C\u9526\u9CA4\u9644\u4F53\u300D\u79F0\u53F7\u6210\u957F\u8FDB\u5EA6";
    } else {
      kind = "item";
      const def = FISHING_ITEMS[roll(seed, 43, FISHING_ITEMS.length)];
      item = def.id;
      require2((f.items[item] ?? 0) < 9999, "\u9053\u5177\u5305\u5DF2\u6EE1\uFF0C\u4F7F\u7528\u540E\u53EF\u91CD\u8BD5");
      f.items[item] = (f.items[item] ?? 0) + 1;
      label = def.name + " \xD71";
    }
    f.landed = (f.landed ?? 0) + 1;
    s.xp++;
    outcomes.push({ id: cast.id + ":" + rod, at: t, ok: true, label, kind, item, count: n });
  }
  if (Object.keys(fishItems).length) f.lastCatch = { at: t, items: fishItems };
  f.lastOutcomes = outcomes;
  const landed = outcomes.filter((x) => x.ok).length;
  f.lastOutcome = outcomes.length === 1 ? { ...outcomes[0], id: cast.id } : { id: cast.id, at: t, ok: landed > 0, kind: "batch", label: `${outcomes.length}\u6746\u6536\u8D77 \xB7 \u83B7\u5F97${landed}\u4EFD\u6536\u83B7 \xB7 \u8131\u94A9${outcomes.length - landed}\u6746` };
  delete f.cast;
  return f.lastOutcome.label;
}

// src/farm/leisure.ts
var PIGS = [
  { id: "dumpling", name: "\u56E2\u5B50\u732A", seconds: 14400, price: 80, sellPrice: 120, xp: 12, unlock: 0, color: "#e5acac" },
  { id: "huan", name: "\u6B22\u6B22\u6843\u6843\u732A", seconds: 14400, price: 80, sellPrice: 120, xp: 12, unlock: 0, color: "#d992a8" },
  { id: "banana", name: "\u5DE8\u8549\u5E03\u4E01\u732A", seconds: 28800, price: 140, sellPrice: 210, xp: 20, unlock: 100, color: "#dac17b" },
  { id: "linux", name: "L\u7AD9\u9ED1\u767D\u732A", seconds: 28800, price: 140, sellPrice: 210, xp: 20, unlock: 100, color: "#a6acb2" },
  { id: "holy", name: "\u795E\u4E86\u91D1\u94C3\u732A", seconds: 43200, price: 200, sellPrice: 300, xp: 30, unlock: 300, color: "#d6af66" },
  { id: "mole", name: "\u9B54\u4E86\u591C\u7ED2\u732A", seconds: 43200, price: 200, sellPrice: 300, xp: 30, unlock: 300, color: "#ac8fac" }
];
var LEISURE_RULES = { castCost: 2, biteWindow: 12, reelSeconds: 2, reelWindow: 6, idleHours: [2, 4, 8], idleInterval: 600, fishCapacity: 1e3, pigSlots: 6, feedPrice: 4, pigFeedUnits: 2, feedSeconds: 7200, maxFeedSeconds: 86400, starvationSeconds: 172800 };
var ensure = (ok, message) => {
  if (!ok) throw Error(message);
};
function fields2(a, allowed) {
  ensure(Object.keys(a).every((k) => k === "type" || allowed.includes(k)), "\u64CD\u4F5C\u5305\u542B\u4E0D\u652F\u6301\u7684\u5B57\u6BB5");
}
function count(n, max = 99) {
  ensure(typeof n === "number" && Number.isInteger(n) && n > 0 && n <= max, `\u6570\u91CF\u5E94\u4E3A1\u81F3${max}\u7684\u6574\u6570`);
  return n;
}
function random2(n) {
  const v = new Uint32Array(1), limit = Math.floor(4294967296 / n) * n;
  do {
    crypto.getRandomValues(v);
  } while (v[0] >= limit);
  return v[0] % n;
}
function projectLeisure(s, t) {
  s.fishing ??= { basket: {}, discovery: {}, caught: 0 };
  s.pigs ??= { animals: [], raised: 0, discovery: {} };
  for (const p of s.pigs.animals) {
    if (p.deadAt) continue;
    const spec = PIGS.find((c) => c.id === p.kind);
    if (!spec) continue;
    const grown = Math.max(0, Math.min(spec.seconds - p.growth, Math.min(t, p.fedUntil) - p.updatedAt));
    if (p.manure === void 0) {
      p.manure = 0;
      p.manureSeconds = 0;
    } else {
      const seconds = (p.manureSeconds ?? 0) + grown;
      p.manure = Math.min(12, p.manure + Math.floor(seconds / 7200));
      p.manureSeconds = seconds % 7200;
    }
    p.growth = Math.min(spec.seconds, p.growth + grown);
    p.updatedAt = t;
    if (t >= p.fedUntil + LEISURE_RULES.starvationSeconds) p.deadAt = p.fedUntil + LEISURE_RULES.starvationSeconds;
  }
}
function applyLeisureAction(s, a, t, allUnlocked = false) {
  projectLeisure(s, t);
  const f = s.fishing, p = s.pigs, r = LEISURE_RULES;
  if (String(a.type).startsWith("fish_")) {
    const message = fishingV3Action(s, a, t);
    if (message !== null) return message;
  }
  const pay = (n) => {
    ensure(s.coins >= n, "D\u5E01\u4F59\u989D\u4E0D\u8DB3");
    s.coins -= n;
  };
  const catchFish = (n) => {
    ensure(FISH.every((c) => (f.basket[c.id] ?? 0) + n <= r.fishCapacity), "\u9C7C\u7BD3\u7A7A\u95F4\u4E0D\u8DB3\uFF0C\u8BF7\u5148\u51FA\u552E\u9C7C\u83B7");
    const items = {};
    for (let i = 0; i < n; i++) {
      const c = FISH[random2(FISH.length)];
      items[c.id] = (items[c.id] ?? 0) + 1;
      f.basket[c.id] = (f.basket[c.id] ?? 0) + 1;
      f.discovery[c.id] = (f.discovery[c.id] ?? 0) + 1;
    }
    f.caught += n;
    f.lastCatch = { at: t, items };
    s.xp += n;
    return items;
  };
  if (a.type === "fish_reel") {
    fields2(a, []);
    ensure(f.cast && !f.cast.reelAt && t >= f.cast.biteAt && t <= f.cast.expires, "\u5F53\u524D\u4E0D\u80FD\u6536\u7EBF\uFF0C\u8BF7\u5728\u54AC\u94A9\u65F6\u64CD\u4F5C");
    f.cast.reelAt = t;
    f.cast.expires = t + r.reelWindow;
    return "\u9C7C\u513F\u4E0A\u94A9\uFF0C\u6309\u4F4F\u6536\u7EBF";
  }
  if (a.type === "fish_catch") {
    fields2(a, []);
    ensure(f.cast?.reelAt && t >= f.cast.reelAt + r.reelSeconds && t <= f.cast.expires, "\u6536\u7EBF\u65F6\u95F4\u672A\u6EE1\u8DB3\u6216\u9C7C\u513F\u5DF2\u8131\u94A9");
    const items = catchFish(1);
    delete f.cast;
    return "\u9493\u5230" + FISH.find((c) => items[c.id]).name + "\uFF0C\u5DF2\u653E\u5165\u9C7C\u7BD3";
  }
  if (a.type === "fish_idle") {
    fields2(a, ["hours"]);
    ensure(r.idleHours.includes(a.hours), "\u6302\u673A\u53EA\u80FD\u9009\u62E92\u30014\u62168\u5C0F\u65F6");
    ensure(!f.idle && (!f.cast || t > f.cast.expires), "\u8BF7\u5148\u7ED3\u675F\u5F53\u524D\u9493\u9C7C");
    const n = Number(a.hours) * 3600 / r.idleInterval;
    ensure(FISH.every((c) => (f.basket[c.id] ?? 0) + n <= r.fishCapacity), "\u9C7C\u7BD3\u7A7A\u95F4\u4E0D\u8DB3\uFF0C\u8BF7\u5148\u51FA\u552E");
    pay(n * r.castCost);
    delete f.cast;
    f.idle = { started: t, ends: t + Number(a.hours) * 3600, count: n };
    return "\u6302\u673A\u5DF2\u5F00\u59CB\uFF0C\u79BB\u7EBF\u7EE7\u7EED\u9493\u9C7C";
  }
  if (a.type === "fish_idle_claim") {
    fields2(a, []);
    ensure(f.idle, "\u6CA1\u6709\u8FDB\u884C\u4E2D\u7684\u6302\u673A");
    const n = Math.min(f.idle.count, Math.floor((t - f.idle.started) / r.idleInterval));
    ensure(n >= 1, "\u81F3\u5C11\u5B8C\u621010\u5206\u949F\u624D\u80FD\u6536\u53D6");
    catchFish(n);
    delete f.idle;
    return `\u6302\u673A\u7ED3\u675F\uFF0C\u9C7C\u7BD3\u65B0\u589E${n}\u6761\uFF1B\u672A\u7528\u9C7C\u9975\u4E0D\u9000\u6B3E`;
  }
  if (a.type === "fish_sell") {
    fields2(a, ["fish", "count"]);
    const c = FISH.find((x) => x.id === a.fish), n = count(a.count);
    ensure(c, "\u672A\u77E5\u9C7C\u79CD");
    ensure((f.basket[c.id] ?? 0) >= n, "\u9C7C\u83B7\u6570\u91CF\u4E0D\u8DB3");
    consumeLegacy(s, "fish:" + c.id, n);
    f.basket[c.id] -= n;
    s.coins += c.price * n;
    return `\u552E\u51FA${c.name} \xD7${n}`;
  }
  if (a.type === "pig_buy") {
    fields2(a, ["kind", "count"]);
    const c = PIGS.find((x) => x.id === a.kind), n = count(a.count, r.pigSlots);
    ensure(c, "\u672A\u77E5\u732A\u79CD");
    ensure(allUnlocked || s.xp >= c.unlock, "\u7ECF\u9A8C\u4E0D\u8DB3\uFF0C\u5C1A\u672A\u89E3\u9501");
    ensure(p.animals.length + n <= r.pigSlots, "\u732A\u680F\u4E0D\u8DB3\uFF0C\u8BF7\u5148\u51FA\u552E\u6210\u5E74\u732A\u6216\u6E05\u7406\u6B7B\u4EA1\u680F\u4F4D");
    pay(c.price * n);
    for (let i = 0; i < n; i++) p.animals.push({ id: crypto.randomUUID(), kind: c.id, growth: 0, fedUntil: t + r.feedSeconds, updatedAt: t, manure: 0, manureSeconds: 0 });
    return `\u8D2D\u5165${c.name}\u732A\u4ED4 \xD7${n}\uFF0C\u5DF2\u5E262\u5C0F\u65F6\u9972\u6599`;
  }
  if (["pig_feed", "pig_feed_stock", "pig_sell", "pig_remove", "pig_clean"].includes(String(a.type))) {
    fields2(a, a.type === "pig_feed_stock" ? ["pig", "count", "autoBuy"] : a.type === "pig_feed" ? ["pig", "count"] : ["pig"]);
    const pig = p.animals.find((x) => x.id === a.pig);
    ensure(pig, "\u732A\u680F\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0");
    const c = PIGS.find((x) => x.id === pig.kind);
    if (a.type === "pig_clean") {
      const message = compostManure(s, pig.manure ?? 0);
      pig.manure = 0;
      return message;
    }
    if (a.type === "pig_remove") {
      ensure(pig.deadAt, "\u53EA\u80FD\u6E05\u7406\u5DF2\u6B7B\u4EA1\u7684\u732A");
      p.animals = p.animals.filter((x) => x !== pig);
      return "\u5DF2\u6E05\u7406\u732A\u680F";
    }
    ensure(!pig.deadAt, "\u8FDE\u7EED\u7F3A\u7CAE48\u5C0F\u65F6\u5DF2\u6B7B\u4EA1\uFF0C\u8BF7\u6E05\u7406\u732A\u680F");
    if (a.type === "pig_feed" || a.type === "pig_feed_stock") {
      const n = count(a.count, 12), until = Math.max(t, pig.fedUntil) + n * r.feedSeconds;
      ensure(until - t <= r.maxFeedSeconds, "\u6700\u591A\u50A8\u590724\u5C0F\u65F6\u9972\u6599");
      if (a.type === "pig_feed_stock") {
        ensure(a.autoBuy === void 0 || typeof a.autoBuy === "boolean", "\u8865\u7CAE\u5F00\u5173\u65E0\u6548");
        ensure(s.ranch, "\u8BF7\u5148\u52A0\u8F7D\u7267\u573A");
        const missing = Math.max(0, n * r.pigFeedUnits - s.ranch.feed);
        if (a.autoBuy === true && missing) {
          pay(missing * RANCH_RULES.feedPrice);
          s.ranch.feed += missing;
        }
        ensure(s.ranch.feed >= n * r.pigFeedUnits, "\u9972\u6599\u5E93\u5B58\u4E0D\u8DB3");
        s.ranch.feed -= n * r.pigFeedUnits;
      } else pay(n * r.feedPrice);
      pig.fedUntil = until;
      return `\u5DF2\u6DFB\u7CAE\uFF0C\u589E\u52A0${n * 2}\u5C0F\u65F6\u9972\u6599`;
    }
    ensure(pig.growth >= c.seconds, "\u732A\u4ED4\u5C1A\u672A\u957F\u6210");
    s.coins += c.sellPrice;
    s.xp += c.xp;
    p.raised++;
    p.discovery[c.id] = (p.discovery[c.id] ?? 0) + 1;
    p.animals = p.animals.filter((x) => x !== pig);
    return `\u552E\u51FA\u6210\u5E74${c.name}`;
  }
  throw Error("\u4E0D\u652F\u6301\u7684\u9493\u9C7C\u6216\u732A\u573A\u64CD\u4F5C");
}

// src/farm/guardian.ts
var GUARDIANS = [
  { id: "deepseek", name: "DeepSeek \u9CB8\u9C7C\u5A18", color: "#83aebe", theme: "\u5DE1\u67E5", image: "/assets/farm/guardians/deepseek.webp" },
  { id: "gpt", name: "GPT Astra", color: "#91ad99", theme: "\u534F\u4F5C", image: "/assets/farm/guardians/gpt.webp" },
  { id: "claude", name: "Claude \u5A18", color: "#cba58c", theme: "\u7167\u6599", image: "/assets/farm/guardians/claude.webp" },
  { id: "gemini", name: "Gemini \u5A18", color: "#afa4ca", theme: "\u8B66\u6212", image: "/assets/farm/guardians/gemini.webp" }
];
var GUARDIAN_RULES = { maxCharges: 3, rechargeSeconds: 21600, skillCooldown: 1800, protectionSeconds: 900, maxCare: 6, maxLevel: 20 };
function guardianView(input, t) {
  if (!input) return null;
  const s = { ...input }, steps = Math.max(0, Math.floor((t - s.chargedAt) / GUARDIAN_RULES.rechargeSeconds));
  s.charges = Math.min(3, s.charges + steps);
  s.chargedAt = s.charges === 3 ? t : s.chargedAt + steps * GUARDIAN_RULES.rechargeSeconds;
  return { ...s, level: Math.min(20, 1 + Math.floor(s.careCount / 20)), nextCharge: s.charges === 3 ? null : s.chargedAt + GUARDIAN_RULES.rechargeSeconds };
}
function guardianAction(s, a, t) {
  const require3 = (ok, message) => {
    if (!ok) throw Error(message);
  };
  if (a.type === "guardian_select") {
    require3(Object.keys(a).every((k) => ["type", "id"].includes(k)) && GUARDIANS.some((g2) => g2.id === a.id), "\u5B88\u62A4\u517D\u4E0D\u5B58\u5728");
    const previous = guardianView(s.guardian, t);
    s.guardian = previous ? { ...previous, id: String(a.id) } : { id: String(a.id), stance: "patrol", charges: 3, chargedAt: t, skillAt: 0, protectionUntil: 0, careCount: 0 };
    return "\u5B88\u62A4\u517D\u5DF2\u5230\u5C97\uFF0C\u6210\u957F\u4E0E\u4E13\u6CE8\u503C\u7531\u56DB\u4E2A\u5F62\u8C61\u5171\u7528";
  }
  require3(s.guardian, "\u8BF7\u5148\u9009\u62E9\u5B88\u62A4\u517D");
  const g = s.guardian = guardianView(s.guardian, t);
  if (a.type === "guardian_stance") {
    require3(Object.keys(a).every((k) => ["type", "stance"].includes(k)) && ["patrol", "barrier", "decoy"].includes(String(a.stance)), "\u9632\u5B88\u7B56\u7565\u65E0\u6548");
    g.stance = a.stance;
    return "\u9632\u5B88\u7B56\u7565\u5DF2\u4FDD\u5B58";
  }
  require3(a.type === "guardian_skill" && Object.keys(a).every((k) => ["type", "skill"].includes(k)) && ["ward", "care"].includes(String(a.skill)), "\u5B88\u62A4\u6280\u80FD\u65E0\u6548");
  require3(t >= g.skillAt + GUARDIAN_RULES.skillCooldown, "\u5B88\u62A4\u6280\u80FD\u4ECD\u5728\u51B7\u5374");
  require3(g.charges > 0, "\u4E13\u6CE8\u503C\u4E0D\u8DB3\uFF0C\u6062\u590D\u540E\u53EF\u518D\u4F7F\u7528");
  if (a.skill === "ward") require3(g.protectionUntil <= t, "\u5B88\u62A4\u6B63\u5728\u751F\u6548");
  g.charges--;
  g.skillAt = t;
  g.careCount++;
  if (a.skill === "ward") {
    g.protectionUntil = t + GUARDIAN_RULES.protectionSeconds;
    g.penetrable = true;
  }
  return a.skill === "ward" ? "\u5B88\u62A4\u517D\u8B66\u621215\u5206\u949F\uFF1A\u62E6\u622A\u666E\u901A\u6458\u53D6\uFF0C\u6F5C\u5165\u6210\u529F\u7387\u964D\u81F340%" : "\u5B88\u62A4\u517D\u5B8C\u6210\u534F\u52A9\u7167\u6599";
}
function protectedUntil(s) {
  return Math.max(s.guardUntil ?? 0, s.guardSoftUntil ?? 0, s.guardian?.protectionUntil ?? 0);
}
function hardProtectionUntil(s) {
  return Math.max(s.guardUntil ?? 0, s.guardian?.penetrable ? 0 : s.guardian?.protectionUntil ?? 0);
}

// src/shared/crop-care.ts
var cropSeconds = (plot, crop) => plot.growSeconds ?? crop.legacySeconds ?? crop.seconds;
var CROP_CARE = { chance: 0.25, appearsAt: 0.35, delay: 0.1 };
function cropMaxSeconds(seconds) {
  return seconds + Math.ceil(seconds * CROP_CARE.delay);
}
function cropMatureAt(plot, crop) {
  const seconds = cropSeconds(plot, crop);
  return plot.wateredAt === null ? Infinity : Math.max(plot.readyNotBefore ?? 0, plot.wateredAt + seconds + (plot.pestAt === void 0 ? 0 : Math.ceil(seconds * CROP_CARE.delay)));
}
function cropHasPests(plot, crop, t) {
  return plot.pestAt !== void 0 && plot.wateredAt !== null && t >= plot.pestAt && t < cropMatureAt(plot, crop);
}
function cropProgress(plot, crop, t) {
  return plot.wateredAt === null ? 0 : Math.max(0, Math.min(1, (t - plot.wateredAt) / (cropMatureAt(plot, crop) - plot.wateredAt)));
}
function clearCropPests(plot, crop, t) {
  if (plot.wateredAt !== null && plot.wateredAt + cropSeconds(plot, crop) < t) plot.readyNotBefore = t;
  delete plot.pestAt;
}
function waterCrop(plot, crop, t) {
  plot.wateredAt = t;
  plot.growSeconds ??= crop.seconds;
  if (plot.careCycle === 1 && plot.cycle && parseInt(plot.cycle.slice(0, 2), 16) < 256 * CROP_CARE.chance) plot.pestAt = t + Math.floor(plot.growSeconds * CROP_CARE.appearsAt);
}

// src/farm/rules.ts
var FARM_VERSION = 2;
var ORIGINAL_CROPS = [
  { id: "carrot", name: "\u80E1\u841D\u535C", seconds: 60, seedPrice: 3, sellPrice: 7, xp: 5, unlock: 0, frame: 4 },
  { id: "cabbage", name: "\u5305\u83DC", seconds: 120, seedPrice: 5, sellPrice: 11, xp: 7, unlock: 20, frame: 5 },
  { id: "wheat", name: "\u5C0F\u9EA6", seconds: 180, seedPrice: 7, sellPrice: 16, xp: 9, unlock: 60, frame: 6 },
  { id: "tomato", name: "\u756A\u8304", seconds: 240, seedPrice: 10, sellPrice: 22, xp: 11, unlock: 120, frame: 7 },
  { id: "corn", name: "\u7389\u7C73", seconds: 360, seedPrice: 13, sellPrice: 30, xp: 14, unlock: 220, frame: 8 },
  { id: "pumpkin", name: "\u5357\u74DC", seconds: 600, seedPrice: 18, sellPrice: 45, xp: 18, unlock: 360, frame: 9 },
  { id: "jiba_banana", name: "\u51E0\u628A\u5DE8\u8549", seconds: 3600, seedPrice: 40, sellPrice: 80, xp: 25, unlock: 100, frame: 101 },
  { id: "naizi_peach", name: "\u67F0\u5B50\u871C\u6843", seconds: 7200, seedPrice: 60, sellPrice: 120, xp: 30, unlock: 180, frame: 102 },
  { id: "mole_mushroom", name: "\u9B54\u4E86\u83C7", seconds: 14400, seedPrice: 90, sellPrice: 180, xp: 40, unlock: 280, frame: 106 },
  { id: "meme_sunflower", name: "\u6897\u56FE\u8475", seconds: 28800, seedPrice: 120, sellPrice: 240, xp: 50, unlock: 380, frame: 108 },
  { id: "linux_pumpkin", name: "L\u7AD9\u5357\u74DC", seconds: 43200, seedPrice: 160, sellPrice: 320, xp: 65, unlock: 480, frame: 110 },
  { id: "deepseek_rice", name: "DeepSeek\u9CB8\u5C3E\u7A3B", seconds: 10800, seedPrice: 75, sellPrice: 150, xp: 35, unlock: 220, frame: 200 },
  { id: "claude_wheat", name: "Claude\u6696\u7A57", seconds: 14400, seedPrice: 90, sellPrice: 180, xp: 40, unlock: 280, frame: 201 },
  { id: "gpt_cabbage", name: "GPT\u7ED3\u7EF3\u83DC", seconds: 21600, seedPrice: 105, sellPrice: 210, xp: 45, unlock: 320, frame: 202 },
  { id: "gemini_berry", name: "Gemini\u53CC\u661F\u8393", seconds: 28800, seedPrice: 120, sellPrice: 240, xp: 50, unlock: 380, frame: 203 },
  { id: "qwen_cotton", name: "Qwen\u4E91\u68C9", seconds: 43200, seedPrice: 150, sellPrice: 300, xp: 60, unlock: 420, frame: 204 },
  { id: "kimi_bean", name: "Kimi\u6708\u82BD\u8C46", seconds: 21600, seedPrice: 105, sellPrice: 210, xp: 45, unlock: 320, frame: 205 },
  { id: "glm_bamboo", name: "GLM\u4E0A\u4E0B\u6587\u7AF9", seconds: 43200, seedPrice: 160, sellPrice: 320, xp: 65, unlock: 480, frame: 206 },
  { id: "grok_eggplant", name: "Grok\u591C\u8304", seconds: 28800, seedPrice: 120, sellPrice: 240, xp: 50, unlock: 380, frame: 207 },
  { id: "jev_pepper", name: "Jev\u662F\u975E\u6912", seconds: 7200, seedPrice: 60, sellPrice: 120, xp: 30, unlock: 180, frame: 210 }
];
var BASE_CROPS = ORIGINAL_CROPS.map((c) => ({ ...c, legacySeconds: c.seconds, seconds: Math.max(600, c.seconds) }));
var CROPS = [...BASE_CROPS, ...themeCrops(BASE_CROPS), ...communityCrops(BASE_CROPS)];
var TREE_KINDS = { oak: { name: "\u6A61\u6811", hits: 2, wood: 3, seconds: 180, frame: 2 }, pine: { name: "\u677E\u6811", hits: 3, wood: 5, seconds: 300, frame: 3 } };
var EXPANSIONS = FARM_EXPANSIONS;
var ACHIEVEMENTS = [
  { id: "first_harvest", name: "\u7B2C\u4E00\u7BEE\u6536\u6210", description: "\u7D2F\u8BA1\u6536\u83B72\u4EFD\u4F5C\u7269", kind: "harvest", target: 2, coins: 10 },
  { id: "woodworker", name: "\u6797\u95F4\u6765\u5BA2", description: "\u7D2F\u8BA1\u91C7\u96C612\u4EFD\u6728\u6750", kind: "wood", target: 12, coins: 15 },
  { id: "gardener", name: "\u52E4\u52B3\u56ED\u4E01", description: "\u7D2F\u8BA1\u64AD\u79CD24\u6B21", kind: "planted", target: 24, coins: 30 },
  { id: "harvester", name: "\u4E30\u6536\u65E5\u8BB0", description: "\u7D2F\u8BA1\u6536\u83B7100\u4EFD\u4F5C\u7269", kind: "harvest", target: 100, coins: 60 },
  { id: "naturalist", name: "\u7530\u56ED\u535A\u7269\u5BB6", description: "\u53D1\u73B08\u79CD\u7530\u56ED\u7269\u4EA7", kind: "discovery", target: 8, coins: 100 }
];
var emptyPlot = () => ({ tilled: false, crop: null, plantedAt: 0, wateredAt: null });
function newFarm(t) {
  const seeds = Object.fromEntries(CROPS.map((c) => [c.id, c.id === "carrot" ? 6 : 0]));
  return {
    version: 2,
    coins: 40,
    wood: 0,
    xp: 0,
    energy: 100,
    energyAt: t,
    drinkAt: 0,
    seeds,
    produce: Object.fromEntries(CROPS.map((c) => [c.id, 0])),
    plots: Array.from({ length: 6 }, emptyPlot),
    trees: [],
    discovery: {},
    achievements: [],
    totals: { harvest: 0, wood: 0, planted: 0 },
    receipts: []
  };
}
function projectFarm(input, t) {
  const s = structuredClone(input);
  if (s.version !== 1 && s.version !== FARM_VERSION) throw Error("\u5B58\u6863\u7248\u672C\u6682\u4E0D\u652F\u6301\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  s.ranch = projectRanch(s.ranch, t);
  projectLeisure(s, t);
  for (const crop of CROPS) {
    s.seeds[crop.id] ??= 0;
    s.produce[crop.id] ??= 0;
  }
  return s;
}
var requireCondition = (ok, message) => {
  if (!ok) throw Error(message);
};
function index(value, length) {
  requireCondition(typeof value === "number" && Number.isInteger(value) && value >= 0 && value < length, "\u76EE\u6807\u4E0D\u5B58\u5728");
  return value;
}
function count2(value) {
  requireCondition(typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 99, "\u6570\u91CF\u5E94\u4E3A1\u81F399\u7684\u6574\u6570");
  return value;
}
function fields3(a, allowed) {
  requireCondition(Object.keys(a).every((k) => k === "type" || allowed.includes(k)), "\u64CD\u4F5C\u5305\u542B\u4E0D\u652F\u6301\u7684\u5B57\u6BB5");
}
function applyFarmActions(input, actions, t, permissions = {}) {
  requireCondition(Number.isSafeInteger(t) && t > 0, "\u670D\u52A1\u5668\u65F6\u95F4\u65E0\u6548");
  const batchLimit = Math.max(20, input.plots.length, (input.ranch?.animals.length ?? 0) + (input.pigs?.animals.length ?? 0), Math.min(240, permissions.batchLimit ?? 0));
  requireCondition(Array.isArray(actions) && actions.length > 0 && actions.length <= batchLimit, `\u6BCF\u6279\u9700\u89811\u81F3${batchLimit}\u4E2A\u64CD\u4F5C`);
  const s = projectFarm(input, t), messages = [];
  const discover = (id, n) => {
    const old = s.discovery[id];
    s.discovery[id] = { firstAt: old?.firstAt ?? t, count: (old?.count ?? 0) + n };
  };
  for (const raw of actions) {
    requireCondition(!!raw && typeof raw === "object" && !Array.isArray(raw), "\u64CD\u4F5C\u683C\u5F0F\u65E0\u6548");
    const a = raw;
    if (["till", "plant", "water", "harvest", "uproot", "pest"].includes(String(a.type))) {
      fields3(a, a.type === "plant" ? ["plot", "crop", "autoBuy"] : ["plot"]);
      const p = s.plots[index(a.plot, s.plots.length)];
      if (a.type === "till") {
        requireCondition(!p.tilled, "\u8FD9\u5757\u5730\u5DF2\u7ECF\u5F00\u57A6");
        p.tilled = true;
        messages.push("\u571F\u5730\u5DF2\u5F00\u57A6");
      } else if (a.type === "plant") {
        requireCondition(p.tilled, "\u8BF7\u5148\u5F00\u57A6\u8FD9\u5757\u5730");
        requireCondition(!p.crop, "\u5730\u91CC\u5DF2\u7ECF\u6709\u4F5C\u7269");
        const crop = CROPS.find((c) => c.id === a.crop);
        requireCondition(crop, "\u672A\u77E5\u4F5C\u7269");
        requireCondition(permissions.allUnlocked || s.xp >= crop.unlock, "\u7ECF\u9A8C\u4E0D\u8DB3\uFF0C\u5C1A\u672A\u89E3\u9501\u8FD9\u79CD\u4F5C\u7269");
        requireCondition(a.autoBuy === void 0 || typeof a.autoBuy === "boolean", "\u81EA\u52A8\u8D2D\u4E70\u5F00\u5173\u65E0\u6548");
        if (a.autoBuy === true && s.seeds[crop.id] === 0) {
          requireCondition(s.coins >= crop.seedPrice, "D\u5E01\u4E0D\u8DB3\uFF0C\u672A\u5B8C\u6210\u672C\u6279\u64AD\u79CD");
          s.coins -= crop.seedPrice;
          s.seeds[crop.id]++;
          messages.push("\u8865\u4E70" + crop.name + "\u79CD\u5B50 \xD71");
        }
        requireCondition(s.seeds[crop.id] > 0, "\u79CD\u5B50\u4E0D\u8DB3\uFF0C\u8BF7\u5230\u5546\u5E97\u8865\u5145");
        s.seeds[crop.id]--;
        p.crop = crop.id;
        p.plantedAt = t;
        p.growSeconds = crop.seconds;
        p.wateredAt = null;
        p.cycle = crypto.randomUUID();
        p.careCycle = 1;
        delete p.pestAt;
        delete p.readyNotBefore;
        p.stolen = 0;
        s.totals.planted++;
        messages.push(crop.name + "\u5DF2\u64AD\u79CD");
      } else if (a.type === "uproot") {
        requireCondition(p.crop, "\u5730\u91CC\u8FD8\u6CA1\u6709\u4F5C\u7269");
        const crop = CROPS.find((c) => c.id === p.crop);
        p.crop = null;
        p.wateredAt = null;
        p.plantedAt = 0;
        delete p.cycle;
        delete p.stolen;
        delete p.boosted;
        delete p.careCycle;
        delete p.pestAt;
        delete p.readyNotBefore;
        delete p.growSeconds;
        messages.push("\u5DF2\u94F2\u9664" + crop.name + "\uFF0C\u571F\u5730\u4FDD\u7559\uFF0C\u79CD\u5B50\u4E0D\u8FD4\u8FD8");
      } else if (a.type === "water") {
        requireCondition(p.crop, "\u5730\u91CC\u8FD8\u6CA1\u6709\u4F5C\u7269");
        requireCondition(p.wateredAt === null, "\u5DF2\u7ECF\u6D47\u8FC7\u6C34\uFF0C\u5B89\u5FC3\u7B49\u5B83\u957F\u5927");
        waterCrop(p, CROPS.find((c) => c.id === p.crop), t);
        s.totals.watered = (s.totals.watered ?? 0) + 1;
        messages.push("\u6D47\u6C34\u5B8C\u6210\uFF0C\u5F00\u59CB\u751F\u957F");
      } else if (a.type === "pest") {
        const crop = CROPS.find((c) => c.id === p.crop);
        requireCondition(crop && cropHasPests(p, crop, t), "\u8FD9\u91CC\u6682\u65E0\u9700\u8981\u5904\u7406\u7684\u866B\u5BB3");
        clearCropPests(p, crop, t);
        s.totals.pestsCleared = (s.totals.pestsCleared ?? 0) + 1;
        messages.push("\u866B\u5BB3\u5DF2\u6E05\u9664\uFF0C\u6062\u590D\u539F\u751F\u957F\u8FDB\u5EA6");
      } else {
        requireCondition(p.crop, "\u5730\u91CC\u8FD8\u6CA1\u6709\u4F5C\u7269");
        requireCondition(p.wateredAt !== null, "\u8BF7\u5148\u6D47\u6C34");
        const crop = CROPS.find((c) => c.id === p.crop);
        requireCondition(t >= cropMatureAt(p, crop), "\u4F5C\u7269\u8FD8\u6CA1\u6709\u6210\u719F");
        const yieldCount = 2 - Math.min(1, Math.max(0, p.stolen ?? 0));
        s.produce[crop.id] += yieldCount;
        addStock(s, "crop:" + crop.id, "grown", yieldCount);
        s.xp += crop.xp;
        s.totals.harvest += yieldCount;
        discover(crop.id, yieldCount);
        p.crop = null;
        p.wateredAt = null;
        p.plantedAt = 0;
        delete p.cycle;
        delete p.stolen;
        delete p.boosted;
        delete p.careCycle;
        delete p.pestAt;
        delete p.readyNotBefore;
        delete p.growSeconds;
        messages.push("\u6536\u83B7" + crop.name + " \xD7" + yieldCount);
      }
    } else if (a.type === "farm_item") {
      fields3(a, a.item === "compost" ? ["item", "plot"] : ["item"]);
      const items = s.fishing?.items;
      requireCondition(["compost", "ward_charm", "feed_bundle"].includes(String(a.item)) && items && (items[String(a.item)] ?? 0) > 0, "\u9053\u5177\u4E0D\u8DB3");
      if (a.item === "compost") {
        const p = s.plots[index(a.plot, s.plots.length)], c = CROPS.find((c2) => c2.id === p.crop);
        requireCondition(c && p.wateredAt !== null && !p.boosted && t < cropMatureAt(p, c), "\u8BF7\u9009\u62E9\u5C1A\u672A\u52A0\u901F\u7684\u751F\u957F\u4E2D\u4F5C\u7269");
        p.wateredAt -= Math.min(Math.floor(cropSeconds(p, c) / 10), cropMatureAt(p, c) - t);
        p.boosted = true;
        messages.push("\u5DF2\u65BD\u7528\u6C34\u8349\u5806\u80A5\uFF0C\u6700\u591A\u7F29\u77ED\u539F\u751F\u957F\u65F6\u95F410%");
      } else if (a.item === "ward_charm") {
        requireCondition(protectedUntil(s) <= t, "\u5B88\u62A4\u4ECD\u5728\u751F\u6548\uFF0C\u4E0D\u6D88\u8017\u5DE1\u7530\u94C3");
        s.guardSoftUntil = t + 900;
        messages.push("\u5DE1\u7530\u94C3\u8B66\u621215\u5206\u949F\uFF1A\u62E6\u622A\u666E\u901A\u6458\u53D6\uFF0C\u6F5C\u5165\u6210\u529F\u7387\u964D\u81F340%");
      } else {
        requireCondition(s.ranch.feed + 6 <= 1e4, "\u9972\u6599\u4ED3\u5DF2\u6EE1");
        s.ranch.feed += 6;
        messages.push("\u6253\u5F00\u8C37\u7269\u5305\uFF0C\u7267\u573A\u9972\u6599 +6");
      }
      items[String(a.item)]--;
    } else if (typeof a.type === "string" && a.type.startsWith("guardian_")) {
      if (a.type === "guardian_skill" && a.skill === "care") {
        let cared = 0;
        for (const [i, p] of s.plots.entries()) {
          if (cared >= GUARDIAN_RULES.maxCare) break;
          if (permissions.lockedPlots?.includes(i)) continue;
          const c = CROPS.find((c2) => c2.id === p.crop);
          if (!c) continue;
          if (p.wateredAt === null) {
            waterCrop(p, c, t);
            cared++;
          } else if (cropHasPests(p, c, t)) {
            clearCropPests(p, c, t);
            cared++;
          }
        }
        for (const [i, animal] of (s.ranch?.animals ?? []).entries()) {
          if (cared >= GUARDIAN_RULES.maxCare || !s.ranch?.feed) break;
          if (!animal.deadAt && animal.fedUntil <= t) {
            applyRanchAction(s, { type: "animal_feed", animal: i, count: 1 }, t, permissions);
            cared++;
          }
        }
        for (const p of s.pigs?.animals ?? []) {
          if (cared >= GUARDIAN_RULES.maxCare || (s.ranch?.feed ?? 0) < LEISURE_RULES.pigFeedUnits) break;
          if (!p.deadAt && p.fedUntil <= t) {
            const spec = PIGS.find((c) => c.id === p.kind);
            if (spec && p.growth < spec.seconds) {
              applyLeisureAction(s, { type: "pig_feed_stock", pig: p.id, count: 1 }, t, permissions.allUnlocked);
              cared++;
            }
          }
        }
        for (const [i, a2] of (s.ranch?.animals ?? []).entries()) {
          if (cared >= GUARDIAN_RULES.maxCare) break;
          if (a2.manure) {
            applyRanchAction(s, { type: "animal_clean", animal: i }, t, permissions);
            cared++;
          }
        }
        for (const p of s.pigs?.animals ?? []) {
          if (cared >= GUARDIAN_RULES.maxCare) break;
          if (p.manure) {
            applyLeisureAction(s, { type: "pig_clean", pig: p.id }, t, permissions.allUnlocked);
            cared++;
          }
        }
        requireCondition(cared > 0, "\u6682\u65E0\u9700\u6D47\u6C34\u3001\u9A71\u866B\u3001\u6DFB\u7CAE\u6216\u6E05\u6D01\u7684\u76EE\u6807\uFF0C\u4E0D\u6D88\u8017\u4E13\u6CE8\u503C");
        messages.push(guardianAction(s, a, t) + `\uFF0C\u5171${cared}\u5904\uFF1B\u6DFB\u7CAE\u4F7F\u7528\u5DF2\u6709\u9972\u6599`);
      } else messages.push(guardianAction(s, a, t));
    } else if (a.type === "guard") {
      fields3(a, []);
      requireCondition(protectedUntil(s) <= t, "\u5B88\u62A4\u4ECD\u5728\u751F\u6548\uFF0C\u65E0\u9700\u91CD\u590D\u8D2D\u4E70");
      requireCondition(s.coins >= 30, "\u5B88\u62A4\u9700\u898130D\u5E01");
      s.coins -= 30;
      s.guardSoftUntil = t + 6 * 3600;
      messages.push("\u5168\u56ED\u5B88\u62A46\u5C0F\u65F6\uFF1A\u62E6\u622A\u666E\u901A\u6458\u53D6\uFF0C\u6F5C\u5165\u6210\u529F\u7387\u964D\u81F340%");
    } else if (a.type === "boost") {
      fields3(a, ["plot"]);
      const p = s.plots[index(a.plot, s.plots.length)], crop = CROPS.find((c) => c.id === p.crop);
      requireCondition(crop && p.wateredAt !== null, "\u8BF7\u9009\u62E9\u5DF2\u6D47\u6C34\u7684\u751F\u957F\u4E2D\u4F5C\u7269");
      requireCondition(!p.boosted, "\u6BCF\u832C\u4F5C\u7269\u53EA\u80FD\u52A0\u901F\u4E00\u6B21");
      requireCondition(t < cropMatureAt(p, crop), "\u4F5C\u7269\u5DF2\u6210\u719F\uFF0C\u65E0\u9700\u52A0\u901F");
      const cost = Math.max(2, Math.ceil(crop.seedPrice / 4));
      requireCondition(s.coins >= cost, `\u52A0\u901F\u9700\u8981${cost}D\u5E01`);
      s.coins -= cost;
      p.wateredAt -= Math.min(Math.floor(cropSeconds(p, crop) / 4), cropMatureAt(p, crop) - t);
      p.boosted = true;
      messages.push(crop.name + "\u5DF2\u52A0\u901F\uFF0C\u6700\u591A\u7F29\u77ED\u539F\u751F\u957F\u65F6\u95F4\u768425%");
    } else if (a.type === "chop" || a.type === "drink") {
      throw Error("\u6797\u5730\u4E0E\u4F53\u529B\u673A\u5236\u5DF2\u505C\u7528\uFF0C\u8BF7\u5237\u65B0\u519C\u573A");
    } else if (a.type === "buy" || a.type === "sell" || a.type === "seed_sell") {
      fields3(a, a.type === "sell" ? ["crop", "count", "source"] : ["crop", "count"]);
      const crop = CROPS.find((c) => c.id === a.crop);
      requireCondition(crop, "\u672A\u77E5\u4F5C\u7269");
      const n = count2(a.count);
      if (a.type === "buy") {
        requireCondition(permissions.allUnlocked || s.xp >= crop.unlock, "\u7ECF\u9A8C\u4E0D\u8DB3\uFF0C\u5C1A\u672A\u89E3\u9501\u8FD9\u79CD\u4F5C\u7269");
        requireCondition(s.coins >= crop.seedPrice * n, "D\u5E01\u4E0D\u8DB3");
        requireCondition(s.seeds[crop.id] + n <= 1e4, "\u79CD\u5B50\u5E93\u5B58\u5DF2\u6EE1");
        s.coins -= crop.seedPrice * n;
        s.seeds[crop.id] += n;
        messages.push("\u8D2D\u5165" + crop.name + "\u79CD\u5B50 \xD7" + n);
      } else if (a.type === "seed_sell") {
        requireCondition(s.seeds[crop.id] >= n, "\u79CD\u5B50\u6570\u91CF\u4E0D\u8DB3");
        s.seeds[crop.id] -= n;
        s.coins += Math.floor(crop.seedPrice / 2) * n;
        messages.push("\u552E\u51FA" + crop.name + "\u79CD\u5B50 \xD7" + n);
      } else {
        requireCondition(s.produce[crop.id] >= n, "\u6536\u6210\u6570\u91CF\u4E0D\u8DB3");
        if (!consumeLegacy(s, "crop:" + crop.id, n, a.source)) consumeStock(s, "crop:" + crop.id, s.produce[crop.id], n, a.source);
        s.produce[crop.id] -= n;
        s.coins += crop.sellPrice * n;
        messages.push("\u552E\u51FA" + crop.name + " \xD7" + n);
      }
    } else if (a.type === "expand") {
      fields3(a, []);
      const expansion = EXPANSIONS.find((x) => x.plots === s.plots.length);
      requireCondition(expansion, "\u5168\u90E8\u571F\u5730\u5DF2\u5F00\u653E");
      const { coins, xp } = expansion;
      requireCondition(permissions.allUnlocked || s.xp >= xp, `\u6269\u5EFA\u9700\u8981\u8FBE\u5230${xp}\u7ECF\u9A8C`);
      requireCondition(s.coins >= coins, `\u6269\u5EFA\u9700\u8981${coins}D\u5E01`);
      s.coins -= coins;
      s.plots.push(...Array.from({ length: 6 }, emptyPlot));
      messages.push("\u65B0\u589E6\u5757\u571F\u5730");
    } else if (["ranch_expand", "animal_buy", "feed_buy", "animal_feed", "animal_collect", "animal_clean", "animal_sell", "animal_remove", "product_sell"].includes(String(a.type))) {
      messages.push(applyRanchAction(s, a, t, permissions));
    } else if (typeof a.type === "string" && (a.type.startsWith("fish_") || a.type.startsWith("pig_"))) messages.push(applyLeisureAction(s, a, t, permissions.allUnlocked));
    else throw Error("\u4E0D\u652F\u6301\u7684\u519C\u573A\u64CD\u4F5C");
  }
  for (const goal of ACHIEVEMENTS) {
    if (goal.id === "woodworker") continue;
    const progress = goal.kind === "discovery" ? [...CROPS.map((c) => c.id), ...Object.keys(TREE_KINDS)].filter((id) => s.discovery[id]).length : s.totals[goal.kind];
    if (progress >= goal.target && !s.achievements.includes(goal.id)) {
      s.achievements.push(goal.id);
      s.coins += goal.coins;
      messages.push("\u8FBE\u6210\u300C" + goal.name + "\u300D\uFF0C\u{1F34C} +" + goal.coins);
    }
  }
  return { state: s, messages };
}

// src/shared/farm-badges.ts
var FARM_BADGES = [
  { id: "ranch_collected", name: "\u7267\u6B4C\u4E30\u6536", unit: "\u4EFD\u755C\u4EA7", levels: [10, 100, 1e3, 5e3, 2e4], tile: 10, tier: "fun", desc: "\u7D2F\u8BA1\u6536\u53D6\u755C\u4EA7\uFF0C\u7167\u6599\u7684\u65E5\u5E38\u6210\u4E3A\u7267\u573A\u8363\u8A89" },
  { id: "guardian_care", name: "\u62A4\u7075\u540C\u4F34", unit: "\u6B21\u534F\u4F5C", levels: [1, 20, 100, 300, 1e3], tile: 10, tier: "epic", desc: "\u5B88\u62A4\u517D\u6210\u529F\u65BD\u653E\u6280\u80FD\u7684\u7D2F\u8BA1\u6B21\u6570" },
  { id: "fishing_escaped", name: "\u8131\u94A9\u54F2\u5B66\u5BB6", unit: "\u6B21\u8131\u94A9", levels: [1, 10, 50, 200, 1e3], tile: 10, tier: "fun", desc: "\u9C7C\u513F\u6210\u529F\u9003\u8131\u7684\u6B21\u6570\uFF0C\u5931\u8D25\u4E5F\u7559\u4E0B\u6545\u4E8B" },
  { id: "fishing_discovery", name: "\u6C34\u57DF\u535A\u7269\u5BB6", unit: "\u79CD\u9C7C\u83B7", levels: [1, 5, 10, 16, 24], tile: 10, tier: "rare", desc: "\u9C7C\u7BD3\u56FE\u9274\u4E2D\u7D2F\u8BA1\u53D1\u73B0\u7684\u4E0D\u540C\u9C7C\u79CD" },
  { id: "farm_water", name: "\u671D\u9732\u56ED\u4E01", unit: "\u6B21\u6D47\u6C34", levels: [1, 24, 100, 500, 2e3], tile: 8, tier: "fun", desc: "\u66F4\u65B0\u540E\u6210\u529F\u6D47\u6C34\u6B21\u6570\uFF0C\u6279\u91CF\u64CD\u4F5C\u9010\u5757\u7D2F\u8BA1" },
  { id: "farm_pest", name: "\u62A4\u82D7\u5DE1\u5B98", unit: "\u6B21\u9664\u866B", levels: [1, 10, 50, 200, 1e3], tile: 8, tier: "rare", desc: "\u66F4\u65B0\u540E\u6210\u529F\u9664\u866B\u6B21\u6570" },
  { id: "fishing_landed", name: "\u542C\u6D6A\u9493\u5BA2", unit: "\u6B21\u905B\u9C7C", levels: [1, 20, 100, 500, 2e3], tile: 10, tier: "rare", desc: "\u6210\u529F\u5B8C\u6210\u573A\u666F\u905B\u9C7C 1 / 20 / 100 / 500 / 2000 \u6B21\u5347\u7EA7" },
  { id: "fishing_treasure", name: "\u9526\u9CA4\u9644\u4F53", unit: "\u6B21\u79D8\u85CF", levels: [1, 3, 10, 30, 100], tile: 10, tier: "epic", desc: "\u624B\u52A8\u9493\u83B7\u7A00\u6709\u79F0\u53F7\u79D8\u85CF 1 / 3 / 10 / 30 / 100 \u6B21\u5347\u7EA7" },
  { id: "farm_plant", name: "\u79CD\u7530\u9AD8\u624B", unit: "\u6B21\u64AD\u79CD", levels: [1, 24, 100, 500, 2e3], tile: 8, tier: "fun", desc: "\u7D2F\u8BA1\u64AD\u79CD 1 / 24 / 100 / 500 / 2000 \u6B21\u5347\u7EA7\uFF0C\u5DF2\u6709\u64AD\u79CD\u8FDB\u5EA6\u4FDD\u7559" },
  { id: "farm_steal", name: "\u987A\u624B\u6458\u661F", unit: "\u4EFD\u6458\u53D6", levels: [1, 10, 50, 200, 1e3], tile: 10, tier: "rare", desc: "\u7D2F\u8BA1\u6458\u53D6\u4F5C\u7269\u6216\u755C\u4EA7 1 / 10 / 50 / 200 / 1000 \u4EFD\u5347\u7EA7\uFF1B\u4ECE2026\u5E7410\u670822\u65E5\u65B0\u7248\u6210\u529F\u64CD\u4F5C\u8D77\u7D2F\u8BA1" },
  { id: "farm_harvest", name: "\u6536\u6210\u8BB0\u4E8B", unit: "\u4EFD\u6536\u6210", levels: [2, 20, 100, 500, 2e3], tile: 8, tier: "fun", desc: "\u4E91\u5B58\u6863\u7D2F\u8BA1\u6536\u83B7 2 / 20 / 100 / 500 / 2000 \u4EFD\u4F5C\u7269\u5347\u7EA7" },
  { id: "farm_wood", name: "\u6797\u95F4\u6536\u85CF", unit: "\u4EFD\u6728\u6750", levels: [12, 50, 200, 800, 3e3], tile: 9, tier: "rare", desc: "\u4E91\u5B58\u6863\u7D2F\u8BA1\u91C7\u96C6 12 / 50 / 200 / 800 / 3000 \u4EFD\u6728\u6750\u5347\u7EA7" },
  { id: "farm_discovery", name: "\u7530\u56ED\u56FE\u9274", unit: "\u79CD\u7269\u79CD", levels: [1, 2, 4, 6, 8], tile: 10, tier: "epic", desc: "\u53D1\u73B0 1 / 2 / 4 / 6 / 8 \u79CD\u4F5C\u7269\u4E0E\u6811\u6728\u5347\u7EA7\uFF1B\u7EDF\u8BA1\u6240\u6709\u5DF2\u4E0A\u7EBF\u4F5C\u7269\u4E0E\u5386\u53F2\u6811\u6728" }
];
var species = /* @__PURE__ */ new Set([...CROPS.map((c) => c.id), ...Object.keys(TREE_KINDS)]);
var count3 = (n) => Number.isSafeInteger(n) && Number(n) >= 0 ? Number(n) : 0;
function farmBadgeProgress(raw) {
  let s = raw;
  if (typeof raw === "string") {
    try {
      s = JSON.parse(raw);
    } catch {
      s = null;
    }
  }
  if (s?.version !== 1 && s?.version !== 2) s = null;
  const discovery = s?.discovery && typeof s.discovery === "object" && !Array.isArray(s.discovery) ? s.discovery : {};
  return { ranch_collected: count3(s?.ranch?.collected), guardian_care: count3(s?.guardian?.careCount), fishing_escaped: count3(s?.fishing?.escaped), fishing_discovery: Object.values(s?.fishing?.discovery ?? {}).filter((v) => count3(v) > 0).length, farm_water: count3(s?.totals?.watered), farm_pest: count3(s?.totals?.pestsCleared), fishing_landed: count3(s?.fishing?.landed), fishing_treasure: count3(s?.fishing?.treasures), farm_plant: count3(s?.totals?.planted), farm_steal: count3(s?.totals?.stolen), farm_harvest: count3(s?.totals?.harvest), farm_wood: count3(s?.totals?.wood), farm_discovery: Object.entries(discovery).filter(([id, v]) => species.has(id) && count3(v?.count) > 0 && count3(v?.firstAt) > 0).length };
}

// src/farm/badges.ts
function farmBadgeStatements(db, uid, state, revision, t, previous) {
  const progress = farmBadgeProgress(state), day = new Date(t * 1e3 + 8 * 36e5).toISOString().slice(0, 10);
  const before = previous === void 0 ? null : farmBadgeProgress(previous);
  const awards = FARM_BADGES.filter((b) => progress[b.id] >= b.levels[0] && (!before || progress[b.id] > before[b.id]));
  if (!awards.length) return [];
  return [
    ...awards.map((b) => db.prepare(`INSERT INTO user_badges(user_id,badge,n,first_at,last_day)
    SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM farm_saves f JOIN users u ON u.id=f.user_id
      WHERE f.user_id=?1 AND f.revision=?6 AND f.state=?7 AND u.disabled=0 AND u.kind='user')
    ON CONFLICT(user_id,badge) DO UPDATE SET n=excluded.n,last_day=MAX(user_badges.last_day,excluded.last_day)
    WHERE user_badges.n<excluded.n`).bind(uid, b.id, progress[b.id], t, day, revision, state)),
    ...awards.filter((b) => !before || b.levels.some((n) => before[b.id] < n && progress[b.id] >= n)).map((b) => db.prepare(`INSERT OR IGNORE INTO user_unlocks(user_id,item,at)
    SELECT ?1,?2||':'||(CAST(j.key AS INTEGER)+1),?3 FROM json_each(?4) j WHERE j.value<=?5
      AND EXISTS(SELECT 1 FROM farm_saves f JOIN users u ON u.id=f.user_id WHERE f.user_id=?1 AND f.revision=?6 AND f.state=?7 AND u.disabled=0 AND u.kind='user')`).bind(uid, b.id, t, JSON.stringify(b.levels), progress[b.id], revision, state)),
    db.prepare(`UPDATE users SET deco=json_set(deco,'$.bn',(SELECT n FROM user_badges WHERE user_id=?1 AND badge=json_extract(users.deco,'$.bd')))
    WHERE id=?1 AND disabled=0 AND kind='user' AND json_valid(deco)
      AND json_extract(deco,'$.bd') IN (${FARM_BADGES.map((b) => "'" + b.id + "'").join(",")})
      AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?2 AND state=?3)
      AND EXISTS(SELECT 1 FROM user_badges WHERE user_id=?1 AND badge=json_extract(users.deco,'$.bd') AND n!=COALESCE(json_extract(users.deco,'$.bn'),0))`).bind(uid, revision, state)
  ];
}

// src/farm/visit-rules.ts
var VISIT_RULES = { maxTargets: 84, cooldown: 60, pairCooldown: 300, growth: 0.5, feeRate: 0.25, chance: 0.7, guardedChance: 0.4 };
var visitFee = (price) => Math.max(1, Math.ceil(price * VISIT_RULES.feeRate));

// src/farm/social.ts
var FARM_PROTECTION_SECONDS = 5;
function cropSneakOffer(s, p, t) {
  const c = CROPS.find((c2) => c2.id === p.crop);
  if (!c || !p.cycle || p.stolen || p.wateredAt === null || (p.leaseUntil ?? 0) > t || hardProtectionUntil(s) > t || cropProgress(p, c, t) < VISIT_RULES.growth) return null;
  const mature = cropMatureAt(p, c), early = t < mature, guarded = protectedUntil(s) > t;
  if (!early && (t < mature + FARM_PROTECTION_SECONDS || !guarded)) return null;
  return { fee: visitFee(c.sellPrice), chance: guarded ? VISIT_RULES.guardedChance : VISIT_RULES.chance, early, guarded, name: c.name };
}
function ranchSneakOffer(s, a, t) {
  const c = ANIMALS.find((c2) => c2.id === a.kind);
  if (!c || a.deadAt !== void 0 || !a.id || hardProtectionUntil(s) > t || a.stolenEpoch === a.productionEpoch) return null;
  const guarded = protectedUntil(s) > t, next = a.producedAt + c.seconds, early = a.stored < 2;
  if (early) {
    if (a.stored < 1 || a.fedUntil < next || t < a.producedAt + c.seconds * VISIT_RULES.growth || t >= next) return null;
  } else if (!guarded || t < (a.productionEpoch ?? t) + FARM_PROTECTION_SECONDS) return null;
  return { fee: visitFee(c.sellPrice), chance: guarded ? VISIT_RULES.guardedChance : VISIT_RULES.chance, early, guarded, name: c.product };
}
function publicFarm(state, t) {
  const ranch = projectRanch(state.ranch, t), guarded = protectedUntil(state) > t;
  return { guard_until: protectedUntil(state), hard_guard_until: hardProtectionUntil(state), visit_rules: VISIT_RULES, ranch: { animals: ranch.animals.map((a, index2) => ({ id: a.id, index: index2, kind: a.kind, fedUntil: a.fedUntil, producedAt: a.producedAt, stored: a.stored, ...a.deadAt !== void 0 ? { deadAt: a.deadAt } : {}, cycle: `${a.id}:${a.productionEpoch}`, sneak: ranchSneakOffer(state, a, t), status: a.deadAt !== void 0 ? "dead" : a.stored < 2 ? "reserved" : guarded ? "guarded" : t < (a.productionEpoch ?? t) + FARM_PROTECTION_SECONDS ? "protected" : a.stolenEpoch === a.productionEpoch ? "reserved" : "stealable" })) }, plots: state.plots.map((p, index2) => {
    const crop = CROPS.find((c) => c.id === p.crop), matureAt = crop && p.wateredAt !== null ? cropMatureAt(p, crop) : null;
    const status = !crop ? "empty" : (p.leaseUntil ?? 0) > t ? "reserved" : p.wateredAt === null ? "dry" : t < matureAt ? "growing" : !p.cycle ? "legacy" : guarded ? "guarded" : t < matureAt + FARM_PROTECTION_SECONDS ? "protected" : p.stolen ? "reserved" : "stealable";
    return { index: index2, tilled: p.tilled, crop: p.crop, cycle: p.cycle ?? null, wateredAt: p.wateredAt, growSeconds: p.growSeconds, pestAt: p.pestAt, readyNotBefore: p.readyNotBefore, mature_at: matureAt, protected_until: matureAt === null ? null : matureAt + FARM_PROTECTION_SECONDS, remaining: crop ? 2 - (p.stolen ?? 0) : 0, status, sneak: cropSneakOffer(state, p, t) };
  }) };
}
function applyFarmVisit(ownerInput, visitorInput, a, t, intrusion = false) {
  const require3 = (ok, message) => {
    if (!ok) throw Error(message);
  };
  require3(Number.isSafeInteger(t) && t > 0, "\u670D\u52A1\u5668\u65F6\u95F4\u65E0\u6548");
  require3(a.type === "water" || a.type === "steal", "\u4E0D\u652F\u6301\u7684\u4E92\u8BBF\u64CD\u4F5C");
  require3(Number.isInteger(a.plot) && a.plot >= 0 && a.plot < ownerInput.plots.length, "\u76EE\u6807\u4E0D\u5B58\u5728");
  const owner = structuredClone(ownerInput), visitor = projectFarm(visitorInput, t), p = owner.plots[a.plot];
  require3(p.crop, "\u5730\u91CC\u8FD8\u6CA1\u6709\u4F5C\u7269");
  require3(p.cycle, "\u65E7\u4F5C\u7269\u4FDD\u62A4\u4E2D\uFF0C\u672C\u832C\u4EC5\u4E3B\u4EBA\u53EF\u64CD\u4F5C");
  require3(a.cycle === p.cycle, "\u8FD9\u832C\u4F5C\u7269\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u5237\u65B0\u519C\u573A");
  const crop = CROPS.find((c) => c.id === p.crop);
  if (a.type === "water") {
    require3(p.wateredAt === null, "\u5DF2\u7ECF\u6D47\u8FC7\u6C34\uFF0C\u65E0\u9700\u91CD\u590D\u64CD\u4F5C");
    waterCrop(p, crop, t);
  } else {
    require3((p.leaseUntil ?? 0) <= t, "\u51FA\u79DF\u4E2D\u5730\u5757\u4E0D\u80FD\u6458\u53D6");
    if (intrusion) require3(cropSneakOffer(owner, p, t), "\u76EE\u6807\u672A\u8FBE\u5230\u6F5C\u5165\u6761\u4EF6\u6216\u4ECD\u53D7\u65E7\u5B88\u62A4\u4FDD\u62A4");
    else {
      require3(protectedUntil(owner) <= t, "\u519C\u573A\u5B88\u62A4\u751F\u6548\u4E2D\uFF0C\u6682\u4E0D\u53EF\u6458\u53D6");
      require3(p.wateredAt !== null && t >= cropMatureAt(p, crop), "\u4F5C\u7269\u8FD8\u6CA1\u6709\u6210\u719F");
      require3(t >= cropMatureAt(p, crop) + FARM_PROTECTION_SECONDS, "\u4F5C\u7269\u4ECD\u5728\u6210\u719F\u4FDD\u62A4\u671F");
    }
    require3(!p.stolen, "\u5269\u4F59\u6536\u6210\u5DF2\u4E3A\u4E3B\u4EBA\u4FDD\u7559");
    require3(visitor.produce[crop.id] < 1e4, "\u6536\u6210\u5E93\u5B58\u5DF2\u6EE1\uFF0C\u8BF7\u5148\u6574\u7406\u80CC\u5305");
    p.stolen = 1;
    visitor.produce[crop.id]++;
    addStock(visitor, "crop:" + crop.id, "stolen", 1);
    visitor.totals.stolen = Math.min(Number.MAX_SAFE_INTEGER, (visitor.totals.stolen || 0) + 1);
  }
  return { owner, visitor, crop: crop.id, amount: a.type === "steal" ? 1 : 0, message: a.type === "steal" ? `\u6458\u53D6${crop.name} \xD71\uFF0C\u5DF2\u653E\u5165\u80CC\u5305` : `\u5DF2\u5E2E\u5FD9\u6D47\u6C34\uFF0C${crop.name}\u5F00\u59CB\u751F\u957F` };
}
function applyRanchVisit(ownerInput, visitorInput, a, t, intrusion = false) {
  const require3 = (ok, message) => {
    if (!ok) throw Error(message);
  };
  require3(Number.isSafeInteger(t) && t > 0, "\u670D\u52A1\u5668\u65F6\u95F4\u65E0\u6548");
  const owner = projectFarm(ownerInput, t), visitor = projectFarm(visitorInput, t), ranch = owner.ranch, index2 = ranch.animals.findIndex((x) => x.id === a.animal_id), animal = ranch.animals[index2];
  require3(a.type === "animal_steal" && animal, "\u52A8\u7269\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u7267\u573A");
  require3(a.cycle === `${animal.id}:${animal.productionEpoch}`, "\u4EA7\u51FA\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u5237\u65B0\u7267\u573A");
  require3(animal.deadAt === void 0, "\u8FD9\u53EA\u52A8\u7269\u5DF2\u6B7B\u4EA1\uFF0C\u5DF2\u6709\u755C\u4EA7\u4EC5\u4E3B\u4EBA\u53EF\u6536\u53D6");
  const offer = intrusion ? ranchSneakOffer(owner, animal, t) : null;
  if (intrusion) require3(offer, "\u76EE\u6807\u672A\u8FBE\u5230\u6F5C\u5165\u6761\u4EF6\u6216\u4ECD\u53D7\u65E7\u5B88\u62A4\u4FDD\u62A4");
  else {
    require3(protectedUntil(owner) <= t, "\u7267\u573A\u5B88\u62A4\u751F\u6548\u4E2D\uFF0C\u6682\u4E0D\u53EF\u6458\u53D6");
    require3(animal.stored >= 2, "\u81F3\u5C11\u4E3A\u4E3B\u4EBA\u4FDD\u7559\u4E00\u4EFD\u755C\u4EA7");
    require3(t >= (animal.productionEpoch ?? t) + FARM_PROTECTION_SECONDS, "\u755C\u4EA7\u4ECD\u5728\u4FDD\u62A4\u671F");
  }
  require3(animal.stolenEpoch !== animal.productionEpoch, "\u672C\u8F6E\u4EA7\u51FA\u5DF2\u88AB\u6458\u53D6\uFF0C\u7B49\u5F85\u65B0\u7684\u4EA7\u51FA");
  const spec = ANIMALS.find((x) => x.id === animal.kind), inventory = visitor.ranch.products;
  require3((inventory[spec.id] ?? 0) < 1e4, "\u755C\u4EA7\u4ED3\u5DF2\u6EE1");
  if (offer?.early) {
    animal.producedAt += spec.seconds;
    animal.productionEpoch = animal.producedAt;
  } else animal.stored--;
  animal.stolenEpoch = animal.productionEpoch;
  inventory[spec.id] = (inventory[spec.id] ?? 0) + 1;
  addStock(visitor, "animal:" + spec.id, "stolen", 1);
  visitor.totals.stolen = Math.min(Number.MAX_SAFE_INTEGER, (visitor.totals.stolen || 0) + 1);
  return { owner, visitor, index: index2, crop: spec.id, amount: 1, message: `\u6458\u53D6${spec.product} \xD71\uFF0C\u5DF2\u653E\u5165\u80CC\u5305` };
}

// src/farm/compensation.ts
function farmCompensation(state, revision) {
  if (state.version !== 1 || revision === 0) return 0;
  return 100 + Math.min(1e3, Math.floor(state.xp / 100) * 25) + Math.min(500, Math.floor(state.coins / 1e3) * 10) + Math.max(0, state.plots.length - 6) * 10;
}

// src/farm/wallet.ts
var query = `SELECT f.revision,f.state,f.updated_at,w.balance,w.revision AS wallet_revision,m.user_id AS migrated FROM farm_saves f LEFT JOIN coin52_wallets w ON w.user_id=f.user_id LEFT JOIN farm_migrations m ON m.user_id=f.user_id WHERE f.user_id=?`;
async function farmWallet(db, userId, t) {
  for (let retry = 0; retry < 3; retry++) {
    const row = await db.prepare(query).bind(userId).first();
    if (!row) return null;
    if (row.migrated !== null) return row;
    if (row.balance === null) {
      await db.prepare("INSERT OR IGNORE INTO coin52_wallets(user_id,updated_at) VALUES(?,?)").bind(userId, t).run();
      continue;
    }
    const old = JSON.parse(row.state), bonus = farmCompensation(old, row.revision), sum = old.coins + bonus, balance = row.balance + sum;
    if (!Number.isSafeInteger(balance) || balance < 0) throw Error("\u519C\u573A\u4F59\u989D\u5F02\u5E38\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u6838\u5BF9");
    const state = { ...old, version: 2, coins: balance }, attempt = crypto.randomUUID(), revisionStep = row.revision > 0 ? 1 : 0;
    const result = await db.batch([
      db.prepare(`INSERT OR IGNORE INTO farm_migrations(user_id,version,original_revision,original_state,imported_coins,compensation,attempt,created_at)
    SELECT ?1,'farm-v2-20261020',?2,?3,?4,?5,?6,?7 WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?2)
    AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND revision=?8)
    AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND kind='user' AND disabled=0)
    AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1) RETURNING user_id`).bind(userId, row.revision, row.state, old.coins, bonus, attempt, t, row.wallet_revision),
      db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?,'farm-import','farm-v2-20261020',?,?,?,? WHERE EXISTS(SELECT 1 FROM farm_migrations WHERE attempt=?)`).bind(userId, attempt, old.coins, row.balance + old.coins, t, attempt),
      db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?,'farm-compensation','farm-v2-20261020',?,?,?,? WHERE ?>0 AND EXISTS(SELECT 1 FROM farm_migrations WHERE attempt=?)`).bind(userId, attempt + "-bonus", bonus, balance, t, bonus, attempt),
      db.prepare(`UPDATE coin52_wallets SET balance=?,revision=revision+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM farm_migrations WHERE attempt=?)`).bind(balance, t, userId, attempt),
      db.prepare(`UPDATE farm_saves SET state=?,revision=revision+?,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM farm_migrations WHERE attempt=?)`).bind(JSON.stringify(state), revisionStep, t, userId, attempt)
    ]);
    if (result[0].results.length) return { ...row, state: JSON.stringify(state), revision: row.revision + revisionStep, updated_at: t, balance, wallet_revision: row.wallet_revision + 1, migrated: userId };
  }
  throw Error("\u519C\u573A\u6B63\u5728\u540C\u6B65\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
}
function farmWalletActionStatements(db, p) {
  return [
    db.prepare(`INSERT OR IGNORE INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT ?1,'farm-action',?2,?3,?4,?5,?6 WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?7)
    AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND revision=?8)
    AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND disabled=0 AND kind='user')
    AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1) RETURNING id`).bind(p.userId, p.id, p.attempt, p.balance - p.row.balance, p.balance, p.t, p.row.revision, p.row.wallet_revision),
    db.prepare(`UPDATE coin52_wallets SET balance=?,revision=revision+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM coin52_ledger WHERE user_id=? AND attempt=?)`).bind(p.balance, p.t, p.userId, p.userId, p.attempt),
    db.prepare(`UPDATE farm_saves SET state=?1,revision=revision+1,updated_at=?2,owner_operated_at=?2 WHERE user_id=?3 AND EXISTS(SELECT 1 FROM coin52_ledger WHERE user_id=?3 AND attempt=?4) RETURNING revision,state,updated_at`).bind(p.encoded, p.t, p.userId, p.attempt)
  ];
}

// src/farm/market-stock.ts
var MARKET_ITEMS = [
  ...CROPS.map((c) => ({ key: "crop:" + c.id, id: c.id, kind: "crop", name: c.name, price: c.sellPrice, seconds: c.seconds, frame: c.frame })),
  ...ANIMALS.map((c) => ({ key: "animal:" + c.id, id: c.id, kind: "animal", name: c.product, price: c.sellPrice, seconds: c.seconds, frame: c.frame })),
  ...FISH.map((c) => ({ key: "fish:" + c.id, id: c.id, kind: "fish", name: c.name, price: c.price, seconds: 3600, frame: c.frame }))
];
function inventoryCounts(s) {
  return Object.fromEntries(MARKET_ITEMS.map((i) => [i.key, i.kind === "crop" ? s.produce[i.id] ?? 0 : i.kind === "animal" ? s.ranch?.products[i.id] ?? 0 : s.fishing?.basket[i.id] ?? 0]));
}
function changeInventory(s, key, n) {
  const spec = MARKET_ITEMS.find((i) => i.key === key);
  if (!spec) throw Error("\u5546\u54C1\u4E0D\u5B58\u5728");
  const store = spec.kind === "crop" ? s.produce : spec.kind === "animal" ? s.ranch?.products : s.fishing?.basket;
  const next = (store?.[spec.id] ?? 0) + n;
  if (!store || !Number.isSafeInteger(n) || !Number.isSafeInteger(next) || next < 0 || n > 0 && next > (spec.kind === "fish" ? 1e3 : 1e4)) throw Error("\u4ED3\u5E93\u6570\u91CF\u4E0D\u8DB3\u6216\u5DF2\u6EE1");
  store[spec.id] = next;
}
function marketStockStatements(db, p) {
  if (!p.after.market) return [];
  const before = inventoryCounts(p.before), after = inventoryCounts(p.after), born = Math.floor(p.t / 600) * 600;
  const entries = MARKET_ITEMS.flatMap((i) => {
    const legacyUsed = (p.before.market?.legacy[i.key] ?? 0) - (p.after.market?.legacy[i.key] ?? 0);
    const n = (after[i.key] ?? 0) - (before[i.key] ?? 0) + Math.max(0, legacyUsed);
    if (n <= 0) return [];
    const old = stockBreakdown(p.before, i.key, before[i.key] ?? 0), next = stockBreakdown(p.after, i.key, after[i.key] ?? 0);
    const legacyStolen = (p.before.market?.legacyOrigins[i.key]?.stolen ?? 0) - (p.after.market?.legacyOrigins[i.key]?.stolen ?? 0);
    const stolen = Math.min(n, Math.max(0, next.stolen - old.stolen + Math.max(0, legacyStolen)));
    return [["grown", n - stolen], ["stolen", stolen]].filter(([, q]) => q > 0).map(([source, quantity]) => ({ id: crypto.randomUUID(), item: i.key, source, quantity, base: i.price * 100, born, expires: born + shelfLife(i.seconds) }));
  });
  return marketLotStatements(db, { userId: p.userId, entries, t: born, gate: p.gate, bindings: p.bindings });
}
function marketLotStatements(db, p) {
  if (!p.entries.length) return [];
  const data = JSON.stringify(p.entries), gate2 = p.gate, args = p.bindings, born = p.t;
  return [
    db.prepare(`INSERT OR IGNORE INTO farm_market_goods(item,base_cents,price_cents,tick_at,fresh_at) SELECT json_extract(value,'$.item'),json_extract(value,'$.base'),json_extract(value,'$.base'),?,? FROM json_each(?) WHERE ${gate2}`).bind(born, born, data, ...args),
    db.prepare(`INSERT INTO farm_market_lots(id,owner_id,item,source,quantity,born_at,expires_at) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.item'),json_extract(value,'$.source'),json_extract(value,'$.quantity'),json_extract(value,'$.born'),json_extract(value,'$.expires') FROM json_each(?) WHERE ${gate2}
   ON CONFLICT(owner_id,item,source,born_at,expires_at,cooldown_until,expired) DO UPDATE SET quantity=quantity+excluded.quantity,revision=revision+1`).bind(p.userId, data, ...args),
    db.prepare(`UPDATE farm_market_goods SET fresh_seconds=fresh_seconds+(SELECT sum(json_extract(value,'$.quantity')*(json_extract(value,'$.expires')-farm_market_goods.fresh_at)) FROM json_each(?) WHERE json_extract(value,'$.item')=farm_market_goods.item),fresh_qty=fresh_qty+(SELECT sum(json_extract(value,'$.quantity')) FROM json_each(?) WHERE json_extract(value,'$.item')=farm_market_goods.item),revision=revision+1 WHERE item IN(SELECT json_extract(value,'$.item') FROM json_each(?)) AND ${gate2}`).bind(data, data, data, ...args)
  ];
}

// src/farm/visit-outing.ts
async function visitCooldown(db, uid, owner, t) {
  const row = await db.prepare(`SELECT
  coalesce((SELECT created_at FROM farm_outings WHERE actor_id=?1 ORDER BY created_at DESC,id DESC LIMIT 1),0)+?3 AS global_until,
  coalesce((SELECT created_at FROM farm_outings WHERE actor_id=?1 AND owner_id=?2 ORDER BY created_at DESC LIMIT 1),0)+?4 AS pair_until`).bind(uid, owner, VISIT_RULES.cooldown, VISIT_RULES.pairCooldown).first();
  return { global_until: Math.max(t, row.global_until), pair_until: Math.max(t, row.pair_until) };
}
async function visitOuting(db, uid, owner, b, t) {
  const sneak = b.mode === "sneak", targets = b.targets, all = b.all === true;
  if (owner === uid || !Number.isSafeInteger(owner) || owner < 1 || Object.keys(b).some((k) => !["id", "place", "mode", "targets", "revision", "max_fee", "all"].includes(k)) || b.all !== void 0 && !all || typeof b.id !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(b.id) || !["home", "ranch"].includes(String(b.place)) || !["normal", "sneak"].includes(String(b.mode)) || !Number.isSafeInteger(b.revision) || Number(b.revision) < 0 || !Number.isSafeInteger(b.max_fee) || Number(b.max_fee) < 0 || !Array.isArray(targets) || !targets.length || targets.length > VISIT_RULES.maxTargets) fail(400, "\u8BF7\u9009\u62E9\u6709\u6548\u76EE\u6807\uFF0C\u6700\u591A\u8986\u76D660\u5757\u7530\u5730\u4E0E24\u53EA\u52A8\u7269\uFF0C\u5E76\u786E\u8BA4\u8D39\u7528");
  const isRanch = (x) => all ? Object.hasOwn(x, "animal_id") : b.place === "ranch";
  if (targets.some((x) => {
    if (!x || typeof x !== "object" || typeof x.cycle !== "string" || !x.cycle.length || x.cycle.length > 160) return true;
    const ranch = isRanch(x);
    return Object.keys(x).some((k) => !(ranch ? ["animal_id", "cycle"] : ["plot", "cycle"]).includes(k)) || (ranch ? typeof x.animal_id !== "string" || !x.animal_id.length || x.animal_id.length > 100 : !Number.isInteger(x.plot) || Number(x.plot) < 0 || Number(x.plot) >= 60);
  }) || new Set(targets.map((x) => isRanch(x) ? "animal:" + x.animal_id : "plot:" + x.plot)).size !== targets.length) fail(400, "\u76EE\u6807\u65E0\u6548\u6216\u91CD\u590D");
  const hash = await sha256(JSON.stringify({ owner, place: b.place, mode: b.mode, revision: b.revision, max_fee: b.max_fee, targets, ...all ? { all: true } : {} })), readReceipt = () => db.prepare("SELECT request_hash,result FROM farm_outings WHERE actor_id=? AND request_id=?").bind(uid, b.id).first();
  const prior2 = await readReceipt();
  if (prior2) {
    if (prior2.request_hash !== hash) fail(409, "\u64CD\u4F5C\u7F16\u53F7\u5DF2\u4F7F\u7528");
    return { ...JSON.parse(prior2.result), duplicate: true };
  }
  const cooldown = await visitCooldown(db, uid, owner, t), until = Math.max(cooldown.global_until, cooldown.pair_until);
  if (until > t) fail(429, `\u884C\u52A8\u51B7\u5374\u4E2D\uFF0C\u8FD8\u9700${until - t}\u79D2\uFF1B\u540C\u4E00\u519C\u53CB\u95F4\u96945\u5206\u949F`, "visit_cooldown");
  const rows = (await db.prepare(`SELECT f.user_id,f.revision,f.state,coalesce(nullif(u.name,''),u.username) AS name FROM farm_saves f JOIN users u ON u.id=f.user_id WHERE f.user_id IN (?,?) AND u.kind='user' AND u.disabled=0 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id)`).bind(uid, owner).all()).results;
  const host = rows.find((r) => r.user_id === owner), actor = rows.find((r) => r.user_id === uid);
  if (!host || !actor) fail(404, "\u519C\u573A\u4E0D\u53EF\u8BBF\u95EE\uFF0C\u8BF7\u5148\u6253\u5F00\u81EA\u5DF1\u7684\u519C\u573A");
  if (host.revision !== b.revision) fail(409, "\u5BF9\u65B9\u519C\u573A\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u91CD\u65B0\u9009\u62E9");
  const wallet2 = sneak ? await farmWallet(db, uid, t) : null;
  if (sneak && !wallet2) fail(409, "\u8BF7\u5148\u6253\u5F00\u81EA\u5DF1\u7684\u519C\u573A\u540C\u6B65\u4F59\u989D");
  if (wallet2) {
    actor.state = wallet2.state;
    actor.revision = wallet2.revision;
  }
  const before = JSON.parse(actor.state);
  let ownerState = projectFarm(JSON.parse(host.state), t), visitor = projectFarm(before, t), fee = 0;
  if (wallet2) visitor.coins = wallet2.balance;
  const outcomes = [];
  for (const target of targets) {
    const ranch = isRanch(target);
    const animal = ranch ? ownerState.ranch.animals.find((a) => a.id === target.animal_id) : void 0, plot = !ranch ? ownerState.plots[target.plot] : void 0;
    const offer = sneak ? ranch && animal ? ranchSneakOffer(ownerState, animal, t) : plot ? cropSneakOffer(ownerState, plot, t) : null : null;
    if (sneak && !offer) fail(409, "\u6240\u9009\u76EE\u6807\u5DF2\u4E0D\u6EE1\u8DB3\u6F5C\u5165\u6761\u4EF6\uFF0C\u8BF7\u5237\u65B0\u91CD\u65B0\u9009\u62E9");
    let result2;
    try {
      result2 = ranch ? applyRanchVisit(ownerState, visitor, { type: "animal_steal", animal_id: target.animal_id, cycle: target.cycle }, t, sneak) : applyFarmVisit(ownerState, visitor, { type: "steal", plot: target.plot, cycle: target.cycle }, t, sneak);
    } catch (e) {
      fail(409, e instanceof Error ? e.message : "\u76EE\u6807\u5DF2\u53D8\u5316");
    }
    const success = !sneak || crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 < offer.chance;
    fee += offer?.fee ?? 0;
    outcomes.push({ plot: "index" in result2 ? result2.index : target.plot, ...ranch ? { animal_id: target.animal_id } : {}, cycle: target.cycle, crop: result2.crop, name: offer?.name ?? result2.crop, success, early: offer?.early ?? false, fee: offer?.fee ?? 0, chance: offer?.chance ?? 1 });
    if (success) {
      ownerState = result2.owner;
      visitor = result2.visitor;
    }
  }
  if (fee !== b.max_fee) fail(409, "\u884C\u52A8\u8D39\u7528\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u67E5\u770B\u5E76\u786E\u8BA4\u62A5\u4EF7");
  if (visitor.coins < fee) fail(400, "D\u5E01\u4E0D\u8DB3\uFF0C\u672A\u6267\u884C\u884C\u52A8");
  visitor.coins -= fee;
  const won = outcomes.filter((x) => x.success), attempt = crypto.randomUUID(), actorJSON = JSON.stringify(visitor), ownerJSON = JSON.stringify(ownerState), gate2 = "EXISTS(SELECT 1 FROM farm_outings WHERE attempt=?)";
  const result = { message: sneak ? `\u6F5C\u5165${targets.length}\u5904\uFF0C\u6210\u529F${won.length}\u5904\uFF0C\u6D88\u8017${fee} D\u5E01\uFF1B\u5931\u8D25\u76EE\u6807\u672A\u635F\u5931\u7269\u4EA7` : `\u6458\u53D6${won.length}\u4EFD\u7269\u4EA7\uFF0C\u5DF2\u653E\u5165\u80CC\u5305`, outcomes, fee, ...all ? { all: true } : {}, cooldown: { global_until: t + VISIT_RULES.cooldown, pair_until: t + VISIT_RULES.pairCooldown } };
  const entries = won.map((x, i) => ({ ...x, request_id: i ? b.id + ":" + i : b.id, attempt: attempt + ":" + i }));
  const sql = [
    db.prepare(`INSERT OR IGNORE INTO farm_outings(actor_id,owner_id,request_id,request_hash,attempt,mode,place,fee,result,created_at)
  SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10
  WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?11)
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?2 AND revision=?12)
   AND (SELECT count(*) FROM users WHERE id IN (?1,?2) AND kind='user' AND disabled=0)=2
   AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN (?1,?2))
   AND NOT EXISTS(SELECT 1 FROM farm_outings WHERE actor_id=?1 AND created_at>?10-?13)
   AND NOT EXISTS(SELECT 1 FROM farm_outings WHERE actor_id=?1 AND owner_id=?2 AND created_at>?10-?14)
   AND (?8=0 OR EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND revision=?15 AND balance>=?8)) RETURNING id`).bind(uid, owner, b.id, hash, attempt, b.mode, b.place, fee, JSON.stringify(result), t, actor.revision, host.revision, VISIT_RULES.cooldown, VISIT_RULES.pairCooldown, wallet2?.wallet_revision ?? -1),
    ...won.length ? [db.prepare(`UPDATE farm_saves SET state=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate2}`).bind(ownerJSON, t, owner, attempt)] : [],
    db.prepare(`UPDATE farm_saves SET state=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate2}`).bind(actorJSON, t, uid, attempt),
    ...fee > 0 ? [
      db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?,'farm-sneak',?,?,?, ?,? WHERE ${gate2}`).bind(uid, b.id, attempt, -fee, visitor.coins, t, attempt),
      db.prepare(`UPDATE coin52_wallets SET balance=balance-?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate2}`).bind(fee, t, uid, attempt)
    ] : [],
    ...[false, true].flatMap((ranch) => {
      const rows2 = entries.filter((x) => !!x.animal_id === ranch);
      if (!rows2.length) return [];
      const table = ranch ? "farm_ranch_visits" : "farm_visits";
      return [db.prepare(`INSERT INTO ${table}(actor_id,owner_id,request_id,request_hash,attempt,cycle,plot,kind,crop,amount,created_at)
   SELECT ?,?,json_extract(value,'$.request_id'),?,json_extract(value,'$.attempt'),json_extract(value,'$.cycle'),json_extract(value,'$.plot'),?,json_extract(value,'$.crop'),1,? FROM json_each(?) WHERE ${gate2}`).bind(uid, owner, hash, ranch ? "animal_steal" : "steal", t, JSON.stringify(rows2), attempt)];
    }),
    ...won.length ? farmBadgeStatements(db, uid, actorJSON, actor.revision + 1, t, before) : [],
    ...marketStockStatements(db, { userId: uid, before, after: visitor, t, gate: gate2, bindings: [attempt] })
  ];
  const written = await db.batch(sql);
  if (!written[0].results.length) {
    const retry = await readReceipt();
    if (retry?.request_hash === hash) return { ...JSON.parse(retry.result), duplicate: true };
    fail(409, "\u72B6\u6001\u6216\u884C\u52A8\u51B7\u5374\u5DF2\u53D8\u5316\uFF0C\u672C\u6B21\u6CA1\u6709\u6263\u8D39\uFF0C\u8BF7\u5237\u65B0");
  }
  return { ...result, farm: { owner: { id: owner, name: host.name }, revision: host.revision + (won.length ? 1 : 0), server_time: t, ...publicFarm(ownerState, t), cooldown: result.cooldown } };
}

// src/farm/visit-batch.ts
async function visitBatch(db, uid, owner, b, t) {
  if (Object.keys(b).some((k) => !["id", "place", "targets", "revision"].includes(k))) fail(400, "\u6279\u91CF\u53C2\u6570\u65E0\u6548");
  if (typeof b.id === "string") {
    const table = b.place === "ranch" ? "farm_ranch_visits" : "farm_visits", prior2 = await db.prepare(`SELECT request_hash FROM ${table} WHERE actor_id=?1 AND request_id=?2 AND NOT EXISTS(SELECT 1 FROM farm_outings WHERE actor_id=?1 AND request_id=?2)`).bind(uid, b.id).first();
    if (prior2) {
      if (prior2.request_hash !== await sha256(JSON.stringify({ owner, ...b }))) fail(409, "\u64CD\u4F5C\u7F16\u53F7\u5DF2\u4F7F\u7528");
      return { duplicate: true, message: "\u672C\u6B21\u6279\u91CF\u6458\u53D6\u5DF2\u786E\u8BA4\uFF0C\u6CA1\u6709\u91CD\u590D\u83B7\u5F97\u7269\u4EA7" };
    }
  }
  return visitOuting(db, uid, owner, { ...b, mode: "normal", max_fee: 0 }, t);
}

// src/farm/action-limit.ts
async function farmActionLimit(db, uid, t, units) {
  if (!Number.isInteger(units) || units < 1 || units > 360) return fail(400, "\u64CD\u4F5C\u8BA1\u91CF\u65E0\u6548");
  const quota = await db.prepare(`INSERT INTO farm_action_limits(user_id,minute,units) VALUES(?,?,?)
  ON CONFLICT(user_id) DO UPDATE SET minute=excluded.minute,units=CASE WHEN minute=excluded.minute THEN units+excluded.units ELSE excluded.units END
  WHERE minute<>excluded.minute OR units+excluded.units<=360 RETURNING units`).bind(uid, Math.floor(t / 60), units).first();
  if (!quota) return fail(429, "\u64CD\u4F5C\u8FC7\u4E8E\u5BC6\u96C6\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\uFF1B\u5B98\u65B9\u6279\u91CF\u7167\u6599\u4ECD\u53EF\u4F7F\u7528");
}

// src/routes/farm-social.ts
import { Hono } from "hono";

// src/farm/visit-store.ts
function farmVisitStatements(db, p, table = "farm_visits") {
  return [
    db.prepare(`INSERT OR IGNORE INTO ${table}(actor_id,owner_id,request_id,request_hash,attempt,cycle,plot,kind,crop,amount,created_at)
   SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11
   WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?12)
    AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?2 AND revision=?13)
    AND (SELECT count(*) FROM users WHERE id IN (?1,?2) AND kind='user' AND disabled=0)=2
    AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN (?1,?2))
    AND (SELECT count(*) FROM ${table} WHERE actor_id=?1 AND created_at>=?11-60)<30
   RETURNING id`).bind(p.actor, p.owner, p.id, p.hash, p.attempt, p.cycle, p.plot, p.kind, p.crop, p.amount, p.t, p.actorRevision, p.ownerRevision),
    db.prepare(`UPDATE farm_saves SET state=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? AND EXISTS(SELECT 1 FROM ${table} WHERE attempt=?)`).bind(p.ownerState, p.t, p.owner, p.ownerRevision, p.attempt),
    db.prepare(`UPDATE farm_saves SET state=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? AND EXISTS(SELECT 1 FROM ${table} WHERE attempt=?)`).bind(p.actorState, p.t, p.actor, p.actorRevision, p.attempt)
  ];
}

// src/routes/farm-social.ts
var available = `u.kind='user' AND u.disabled=0 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id)`;
var saveQuery = `SELECT f.user_id,f.revision,f.state,u.name,u.username FROM farm_saves f JOIN users u ON u.id=f.user_id WHERE f.user_id=? AND ${available}`;
var visible = (s, t) => ({ owner: { id: s.user_id, name: s.name || s.username }, revision: s.revision, server_time: t, ...publicFarm(JSON.parse(s.state), t) });
async function traffic(c, uid) {
  if (c.env.AUTH_RL && !(await c.env.AUTH_RL.limit({ key: "farm-visit:" + uid })).success) fail(429, "\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\uFF1B\u91CD\u590D\u70B9\u51FB\u4E0D\u4F1A\u52A0\u5FEB\u51B7\u5374", "visit_rate");
}
function number(raw, otherwise) {
  if (raw === void 0) return otherwise;
  const n = Number(raw);
  if (!raw || !Number.isSafeInteger(n)) return fail(400, "\u5206\u9875\u53C2\u6570\u65E0\u6548");
  return n;
}
var farmSocial = new Hono();
farmSocial.get("/api/farm/loss-ranking", async (c) => {
  needUser(c);
  const rows = await c.env.DB.prepare(`SELECT l.user_id AS id,coalesce(nullif(u.name,''),u.username) AS name,l.crops,l.products,l.total
 FROM farm_loss_totals l JOIN users u ON u.id=l.user_id WHERE l.total>0 AND ${available} ORDER BY l.total DESC,l.user_id LIMIT 30`).all();
  return c.json({ items: rows.results, next: null });
});
farmSocial.get("/api/farm/neighbors", async (c) => {
  const uid = needUser(c).id, after = number(c.req.query("after"), Number.MIN_SAFE_INTEGER);
  const rows = await c.env.DB.prepare(`SELECT f.user_id AS id,coalesce(nullif(u.name,''),u.username) AS name,f.state FROM farm_saves f JOIN users u ON u.id=f.user_id WHERE f.user_id>? AND f.user_id<>? AND ${available} ORDER BY f.user_id LIMIT 21`).bind(after, uid).all();
  const t = now(), items = rows.results.slice(0, 20).map((row) => {
    const projected = publicFarm(JSON.parse(row.state), t);
    return { id: row.id, name: row.name, plots: projected.plots.length, animals: projected.ranch.animals.length, available_crops: projected.plots.filter((p) => p.status === "stealable").length, available_products: projected.ranch.animals.filter((a) => a.status === "stealable").length, sneak_crops: projected.plots.filter((p) => p.sneak).length, sneak_products: projected.ranch.animals.filter((a) => a.sneak).length, guard_until: projected.guard_until };
  });
  return c.json({ items, next: rows.results.length > 20 ? items.at(-1).id : null });
});
farmSocial.get("/api/farm/visits", async (c) => {
  const uid = needUser(c).id, before = number(c.req.query("before"), Number.MAX_SAFE_INTEGER), t = now();
  const rows = await c.env.DB.prepare(`SELECT v.id,v.actor_id,coalesce(nullif(u.name,''),u.username) AS actor_name,v.kind,v.crop,v.amount,v.plot,v.created_at FROM farm_visits v JOIN users u ON u.id=v.actor_id WHERE v.owner_id=? AND v.id<? AND v.created_at>=? ORDER BY v.id DESC LIMIT 21`).bind(uid, before, t - 30 * 86400).all();
  const items = rows.results.slice(0, 20);
  return c.json({ items, next: rows.results.length > 20 ? items.at(-1).id : null });
});
farmSocial.get("/api/farm/activity", async (c) => {
  const uid = needUser(c).id, t = now(), raw = c.req.query("before"), p = raw?.split(":").map(Number);
  if (p && (p.length !== 3 || p.some((n) => !Number.isSafeInteger(n)) || p[0] < 1 || p[1] < 0 || p[1] > 3)) return fail(400, "\u8BB0\u5F55\u5206\u9875\u4F4D\u7F6E\u65E0\u6548");
  const [at, kind, id] = p ?? [Number.MAX_SAFE_INTEGER, 3, Number.MAX_SAFE_INTEGER];
  const branches = [["farm_visits", "created_at", "id", 0], ["farm_ranch_visits", "created_at", "id", 1], ["farm_guest_visits", "visited_at", "actor_id", 2], ["farm_outings", "created_at", "id", 3]];
  const results = await c.env.DB.batch(branches.map(([table, time, key, source]) => c.env.DB.prepare(`WITH page AS (SELECT * FROM ${table} WHERE owner_id=? AND ${time}>=? ${source === 3 ? "AND mode='sneak'" : ""} AND (${time},${source},${key})<(?,?,?) ORDER BY ${time} DESC,${key} DESC LIMIT 21)
 SELECT v.${key} AS event_id,v.actor_id,coalesce(nullif(u.name,''),u.username) AS actor_name,
 ${source === 3 ? "'sneak' AS kind,NULL AS crop,0 AS amount,NULL AS plot,v.result" : source === 2 ? "'visit' AS kind,NULL AS crop,0 AS amount,NULL AS plot,NULL AS result" : "v.kind,v.crop,v.amount,v.plot,NULL AS result"},v.${time} AS created_at,${source} AS source
 ,${source < 2 ? "EXISTS(SELECT 1 FROM farm_outings o WHERE o.attempt=substr(v.attempt,1,36) AND o.mode='sneak')" : "0"} AS grouped
 FROM page v JOIN users u ON u.id=v.actor_id ORDER BY v.${time} DESC,v.${key} DESC`).bind(uid, t - 30 * 86400, at, kind, id)));
  const sorted = results.flatMap((r) => r.results).sort((a, b) => b.created_at - a.created_at || b.source - a.source || b.event_id - a.event_id), items = sorted.slice(0, 20), last = items.at(-1);
  return c.json({ items: items.filter((x) => !x.grouped).map(({ grouped, ...x }) => ({ ...x, id: `${x.source}:${x.event_id}` })), next: sorted.length > 20 && last ? `${last.created_at}:${last.source}:${last.event_id}` : null });
});
farmSocial.post("/api/farm/visit/:owner/arrive", async (c) => {
  sameOrigin(c);
  const uid = needUser(c).id, id = number(c.req.param("owner"), 0), t = now(), row = await c.env.DB.prepare(saveQuery).bind(id).first();
  if (!row) return fail(404, "\u8FD9\u4F4D\u7528\u6237\u7684\u519C\u573A\u6682\u4E0D\u53EF\u8BBF\u95EE");
  if (id !== uid) await c.env.DB.prepare(`INSERT INTO farm_guest_visits(owner_id,actor_id,visited_at)
 SELECT ?1,?2,?3 WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?2)
 AND EXISTS(SELECT 1 FROM users WHERE id=?2 AND disabled=0 AND kind='user')
 AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND disabled=0 AND kind='user')
 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN (?1,?2))
 ON CONFLICT(owner_id,actor_id) DO UPDATE SET visited_at=excluded.visited_at WHERE farm_guest_visits.visited_at<=?3-1800`).bind(id, uid, t).run();
  return c.json({ ...visible(row, t), cooldown: await visitCooldown(c.env.DB, uid, id, t) });
});
farmSocial.get("/api/farm/ranch-visits", async (c) => {
  const uid = needUser(c).id, before = number(c.req.query("before"), Number.MAX_SAFE_INTEGER), t = now();
  const rows = await c.env.DB.prepare(`SELECT v.id,v.actor_id,coalesce(nullif(u.name,''),u.username) AS actor_name,v.kind,v.crop,v.amount,v.plot,v.created_at FROM farm_ranch_visits v JOIN users u ON u.id=v.actor_id WHERE v.owner_id=? AND v.id<? AND v.created_at>=? ORDER BY v.id DESC LIMIT 21`).bind(uid, before, t - 30 * 86400).all();
  const items = rows.results.slice(0, 20);
  return c.json({ items, next: rows.results.length > 20 ? items.at(-1).id : null });
});
farmSocial.get("/api/farm/visit/:owner", async (c) => {
  const id = number(c.req.param("owner"), 0), row = await c.env.DB.prepare(saveQuery).bind(id).first();
  if (!row) return fail(404, "\u8FD9\u4F4D\u7528\u6237\u7684\u519C\u573A\u6682\u4E0D\u53EF\u8BBF\u95EE");
  const t = now(), uid = c.get("user")?.id;
  return c.json({ ...visible(row, t), ...uid ? { cooldown: await visitCooldown(c.env.DB, uid, id, t) } : {} });
});
farmSocial.post("/api/farm/visit/:owner", async (c) => {
  sameOrigin(c);
  const uid = needUser(c).id;
  await traffic(c, uid);
  const owner = number(c.req.param("owner"), 0), body = await boundedJson(c, 2048), t = now();
  if (owner === uid) return fail(400, "\u8BF7\u5728\u81EA\u5DF1\u7684\u519C\u573A\u64CD\u4F5C");
  const ranch = body.type === "animal_steal", table = ranch ? "farm_ranch_visits" : "farm_visits";
  if (Object.keys(body).some((k) => !(ranch ? ["id", "type", "animal_id", "cycle", "revision"] : ["id", "type", "plot", "cycle", "revision"]).includes(k)) || typeof body.id !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(body.id) || !["water", "steal", "animal_steal"].includes(String(body.type)) || typeof body.cycle !== "string" || body.cycle.length > 160 || (ranch ? typeof body.animal_id !== "string" || body.animal_id.length > 100 : !Number.isInteger(body.plot) || Number(body.plot) < 0 || Number(body.plot) >= MAX_FARM_PLOTS) || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0) return fail(400, "\u4E92\u8BBF\u64CD\u4F5C\u683C\u5F0F\u65E0\u6548");
  const hash = await sha256(JSON.stringify({ owner, type: body.type, plot: body.plot, animal_id: body.animal_id, cycle: body.cycle, revision: body.revision }));
  const receipt2 = await c.env.DB.prepare(`SELECT request_hash FROM ${table} WHERE actor_id=?1 AND request_id=?2 AND NOT EXISTS(SELECT 1 FROM farm_outings WHERE actor_id=?1 AND request_id=?2)`).bind(uid, body.id).first();
  if (receipt2) {
    if (receipt2.request_hash !== hash) return fail(409, "\u64CD\u4F5C\u7F16\u53F7\u5DF2\u4F7F\u7528");
    return c.json({ duplicate: true, message: "\u8FD9\u6B21\u4E92\u52A8\u5DF2\u5B8C\u6210\uFF0C\u6CA1\u6709\u91CD\u590D\u6263\u9664\u6216\u83B7\u5F97\u7269\u54C1" });
  }
  if (body.type !== "water") return c.json(await visitOuting(c.env.DB, uid, owner, { id: body.id, place: ranch ? "ranch" : "home", mode: "normal", revision: body.revision, max_fee: 0, targets: [ranch ? { animal_id: body.animal_id, cycle: body.cycle } : { plot: body.plot, cycle: body.cycle }] }, t));
  await farmActionLimit(c.env.DB, uid, t, 1);
  const rows = await c.env.DB.batch([c.env.DB.prepare(saveQuery).bind(owner), c.env.DB.prepare(saveQuery).bind(uid)]);
  const host = rows[0].results[0], actor = rows[1].results[0];
  if (!host) return fail(404, "\u8FD9\u4F4D\u7528\u6237\u7684\u519C\u573A\u6682\u4E0D\u53EF\u8BBF\u95EE");
  if (!actor) return fail(409, "\u8BF7\u5148\u8FDB\u5165\u81EA\u5DF1\u7684\u519C\u573A\u52A0\u8F7D\u5B58\u6863");
  if (host.revision !== body.revision) return fail(409, "\u5BF9\u65B9\u519C\u573A\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u9009\u62E9");
  let result;
  try {
    result = ranch ? applyRanchVisit(JSON.parse(host.state), JSON.parse(actor.state), body, t) : applyFarmVisit(JSON.parse(host.state), JSON.parse(actor.state), body, t);
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : "\u65E0\u6CD5\u8FDB\u884C\u4E92\u52A8");
  }
  const attempt = crypto.randomUUID(), actorState = JSON.stringify(result.visitor), written = await c.env.DB.batch([
    ...farmVisitStatements(c.env.DB, { actor: uid, owner, actorRevision: actor.revision, ownerRevision: host.revision, actorState, ownerState: JSON.stringify(result.owner), id: body.id, hash, attempt, cycle: body.cycle, plot: "index" in result ? result.index : Number(body.plot), kind: body.type, crop: result.crop, amount: result.amount, t }, table),
    ...result.amount > 0 ? farmBadgeStatements(c.env.DB, uid, actorState, actor.revision + 1, t) : [],
    ...marketStockStatements(c.env.DB, { userId: uid, before: JSON.parse(actor.state), after: result.visitor, t, gate: `EXISTS(SELECT 1 FROM ${table} WHERE attempt=?)`, bindings: [attempt] })
  ]);
  if (!written[0].results.length) {
    const retry = await c.env.DB.prepare(`SELECT request_hash FROM ${table} WHERE actor_id=? AND request_id=?`).bind(uid, body.id).first();
    if (retry?.request_hash === hash) return c.json({ duplicate: true, message: "\u8FD9\u6B21\u4E92\u52A8\u5DF2\u5B8C\u6210\uFF0C\u6CA1\u6709\u91CD\u590D\u7ED3\u7B97" });
    return fail(409, "\u519C\u573A\u72B6\u6001\u5DF2\u53D8\u5316\u3001\u6B64\u832C\u5DF2\u64CD\u4F5C\u6216\u64CD\u4F5C\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  }
  return c.json({ message: result.message, farm: visible({ ...host, state: JSON.stringify(result.owner), revision: host.revision + 1 }, t) });
});
farmSocial.post("/api/farm/visit/:owner/batch", async (c) => {
  sameOrigin(c);
  const uid = needUser(c).id;
  await traffic(c, uid);
  return c.json(await visitBatch(c.env.DB, uid, number(c.req.param("owner"), 0), await boundedJson(c, 16384), now()));
});
farmSocial.post("/api/farm/visit/:owner/outing", async (c) => {
  sameOrigin(c);
  const uid = needUser(c).id;
  await traffic(c, uid);
  return c.json(await visitOuting(c.env.DB, uid, number(c.req.param("owner"), 0), await boundedJson(c, 32768), now()));
});

// src/routes/farm-leases.ts
import { Hono as Hono2 } from "hono";

// src/farm/leases.ts
var LEASE_IDLE = 48 * 3600;
var LEASE_DEFAULT = { price: 10, days: 1 };
var emptyLeasePlot = () => ({ tilled: true, crop: null, plantedAt: 0, wateredAt: null });
async function workLease(db, lease, actor, requestId, type, crop, autoBuy, t, allUnlocked = false) {
  if (await db.prepare("SELECT 1 FROM farm_lease_actions WHERE lease_id=? AND request_id=? AND actor_id=?").bind(lease.id, requestId, actor).first()) return { duplicate: true };
  if (lease.tenant_id !== actor || lease.state !== "active") fail(409, "\u79DF\u7EA6\u5DF2\u7ED3\u675F\u6216\u4E0D\u5C5E\u4E8E\u4F60");
  if (type === "end" && lease.expires_at > t) fail(400, "\u79DF\u671F\u5C1A\u672A\u7ED3\u675F");
  if ((type === "plant" || type === "pest") && lease.expires_at <= t) fail(400, "\u79DF\u671F\u5DF2\u7ED3\u675F\uFF0C\u7B49\u5F85\u81EA\u52A8\u6536\u83B7\u5F52\u8FD8");
  if (type !== "end") await farmActionLimit(db, actor, t, type === "plant" ? 2 : 1);
  const row = await farmWallet(db, actor, t);
  if (!row) fail(409, "\u8BF7\u5148\u52A0\u8F7D\u81EA\u5DF1\u7684\u519C\u573A");
  const original = { ...JSON.parse(row.state), coins: row.balance }, plot = JSON.parse(lease.crop_state);
  let actions = [];
  if (type === "plant") {
    const spec = CROPS.find((c) => c.id === crop);
    if (!spec || t + cropMaxSeconds(spec.seconds) > lease.expires_at) fail(400, "\u79DF\u671F\u4E0D\u8DB3\u4EE5\u8986\u76D6\u6210\u719F\u53CA\u6700\u591A10%\u866B\u5BB3\u7F13\u51B2\uFF0C\u8BF7\u9009\u62E9\u751F\u957F\u66F4\u5FEB\u7684\u79CD\u5B50");
    actions = [{ type: "plant", plot: 0, crop, autoBuy }, { type: "water", plot: 0 }];
  } else if (type === "pest") actions = [{ type: "pest", plot: 0 }];
  else if (type === "harvest" || plot.crop) actions = [{ type: "harvest", plot: 0 }];
  const result = actions.length ? applyFarmActions({ ...original, plots: [plot] }, actions, t, { allUnlocked }) : { state: { ...original, plots: [plot] }, messages: [] };
  const nextPlot = JSON.stringify(result.state.plots[0]);
  result.state.plots = original.plots;
  const encoded = JSON.stringify(result.state), delta = result.state.coins - row.balance, attempt = crypto.randomUUID(), gate2 = "EXISTS(SELECT 1 FROM farm_lease_actions WHERE attempt=?)";
  const batch = [
    db.prepare(`INSERT OR IGNORE INTO farm_lease_actions(lease_id,request_id,actor_id,attempt,created_at)
   SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM farm_leases WHERE id=?1 AND tenant_id=?3 AND revision=?6 AND state='active')
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?3 AND revision=?7)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?3 AND revision=?8)
   AND (?9=1 OR (EXISTS(SELECT 1 FROM users WHERE id=?3 AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?3))) RETURNING lease_id`).bind(lease.id, requestId, actor, attempt, t, lease.revision, row.revision, row.wallet_revision, type === "end" ? 1 : 0),
    // Assign state only at expiry, avoiding four unchanged status-index writes.
    db.prepare(`UPDATE farm_leases SET crop_state=?,revision=revision+1${type === "end" ? ",state='ended'" : ""} WHERE id=? AND ${gate2}`).bind(nextPlot, lease.id, attempt),
    db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?,'farm-lease-work',?,?,?,?,? WHERE ?<>0 AND ${gate2}`).bind(actor, lease.id + ":" + requestId, attempt, delta, result.state.coins, t, delta, attempt),
    db.prepare(`UPDATE coin52_wallets SET balance=?,revision=revision+1,updated_at=? WHERE user_id=? AND ?<>0 AND ${gate2}`).bind(result.state.coins, t, actor, delta, attempt),
    db.prepare(`UPDATE farm_saves SET state=?1,revision=revision+1,updated_at=?2${type === "end" ? "" : ",owner_operated_at=?2"} WHERE user_id=?3 AND EXISTS(SELECT 1 FROM farm_lease_actions WHERE attempt=?4)`).bind(encoded, t, actor, attempt),
    ...farmBadgeStatements(db, actor, encoded, row.revision + 1, t, original),
    ...marketStockStatements(db, { userId: actor, before: original, after: result.state, t, gate: gate2, bindings: [attempt] })
  ];
  const saved = await db.batch(batch);
  if (!saved[0].results.length) {
    if (await db.prepare("SELECT 1 FROM farm_lease_actions WHERE lease_id=? AND request_id=? AND actor_id=?").bind(lease.id, requestId, actor).first()) return { duplicate: true };
    fail(409, "\u519C\u573A\u6216\u79DF\u7EA6\u521A\u521A\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  }
  return { duplicate: false, messages: result.messages };
}
async function settleFarmLeases(db, t, userId) {
  const query2 = userId === void 0 ? "SELECT * FROM farm_leases WHERE state='active' AND expires_at<=? ORDER BY expires_at LIMIT 12" : "SELECT * FROM farm_leases WHERE state='active' AND expires_at<=? AND (owner_id=? OR tenant_id=?) ORDER BY expires_at LIMIT 24";
  const stmt = db.prepare(query2), rows = await (userId === void 0 ? stmt.bind(t) : stmt.bind(t, userId, userId)).all();
  for (const lease of rows.results) await workLease(db, lease, lease.tenant_id, "expiry", "end", null, false, t).catch(() => console.error("farm_lease_settlement_retry", lease.id));
}

// src/farm/lease-batch.ts
async function rentLeaseBatch(db, uid, b, t) {
  const input = b.items;
  if (typeof b.id !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(b.id) || b.confirm !== true || !Array.isArray(input) || !input.length || input.length > MAX_FARM_PLOTS || input.some((x) => !x || !Number.isSafeInteger(x.owner_id) || x.owner_id < 1 || x.owner_id === uid || !Number.isInteger(x.plot) || x.plot < 0 || x.plot >= MAX_FARM_PLOTS || !Number.isInteger(x.price) || x.price < 1 || x.price > 1e4 || !Number.isInteger(x.days) || x.days < 1 || x.days > 7 || typeof x.forced !== "boolean" || x.forced && (x.price !== LEASE_DEFAULT.price || x.days !== LEASE_DEFAULT.days)) || new Set(input.map((x) => x.owner_id + ":" + x.plot)).size !== input.length) return fail(400, "\u8BF7\u9009\u62E9\u4E0D\u91CD\u590D\u7684\u7A7A\u5730\u5E76\u786E\u8BA4\u79DF\u91D1\u3001\u671F\u9650\uFF08\u6BCF\u6B21\u6700\u591A60\u5757\uFF09");
  const items = input.map(({ owner_id, plot, price, days, forced }) => ({ owner_id, plot, price, days, forced })).sort((a, b2) => a.owner_id - b2.owner_id || a.plot - b2.plot), hash = await sha256(JSON.stringify(items));
  const prior2 = async () => {
    const row = await db.prepare("SELECT request_hash,result FROM farm_lease_batches WHERE user_id=? AND request_id=?").bind(uid, b.id).first();
    if (!row) return null;
    if (row.request_hash !== hash) return fail(409, "\u64CD\u4F5C\u7F16\u53F7\u5DF2\u7528\u4E8E\u53E6\u4E00\u7EC4\u5730\u5757\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9");
    return { ...JSON.parse(row.result), duplicate: true };
  };
  const done = await prior2();
  if (done) return done;
  await farmActionLimit(db, uid, t, items.length);
  const tenant = await farmWallet(db, uid, t);
  if (!tenant) return fail(409, "\u8BF7\u5148\u6253\u5F00\u81EA\u5DF1\u7684\u519C\u573A");
  const total = items.reduce((n, x) => n + x.price, 0);
  if (tenant.balance < total) return fail(400, `D\u5E01\u4F59\u989D\u4E0D\u8DB3\uFF0C\u6240\u9009\u5730\u5757\u5171\u9700 ${total} D\u5E01`);
  const owners = [...new Set(items.map((x) => x.owner_id))], saves = (await db.prepare(`SELECT f.user_id,f.revision,f.state,m.user_id AS migrated FROM json_each(?) j CROSS JOIN farm_saves f ON f.user_id=j.value LEFT JOIN farm_migrations m ON m.user_id=f.user_id`).bind(JSON.stringify(owners)).all()).results;
  const indexed = new Map(saves.map((s) => [s.user_id, s]));
  for (const s of saves) if (s.migrated === null) {
    const migrated = await farmWallet(db, s.user_id, t);
    if (migrated) Object.assign(s, migrated);
  }
  for (const item of items) {
    const save = indexed.get(item.owner_id), p = save ? JSON.parse(save.state).plots[item.plot] : null;
    if (!p || p.crop) return fail(409, "\u6240\u9009\u571F\u5730\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u9009\u62E9\uFF1B\u672C\u6B21\u672A\u6263\u6B3E");
  }
  const attempt = crypto.randomUUID(), leases = items.map((x, i) => ({ ...x, id: `${uid}-${b.id}-${i}`, owner_revision: indexed.get(x.owner_id).revision, forced: x.forced ? 1 : 0, expires_at: t + x.days * 86400, attempt: attempt + "-" + i })), leaseJson = JSON.stringify(leases);
  const deltas = [{ uid, delta: -total }, ...owners.map((owner) => ({ uid: owner, delta: items.filter((x) => x.owner_id === owner).reduce((n, x) => n + x.price, 0) }))], deltaJson = JSON.stringify(deltas);
  const result = { count: items.length, total, balance: tenant.balance - total, leases: leases.map((l) => ({ id: l.id, owner_id: l.owner_id, plot: l.plot, expires_at: l.expires_at })), duplicate: false }, gate2 = "EXISTS(SELECT 1 FROM farm_lease_batches WHERE attempt=?)";
  const writes = [
    db.prepare(`INSERT OR IGNORE INTO farm_lease_batches(user_id,request_id,request_hash,attempt,result,created_at)
   SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?7)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND revision=?8 AND balance>=?9)
   AND NOT EXISTS(SELECT 1 FROM json_each(?10) j LEFT JOIN users u ON u.id=json_extract(j.value,'$.uid') LEFT JOIN coin52_wallets w ON w.user_id=u.id
    WHERE u.id IS NULL OR u.disabled<>0 OR u.kind<>'user' OR w.user_id IS NULL OR w.balance+json_extract(j.value,'$.delta')<0 OR w.balance>9007199254740991-json_extract(j.value,'$.delta')
    OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id))
   AND NOT EXISTS(SELECT 1 FROM json_each(?11) j LEFT JOIN farm_saves f ON f.user_id=json_extract(j.value,'$.owner_id')
    WHERE f.user_id IS NULL OR f.revision<>json_extract(j.value,'$.owner_revision')
    OR (json_extract(j.value,'$.forced')=1 AND f.owner_operated_at>?6-${LEASE_IDLE})
    OR (json_extract(j.value,'$.forced')=0 AND NOT EXISTS(SELECT 1 FROM farm_lease_offers o WHERE o.owner_id=f.user_id AND o.plot=json_extract(j.value,'$.plot') AND o.price=json_extract(j.value,'$.price') AND o.days=json_extract(j.value,'$.days')))
    OR EXISTS(SELECT 1 FROM farm_leases l WHERE l.owner_id=f.user_id AND l.plot=json_extract(j.value,'$.plot') AND l.state='active')) RETURNING attempt`).bind(uid, b.id, hash, attempt, JSON.stringify(result), t, tenant.revision, tenant.wallet_revision, total, deltaJson, leaseJson),
    db.prepare(`INSERT INTO farm_leases(id,owner_id,tenant_id,plot,price,started_at,expires_at,forced,state,crop_state,attempt)
   SELECT json_extract(value,'$.id'),json_extract(value,'$.owner_id'),?,json_extract(value,'$.plot'),json_extract(value,'$.price'),?,json_extract(value,'$.expires_at'),json_extract(value,'$.forced'),'active',?,json_extract(value,'$.attempt') FROM json_each(?) WHERE ${gate2}`).bind(uid, t, JSON.stringify(emptyLeasePlot()), leaseJson, attempt),
    db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT w.user_id,CASE WHEN w.user_id=? THEN 'farm-rent-pay' ELSE 'farm-rent-income' END,?,?||'-'||w.user_id,json_extract(j.value,'$.delta'),w.balance+json_extract(j.value,'$.delta'),?
   FROM json_each(?) j CROSS JOIN coin52_wallets w ON w.user_id=json_extract(j.value,'$.uid') WHERE ${gate2}`).bind(uid, uid + "-" + b.id, attempt, t, deltaJson, attempt),
    db.prepare(`UPDATE coin52_wallets SET balance=balance+(SELECT json_extract(value,'$.delta') FROM json_each(?1) WHERE json_extract(value,'$.uid')=coin52_wallets.user_id),revision=revision+1,updated_at=?2 WHERE user_id IN(SELECT json_extract(value,'$.uid') FROM json_each(?1)) AND EXISTS(SELECT 1 FROM farm_lease_batches WHERE attempt=?3)`).bind(deltaJson, t, attempt),
    db.prepare(`UPDATE farm_saves SET revision=revision+1 WHERE user_id IN(SELECT json_extract(value,'$.uid') FROM json_each(?)) AND ${gate2}`).bind(deltaJson, attempt),
    db.prepare(`DELETE FROM farm_lease_offers WHERE (owner_id,plot) IN(SELECT json_extract(value,'$.owner_id'),json_extract(value,'$.plot') FROM json_each(?)) AND ${gate2}`).bind(leaseJson, attempt)
  ];
  const written = await db.batch(writes);
  if (!written[0].results.length) return await prior2() ?? fail(409, "\u5730\u5757\u3001\u6302\u724C\u4EF7\u683C\u6216\u4F59\u989D\u5DF2\u53D8\u5316\uFF0C\u6574\u7B14\u79DF\u8D41\u672A\u6263\u6B3E\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u9009");
  return result;
}

// src/farm/lifecycle.ts
var FARM_CLOSE_AT = Date.parse("2026-10-28T12:00:00+08:00") / 1e3;
var FARM_FAREWELL_ID = "farm-farewell-20261028";
var FARM_FAREWELL_BONUS = 1e5;
var farmClosed = (t) => t >= FARM_CLOSE_AT;

// src/farm/lease-buyback.ts
var LEASE_BUYBACK_COOLDOWN = 48 * 3600;
async function leaseBuybackQuote(db, lease, owner, t) {
  if (lease.owner_id !== owner) fail(403, "\u53EA\u6709\u5730\u4E3B\u53EF\u4EE5\u4E70\u56DE\u571F\u5730");
  if (farmClosed(t)) fail(409, "\u519C\u573A\u5DF2\u7ED3\u675F\u7ECF\u8425\uFF0C\u79DF\u7EA6\u5C06\u7EDF\u4E00\u7ED3\u7B97");
  if (lease.state !== "active" || lease.expires_at <= t) fail(409, "\u79DF\u7EA6\u5DF2\u7ED3\u675F\uFF0C\u65E0\u9700\u652F\u4ED8\u8FDD\u7EA6\u91D1");
  const cooldown = await db.prepare("SELECT cooldown_until FROM farm_lease_buybacks WHERE owner_id=? AND plot=? ORDER BY cooldown_until DESC LIMIT 1").bind(owner, lease.plot).first();
  if (cooldown && cooldown.cooldown_until > t) fail(409, "\u8FD9\u5757\u5730\u4ECD\u5728\u8FDD\u7EA6\u51B7\u5374\u4E2D\uFF0C\u5176\u4ED6\u5730\u5757\u4E0D\u53D7\u5F71\u54CD");
  const plot = JSON.parse(lease.crop_state), crop = CROPS.find((c) => c.id === plot.crop);
  if (plot.crop && !crop) fail(409, "\u4F5C\u7269\u6570\u636E\u6682\u4E0D\u652F\u6301\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u6838\u5BF9");
  const quantity = crop ? 2 : 0;
  return { lease_id: lease.id, revision: lease.revision, penalty: Math.ceil(lease.price * 6 / 5), reward: crop ? crop.sellPrice * quantity : 0, crop: crop?.name ?? null, quantity, cooldown_seconds: LEASE_BUYBACK_COOLDOWN };
}
async function buybackLease(db, lease, owner, requestId, expected, t) {
  const prior2 = await db.prepare("SELECT lease_id,owner_id,penalty,reward,cooldown_until FROM farm_lease_buybacks WHERE lease_id=?").bind(lease.id).first();
  if (prior2) {
    if (prior2.owner_id !== owner) fail(403, "\u53EA\u80FD\u67E5\u770B\u81EA\u5DF1\u7684\u4E70\u56DE\u8BB0\u5F55");
    return { ...prior2, duplicate: true };
  }
  const quote = await leaseBuybackQuote(db, lease, owner, t);
  if (expected.revision !== quote.revision || expected.penalty !== quote.penalty || expected.reward !== quote.reward) fail(409, "\u79DF\u5730\u6536\u6210\u6216\u62A5\u4EF7\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u67E5\u770B\u4E70\u56DE\u62A5\u4EF7");
  const [landlord, tenant] = await Promise.all([farmWallet(db, owner, t), farmWallet(db, lease.tenant_id, t)]);
  if (!landlord || !tenant) return fail(409, "\u53CC\u65B9\u519C\u573A\u6B63\u5728\u540C\u6B65\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
  if (landlord.balance < quote.penalty) fail(400, "D\u5E01\u4F59\u989D\u4E0D\u8DB3\u4EE5\u652F\u4ED8\u8FDD\u7EA6\u91D1");
  const landlordBalance = landlord.balance - quote.penalty + quote.reward, tenantBalance = tenant.balance + quote.penalty + quote.reward;
  if (!Number.isSafeInteger(landlordBalance) || !Number.isSafeInteger(tenantBalance)) fail(400, "\u4F59\u989D\u8D85\u8FC7\u53EF\u7ED3\u7B97\u8303\u56F4");
  const attempt = crypto.randomUUID(), gate2 = "EXISTS(SELECT 1 FROM farm_lease_buybacks WHERE attempt=?)";
  const result = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO farm_lease_buybacks(lease_id,owner_id,tenant_id,plot,request_id,attempt,penalty,reward,crop_state,created_at,cooldown_until)
   SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11
   WHERE EXISTS(SELECT 1 FROM farm_leases WHERE id=?1 AND owner_id=?2 AND tenant_id=?3 AND state='active' AND expires_at>?10 AND revision=?12)
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?2 AND revision=?13)
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?3 AND revision=?14)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?2 AND revision=?15 AND balance>=?7)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?3 AND revision=?16)
   AND (SELECT COUNT(*) FROM users WHERE id IN(?2,?3) AND disabled=0 AND kind='user')=2
   AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(?2,?3))
   AND NOT EXISTS(SELECT 1 FROM farm_lease_buybacks WHERE owner_id=?2 AND plot=?4 AND cooldown_until>?10)
   RETURNING lease_id`).bind(lease.id, owner, lease.tenant_id, lease.plot, requestId, attempt, quote.penalty, quote.reward, lease.crop_state, t, t + LEASE_BUYBACK_COOLDOWN, lease.revision, landlord.revision, tenant.revision, landlord.wallet_revision, tenant.wallet_revision),
    db.prepare(`UPDATE farm_leases SET state='ended',crop_state=?,revision=revision+1 WHERE id=? AND ${gate2}`).bind(JSON.stringify(emptyLeasePlot()), lease.id, attempt),
    db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT user_id,CASE WHEN user_id=?1 THEN 'farm-buyback-pay' ELSE 'farm-buyback-income' END,?2,?3,
   CASE WHEN user_id=?1 THEN -?4 ELSE ?4 END,balance+CASE WHEN user_id=?1 THEN -?4 ELSE ?4 END,?5
   FROM coin52_wallets WHERE user_id IN(?1,?6) AND EXISTS(SELECT 1 FROM farm_lease_buybacks WHERE attempt=?3)`).bind(owner, lease.id, attempt, quote.penalty, t, lease.tenant_id),
    db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT user_id,'farm-buyback-crop',?1,?2||'-crop',?3,balance+?3+CASE WHEN user_id=?4 THEN -?5 ELSE ?5 END,?6
   FROM coin52_wallets WHERE user_id IN(?4,?7) AND ?3>0 AND EXISTS(SELECT 1 FROM farm_lease_buybacks WHERE attempt=?2)`).bind(lease.id, attempt, quote.reward, owner, quote.penalty, t, lease.tenant_id),
    db.prepare(`UPDATE coin52_wallets SET balance=CASE WHEN user_id=? THEN ? ELSE ? END,revision=revision+1,updated_at=? WHERE user_id IN(?,?) AND ${gate2}`).bind(owner, landlordBalance, tenantBalance, t, owner, lease.tenant_id, attempt),
    db.prepare(`UPDATE farm_saves SET revision=revision+1 WHERE user_id IN(?,?) AND ${gate2}`).bind(owner, lease.tenant_id, attempt),
    db.prepare(`DELETE FROM farm_lease_offers WHERE owner_id=? AND plot=? AND ${gate2}`).bind(owner, lease.plot, attempt)
  ]);
  if (!result[0].results.length) {
    const done = await db.prepare("SELECT lease_id,owner_id,penalty,reward,cooldown_until FROM farm_lease_buybacks WHERE lease_id=? AND owner_id=?").bind(lease.id, owner).first();
    if (done) return { ...done, duplicate: true };
    fail(409, "\u79DF\u7EA6\u3001\u4F59\u989D\u6216\u51B7\u5374\u72B6\u6001\u5DF2\u53D8\u5316\uFF0C\u672C\u6B21\u672A\u6263\u6B3E\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  }
  return { ...quote, balance: landlordBalance, cooldown_until: t + LEASE_BUYBACK_COOLDOWN, duplicate: false };
}

// src/routes/farm-leases.ts
var farmLeases = new Hono2();
var validId = (v) => typeof v === "string" && /^[a-zA-Z0-9-]{16,64}$/.test(v);
var activePair = `(SELECT COUNT(*) FROM users WHERE id IN(?2,?3) AND disabled=0 AND kind='user')=2 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(?2,?3))`;
farmLeases.get("/api/farm/leases", async (c) => {
  const u = needUser(c), db = c.env.DB, t = now();
  await settleFarmLeases(db, t, u.id);
  const [leases, offers, save, locks] = await db.batch([
    db.prepare(`SELECT l.*,o.username AS owner_name,n.username AS tenant_name,b.penalty AS buyback_penalty,b.reward AS buyback_reward,b.cooldown_until AS buyback_cooldown FROM farm_leases l JOIN users o ON o.id=l.owner_id JOIN users n ON n.id=l.tenant_id LEFT JOIN farm_lease_buybacks b ON b.lease_id=l.id WHERE (l.owner_id=? OR l.tenant_id=?) AND (l.state='active' OR l.expires_at>?) ORDER BY l.started_at DESC LIMIT 100`).bind(u.id, u.id, t - 7 * 86400),
    db.prepare("SELECT plot,price,days FROM farm_lease_offers WHERE owner_id=? ORDER BY plot").bind(u.id),
    db.prepare("SELECT state,owner_operated_at FROM farm_saves WHERE user_id=?").bind(u.id),
    db.prepare("SELECT plot FROM farm_leases WHERE owner_id=? AND state='active'").bind(u.id)
  ]);
  const state = save.results[0] ? JSON.parse(String(save.results[0].state)) : null;
  const locked = new Set(locks.results.map((r) => Number(r.plot)));
  return c.json({ leases: leases.results.map((r) => ({ ...r, attempt: void 0, crop_state: JSON.parse(String(r.crop_state)) })), offers: offers.results, empty: state?.plots.flatMap((p, i) => !p.crop && !locked.has(i) ? [i] : []) ?? [], defaults: LEASE_DEFAULT, server_time: t });
});
farmLeases.get("/api/farm/leases/market", async (c) => {
  const u = needUser(c), db = c.env.DB, t = now(), raw = c.req.query("after") || "0.0";
  if (!/^\d{1,12}\.\d{1,12}$/.test(raw)) return fail(400, "\u519C\u53CB\u6E38\u6807\u65E0\u6548");
  const [afterTime, afterId] = raw.split(".").map(Number);
  const offered = (await db.prepare(`SELECT o.*,u.username AS name,f.state FROM farm_lease_offers o JOIN farm_saves f ON f.user_id=o.owner_id JOIN users u ON u.id=o.owner_id WHERE o.owner_id<>? AND u.disabled=0 AND u.kind='user' AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=o.owner_id) AND NOT EXISTS(SELECT 1 FROM farm_leases l WHERE l.owner_id=o.owner_id AND l.plot=o.plot AND l.state='active') ORDER BY o.owner_id,o.plot LIMIT 60`).bind(u.id).all()).results;
  const idle = (await db.prepare(`SELECT f.user_id AS owner_id,f.owner_operated_at,u.username AS name,f.state FROM farm_saves f JOIN users u ON u.id=f.user_id WHERE (f.owner_operated_at,f.user_id)>(?,?) AND f.user_id<>? AND f.owner_operated_at<=? AND u.disabled=0 AND u.kind='user' AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=f.user_id) ORDER BY f.owner_operated_at,f.user_id LIMIT 21`).bind(afterTime, afterId, u.id, t - LEASE_IDLE).all()).results;
  const candidates = [...offered.flatMap((o) => {
    const p = JSON.parse(o.state).plots[o.plot];
    return p && !p.crop ? [{ owner_id: o.owner_id, name: o.name, plot: o.plot, price: o.price, days: o.days, forced: false }] : [];
  }), ...idle.slice(0, 20).flatMap((o) => JSON.parse(o.state).plots.flatMap((p, plot) => !p.crop ? [{ owner_id: o.owner_id, name: o.name, plot, ...LEASE_DEFAULT, forced: true }] : []))];
  const ids = [...new Set(candidates.map((x) => x.owner_id))], locks = ids.length ? (await db.prepare(`SELECT owner_id,plot FROM farm_leases WHERE owner_id IN(${ids.map(() => "?").join(",")}) AND state='active'`).bind(...ids).all()).results : [];
  const unavailable = new Set(locks.map((x) => x.owner_id + ":" + x.plot)), seen = /* @__PURE__ */ new Set(), items = candidates.filter((x) => {
    const key = x.owner_id + ":" + x.plot;
    if (unavailable.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return c.json({ items, next: idle.length > 20 ? idle[19].owner_operated_at + "." + idle[19].owner_id : null, server_time: t });
});
farmLeases.post("/api/farm/leases/offer", async (c) => {
  sameOrigin(c);
  const u = needUser(c), db = c.env.DB, t = now(), b = await boundedJson(c, 4096), plots = b.plots ?? [b.plot];
  if (!Array.isArray(plots) || !plots.length || plots.length > MAX_FARM_PLOTS || new Set(plots).size !== plots.length || plots.some((plot) => !Number.isInteger(plot) || plot < 0 || plot >= MAX_FARM_PLOTS) || typeof b.remove !== "boolean") return fail(400, "\u6302\u724C\u53C2\u6570\u65E0\u6548");
  await farmActionLimit(db, u.id, t, plots.length);
  if (b.remove) {
    const r2 = await db.prepare("DELETE FROM farm_lease_offers WHERE owner_id=? AND plot IN(SELECT value FROM json_each(?))").bind(u.id, JSON.stringify(plots)).run();
    return c.json({ removed: true, count: r2.meta.changes });
  }
  if (!Number.isInteger(b.price) || Number(b.price) < 1 || Number(b.price) > 1e4 || !Number.isInteger(b.days) || Number(b.days) < 1 || Number(b.days) > 7) return fail(400, "\u79DF\u91D1\u987B\u4E3A1\u201310000\u6574\u6570D\u5E01\uFF0C\u79DF\u671F1\u20137\u5929");
  const row = await farmWallet(db, u.id, t), state = row ? JSON.parse(row.state) : null;
  if (!state || plots.some((plot) => !state.plots[plot] || state.plots[plot].crop)) return fail(400, "\u4EC5\u80FD\u6302\u724C\u81EA\u5DF1\u7684\u7A7A\u5730\uFF0C\u6574\u6279\u672A\u4FEE\u6539");
  const r = await db.prepare(`INSERT INTO farm_lease_offers(owner_id,plot,price,days,updated_at) SELECT ?1,value,?3,?4,?5 FROM json_each(?2) WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?6) AND NOT EXISTS(SELECT 1 FROM farm_leases WHERE owner_id=?1 AND plot IN(SELECT value FROM json_each(?2)) AND state='active') ON CONFLICT(owner_id,plot) DO UPDATE SET price=excluded.price,days=excluded.days,updated_at=excluded.updated_at RETURNING plot`).bind(u.id, JSON.stringify(plots), b.price, b.days, t, row.revision).all();
  return r.results.length ? c.json({ offered: true, count: r.results.length }) : fail(409, "\u571F\u5730\u5DF2\u53D8\u5316\u6216\u6B63\u5728\u51FA\u79DF\uFF0C\u6574\u6279\u672A\u4FEE\u6539\uFF0C\u8BF7\u5237\u65B0");
});
farmLeases.post("/api/farm/leases/rent-batch", async (c) => {
  sameOrigin(c);
  const u = needUser(c), b = await boundedJson(c, 16384);
  return c.json(await rentLeaseBatch(c.env.DB, u.id, b, now()));
});
farmLeases.post("/api/farm/leases/rent", async (c) => {
  sameOrigin(c);
  const u = needUser(c), db = c.env.DB, t = now(), b = await boundedJson(c, 2048);
  if (!validId(b.id) || !Number.isSafeInteger(b.owner_id) || Number(b.owner_id) === u.id || !Number.isInteger(b.plot) || Number(b.plot) < 0 || Number(b.plot) >= MAX_FARM_PLOTS || typeof b.forced !== "boolean" || b.confirm !== true) return fail(400, "\u8BF7\u786E\u8BA4\u79DF\u91D1\u548C\u671F\u9650\u540E\u518D\u79DF\u7528");
  const id = u.id + "-" + b.id, prior2 = await db.prepare("SELECT id,price,expires_at FROM farm_leases WHERE id=? AND tenant_id=?").bind(id, u.id).first();
  if (prior2) return c.json({ ...prior2, duplicate: true });
  const owner = Number(b.owner_id), plot = Number(b.plot);
  await settleFarmLeases(db, t, owner);
  const ownerRow = await farmWallet(db, owner, t), tenant = await farmWallet(db, u.id, t), p = ownerRow ? JSON.parse(ownerRow.state).plots[plot] : null;
  if (!p || p.crop || !tenant) return fail(409, "\u8BF7\u5148\u52A0\u8F7D\u81EA\u5DF1\u7684\u519C\u573A\uFF0C\u5E76\u9009\u62E9\u519C\u53CB\u7684\u7A7A\u5730");
  const offer = b.forced ? LEASE_DEFAULT : await db.prepare("SELECT price,days FROM farm_lease_offers WHERE owner_id=? AND plot=?").bind(owner, plot).first();
  if (!offer || b.price !== offer.price || b.days !== offer.days) return fail(409, "\u6302\u724C\u4EF7\u683C\u6216\u79DF\u671F\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u786E\u8BA4");
  if (tenant.balance < offer.price) return fail(400, "D\u5E01\u4F59\u989D\u4E0D\u8DB3");
  const attempt = crypto.randomUUID(), expires = t + offer.days * 86400, gate2 = "EXISTS(SELECT 1 FROM farm_leases WHERE attempt=?)";
  const result = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO farm_leases(id,owner_id,tenant_id,plot,price,started_at,expires_at,forced,state,crop_state,attempt)
   SELECT ?1,?2,?3,?4,?5,?6,?7,?8,'active',?9,?10 WHERE ${activePair}
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?2 AND revision=?11 AND (?8=0 OR owner_operated_at<=?6-${LEASE_IDLE}))
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?3 AND revision=?12)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?3 AND revision=?13 AND balance>=?5)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?2 AND balance<=9007199254740991-?5)
   AND (?8=1 OR EXISTS(SELECT 1 FROM farm_lease_offers WHERE owner_id=?2 AND plot=?4 AND price=?5 AND days=?14))
   AND NOT EXISTS(SELECT 1 FROM farm_leases WHERE owner_id=?2 AND plot=?4 AND state='active') RETURNING id`).bind(id, owner, u.id, plot, offer.price, t, expires, b.forced ? 1 : 0, JSON.stringify(emptyLeasePlot()), attempt, ownerRow.revision, tenant.revision, tenant.wallet_revision, offer.days),
    db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT user_id,CASE WHEN user_id=? THEN 'farm-rent-pay' ELSE 'farm-rent-income' END,?,?,CASE WHEN user_id=? THEN -? ELSE ? END,balance+CASE WHEN user_id=? THEN -? ELSE ? END,? FROM coin52_wallets WHERE user_id IN(?,?) AND ${gate2}`).bind(u.id, id, attempt, u.id, offer.price, offer.price, u.id, offer.price, offer.price, t, u.id, owner, attempt),
    db.prepare(`UPDATE coin52_wallets SET balance=balance+CASE WHEN user_id=? THEN -? ELSE ? END,revision=revision+1,updated_at=? WHERE user_id IN(?,?) AND ${gate2}`).bind(u.id, offer.price, offer.price, t, u.id, owner, attempt),
    db.prepare(`UPDATE farm_saves SET revision=revision+1 WHERE user_id IN(?,?) AND ${gate2}`).bind(u.id, owner, attempt),
    db.prepare(`DELETE FROM farm_lease_offers WHERE owner_id=? AND plot=? AND ${gate2}`).bind(owner, plot, attempt)
  ]);
  if (!result[0].results.length) {
    const done = await db.prepare("SELECT id,price,expires_at FROM farm_leases WHERE id=? AND tenant_id=?").bind(id, u.id).first();
    return done ? c.json({ ...done, duplicate: true }) : fail(409, "\u571F\u5730\u3001\u4F59\u989D\u6216\u4E3B\u4EBA\u7ECF\u8425\u72B6\u6001\u5DF2\u53D8\u5316\uFF0C\u672C\u6B21\u672A\u6263\u79DF\u91D1");
  }
  return c.json({ id, price: offer.price, expires_at: expires, duplicate: false });
});
farmLeases.post("/api/farm/leases/:id/work", async (c) => {
  sameOrigin(c);
  const u = needUser(c), db = c.env.DB, t = now(), b = await boundedJson(c, 2048);
  if (!validId(b.id) || !["plant", "harvest", "pest"].includes(String(b.type)) || b.autoBuy !== void 0 && typeof b.autoBuy !== "boolean") return fail(400, "\u79DF\u5730\u64CD\u4F5C\u683C\u5F0F\u65E0\u6548");
  const lease = await db.prepare("SELECT * FROM farm_leases WHERE id=? AND tenant_id=?").bind(c.req.param("id"), u.id).first();
  if (!lease) return fail(404, "\u79DF\u7EA6\u4E0D\u5B58\u5728");
  try {
    return c.json(await workLease(db, lease, u.id, String(b.id), b.type, b.crop, b.autoBuy === true, t, isOwner(c, u)));
  } catch (e) {
    if (e instanceof Error && "status" in e) throw e;
    return fail(400, e instanceof Error ? e.message : "\u79DF\u5730\u64CD\u4F5C\u5931\u8D25");
  }
});
farmLeases.get("/api/farm/leases/:id/buyback", async (c) => {
  const u = needUser(c), lease = await c.env.DB.prepare("SELECT * FROM farm_leases WHERE id=? AND owner_id=?").bind(c.req.param("id"), u.id).first();
  if (!lease) return fail(404, "\u79DF\u7EA6\u4E0D\u5B58\u5728");
  return c.json(await leaseBuybackQuote(c.env.DB, lease, u.id, now()));
});
farmLeases.post("/api/farm/leases/:id/buyback", async (c) => {
  sameOrigin(c);
  const u = needUser(c), b = await boundedJson(c, 2048);
  if (!validId(b.id) || !Number.isSafeInteger(b.revision) || !Number.isSafeInteger(b.penalty) || !Number.isSafeInteger(b.reward) || b.confirm !== true) return fail(400, "\u8BF7\u67E5\u770B\u4E70\u56DE\u62A5\u4EF7\u540E\u786E\u8BA4");
  const lease = await c.env.DB.prepare("SELECT * FROM farm_leases WHERE id=? AND owner_id=?").bind(c.req.param("id"), u.id).first();
  if (!lease) return fail(404, "\u79DF\u7EA6\u4E0D\u5B58\u5728");
  return c.json(await buybackLease(c.env.DB, lease, u.id, String(b.id), { revision: b.revision, penalty: b.penalty, reward: b.reward }, now()));
});

// src/farm/lease-scene.ts
async function farmLeaseScene(db, uid, t) {
  const [owned, rented] = await db.batch([
    db.prepare(`SELECT l.plot,l.expires_at,l.crop_state,u.username AS tenant_name FROM farm_leases l JOIN users u ON u.id=l.tenant_id WHERE l.owner_id=? AND l.state='active' AND l.expires_at>?`).bind(uid, t),
    db.prepare(`SELECT l.id,l.plot,l.owner_id,u.username AS owner_name,l.expires_at,l.crop_state,l.revision FROM farm_leases l JOIN users u ON u.id=l.owner_id WHERE l.tenant_id=? AND l.state='active' AND l.expires_at>? ORDER BY l.started_at,l.id`).bind(uid, t)
  ]);
  return { locks: owned.results, rented: rented.results };
}
function leaseSceneView(view2, scene) {
  for (const lock of scene.locks) {
    const p = view2.state.plots[lock.plot];
    if (p) Object.assign(p, { leaseUntil: lock.expires_at, leaseTenant: lock.tenant_name, leaseCrop: JSON.parse(lock.crop_state) });
  }
  return { ...view2, rentedPlots: scene.rented.map((l) => ({ ...l, crop_state: JSON.parse(l.crop_state) })) };
}
function applyFarmSceneActions(input, actions, rented, t, permissions) {
  const changed = /* @__PURE__ */ new Map(), plots = [...input.plots], mapped = [];
  const ownTypes = ["till", "plant", "water", "pest", "harvest"], hasLeases = actions.some((a) => String(a?.type).startsWith("lease_"));
  if (!hasLeases) return { ...applyFarmActions(input, actions, t, permissions), leases: [] };
  for (const a of actions) {
    if (!a || typeof a !== "object") throw Error("\u64CD\u4F5C\u683C\u5F0F\u65E0\u6548");
    if (!String(a.type).startsWith("lease_")) {
      if (!ownTypes.includes(String(a.type)) || !Number.isInteger(a.plot) || Number(a.plot) < 0 || Number(a.plot) >= input.plots.length) throw Error("\u79DF\u5730\u7167\u6599\u4E0D\u80FD\u6DF7\u7528\u5176\u4ED6\u64CD\u4F5C\u6216\u5730\u5757\u7F16\u53F7");
      if (permissions.lockedPlots.includes(Number(a.plot))) throw Error("\u8FD9\u5757\u7530\u5730\u5DF2\u51FA\u79DF\uFF0C\u6682\u65F6\u4E0D\u80FD\u64CD\u4F5C");
      mapped.push(a);
      continue;
    }
    const type = String(a.type).slice(6), allowed = type === "plant" ? ["type", "leaseId", "crop", "autoBuy"] : ["type", "leaseId"];
    if (!["plant", "pest", "harvest"].includes(type) || Object.keys(a).some((k) => !allowed.includes(k))) throw Error("\u79DF\u5730\u64CD\u4F5C\u683C\u5F0F\u65E0\u6548");
    const lease = rented.find((l) => l.id === a.leaseId);
    if (!lease || lease.expires_at <= t) throw Error("\u79DF\u7EA6\u5DF2\u5230\u671F\u6216\u4E0D\u5C5E\u4E8E\u4F60\uFF0C\u8BF7\u5237\u65B0\u519C\u573A");
    if (type === "plant") {
      const c = CROPS.find((c2) => c2.id === a.crop);
      if (!c || t + cropMaxSeconds(c.seconds) > lease.expires_at) throw Error("\u79DF\u671F\u4E0D\u8DB3\u4EE5\u8986\u76D6\u6210\u719F\u53CA\u866B\u5BB3\u7F13\u51B2\uFF0C\u8BF7\u9009\u62E9\u751F\u957F\u66F4\u5FEB\u7684\u79CD\u5B50");
    }
    if (!changed.has(lease.id)) {
      changed.set(lease.id, { lease, index: plots.length });
      plots.push(JSON.parse(lease.crop_state));
    }
    const plot = changed.get(lease.id).index;
    mapped.push({ type, plot, ...type === "plant" ? { crop: a.crop, autoBuy: a.autoBuy } : {} });
    if (type === "plant") mapped.push({ type: "water", plot });
  }
  const result = applyFarmActions({ ...input, plots }, mapped, t, { ...permissions, batchLimit: 240 });
  const leases = [...changed.values()].map(({ lease, index: index2 }) => ({ ...lease, crop_state: JSON.stringify(result.state.plots[index2]), revision: lease.revision + 1 }));
  result.state.plots = result.state.plots.slice(0, input.plots.length);
  return { ...result, leases };
}

// src/farm/coin-packets.ts
async function ensureCoinWallet(db, uid, t) {
  await farmWallet(db, uid, t);
  await db.prepare(`INSERT OR IGNORE INTO coin52_wallets(user_id,updated_at) SELECT ?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?)`).bind(uid, t, uid, uid).run();
}

// src/routes/farm-market.ts
import { Hono as Hono3 } from "hono";

// src/shared/community-growth.ts
var COMMUNITY_GROWTH = [
  { series: "resource_respect", name: "\u53D7\u4EBA\u656C\u4EF0", unit: "\u6B21\u8BA4\u53EF", levels: [5, 20, 50, 100, 300], color: "#8a5e94", accent: "#eed3a1", motif: "laurel", desc: "\u8D44\u6E90\u5206\u4EAB\u83B7\u5F97\u4E0D\u540C\u8D26\u53F7\u8BA4\u53EF\uFF1B\u540C\u4EBA\u540C\u5E16\u53EA\u7D2F\u8BA1\u4E00\u6B21\uFF0C\u53D6\u6D88\u540E\u91CD\u52FE\u4E0D\u91CD\u590D\u8BA1\u5165" },
  { series: "card_draws", name: "\u8D4C\u9B3C", unit: "\u6B21\u62BD\u5361", levels: [10, 100, 500, 2e3, 1e4], color: "#9c6a8f", accent: "#e4c4a4", motif: "mask", desc: "\u7D2F\u8BA1\u5B8C\u6210\u62BD\u5361\uFF1B\u4E0D\u8981\u6C42\u4E2D\u5956\uFF0C\u4E0D\u589E\u52A0\u4E2D\u5956\u6982\u7387" },
  { series: "card_wins", name: "\u6B27\u7687\u51FA\u5DE1", unit: "\u6B21\u6C38\u4E45\u79F0\u53F7", levels: [1, 20, 100, 500, 2e3], color: "#bc8b3c", accent: "#e4ce91", motif: "sun", desc: "\u62BD\u5230\u6C38\u4E45\u79F0\u53F7\u7684\u6B21\u6570\uFF0C\u4F53\u9A8C\u5361\u4E0D\u8BA1\u5165" },
  { series: "card_dry", name: "\u975E\u914B\u4E5F\u53D1\u5149", unit: "\u8FDE\u62BD\u672A\u4E2D", levels: [5, 10, 20, 35, 50], color: "#687692", accent: "#c8c9dd", motif: "moon", desc: "\u5386\u53F2\u6700\u957F\u8FDE\u7EED\u672A\u83B7\u6C38\u4E45\u79F0\u53F7\u6B21\u6570\uFF0C\u4FDD\u5E95\u540E\u8363\u8A89\u4ECD\u4FDD\u7559" },
  { series: "scratch_draws", name: "\u5F00\u7968\u8FBE\u4EBA", unit: "\u5F20\u522E\u522E\u4E50", levels: [10, 100, 500, 2e3, 1e4], color: "#4e9790", accent: "#e5ce9c", motif: "lotus", desc: "\u7D2F\u8BA1\u8D2D\u4E70\u7684\u522E\u522E\u4E50\u5F20\u6570" },
  { series: "scratch_wins", name: "\u5F69\u8FD0\u968F\u884C", unit: "\u5F20\u4E2D\u5956\u7968", levels: [1, 30, 150, 600, 3e3], color: "#bb7296", accent: "#d9cdb1", motif: "flower", desc: "\u522E\u522E\u4E50\u83B7\u5F97\u975E\u96F6\u5956\u52B1\u7684\u5F20\u6570" },
  { series: "scratch_jackpot", name: "\u8D4C\u795E", unit: "\u6B21\u5341\u500D\u5F69", levels: [1, 3, 10, 30, 100], color: "#9a7739", accent: "#dcd88b", motif: "star", desc: "\u522E\u522E\u4E50\u5355\u5F20\u83B7\u5F9710\u500D\u53CA\u4EE5\u4E0A\u5956\u52B1\uFF0C\u4E0D\u4EE3\u8868\u672A\u6765\u80DC\u7387" },
  { series: "scratch_dry", name: "\u518D\u8D77\u4E0D\u80FD", unit: "\u8FDE\u5F20\u672A\u4E2D", levels: [3, 6, 10, 15, 25], color: "#8b7e9b", accent: "#becbda", motif: "cloud", desc: "\u522E\u522E\u4E50\u5386\u53F2\u6700\u957F\u8FDE\u7EED\u672A\u4E2D\u5956\u5F20\u6570\uFF1B\u7528\u4E8E\u8BB0\u5F55\u8DA3\u5473\u7ECF\u5386" },
  { series: "lotto_wins", name: "\u4E03\u661F\u6765\u5BA2", unit: "\u6CE8\u4E2D\u5956", levels: [1, 5, 20, 100, 500], color: "#527da0", accent: "#c9d9a4", motif: "star", desc: "\u5927\u4E50\u900F\u5DF2\u5B8C\u6210\u53D1\u5956\u7684\u4E2D\u5956\u6CE8\u6570" },
  { series: "coins_peak", name: "\u91D1\u5E93\u4E3B\u4EBA", unit: "\u679A\u6700\u9AD8\u4F59\u989D", levels: [1e3, 1e4, 1e5, 1e6, 1e7], color: "#ad8a40", accent: "#e6cda0", motif: "sun", desc: "\u8D26\u6237\u66FE\u8FBE\u5230\u7684\u6700\u9AD8D\u5E01\u4F59\u989D\uFF1B\u6D88\u8D39\u4E0D\u64A4\u56DE\u5DF2\u83B7\u8363\u8A89" },
  { series: "market_trades", name: "\u96C6\u5E02\u884C\u5BB6", unit: "\u7B14\u4EA4\u6613", levels: [1, 20, 100, 500, 2e3], color: "#688f7d", accent: "#e2c79c", motif: "sprout", desc: "\u52A8\u6001\u96C6\u5E02\u6210\u529F\u4E70\u5165\u6216\u552E\u51FA\u4EA4\u6613\u7B14\u6570" },
  { series: "market_sold", name: "\u4E30\u6536\u638C\u67DC", unit: "\u679A\u9500\u552E\u6536\u5165", levels: [100, 1e3, 1e4, 1e5, 1e6], color: "#ae8055", accent: "#d8d79e", motif: "lotus", desc: "\u52A8\u6001\u96C6\u5E02\u7D2F\u8BA1\u552E\u51FA\u6536\u5165\uFF0C\u6536\u5165\u4E0D\u7B49\u4E8E\u5229\u6DA6" },
  { series: "raid_wins", name: "\u63A0\u5F71\u6E38\u4FA0", unit: "\u6B21\u884C\u52A8\u6210\u529F", levels: [1, 5, 20, 100, 500], color: "#916e76", accent: "#d7bfa0", motif: "blade", desc: "\u5BF9\u6297\u8D27\u4ED3\u884C\u52A8\u5224\u5B9A\u6210\u529F\u6B21\u6570\uFF1B\u4EC5\u9650\u53CC\u65B9\u52A0\u5165\u7684\u5BF9\u6297\u73A9\u6CD5" },
  { series: "defend_wins", name: "\u94C1\u58C1\u5B88\u671B", unit: "\u6B21\u9632\u5B88\u6210\u529F", levels: [1, 5, 20, 100, 500], color: "#5c8794", accent: "#b9d1cd", motif: "halberd", desc: "\u5BF9\u6297\u884C\u52A8\u88AB\u6210\u529F\u963B\u6B62\u7684\u6B21\u6570" },
  { series: "uprising_wins", name: "\u63ED\u7AFF\u540C\u76DF", unit: "\u6B21\u8FFD\u7D22\u6210\u529F", levels: [1, 3, 10, 30, 100], color: "#b37a5b", accent: "#e2c882", motif: "spear", desc: "\u53C2\u4E0E\u5E76\u6210\u529F\u8FFD\u56DE\u7269\u8D44\u7684\u8D77\u4E49\u6B21\u6570" }
];
var COMMUNITY_REWARDS = COMMUNITY_GROWTH.flatMap((f) => f.levels.map((wins, i) => ({ ...f, id: f.series + (i + 1), label: f.name, level: i + 1, wins, symbol: "\u2726" })));

// src/community-growth.ts
function communityProgressStatements(db, uid, values, t, gate2, bindings, maximum = false) {
  const guard = gate2.replace(/\?\d+/g, "?");
  const records = Object.entries(values).filter(([id, n]) => COMMUNITY_GROWTH.some((x) => x.series === id) && Number.isSafeInteger(n) && n > 0).map(([metric, value]) => ({ metric, value }));
  if (!records.length) return [];
  const definitions = COMMUNITY_GROWTH.filter((x) => records.some((r) => r.metric === x.series)), day = new Date((t + 28800) * 1e3).toISOString().slice(0, 10);
  return [
    db.prepare(`INSERT INTO community_progress(user_id,metric,value) SELECT ?,json_extract(value,'$.metric'),json_extract(value,'$.value') FROM json_each(?) WHERE ${guard}
    ON CONFLICT(user_id,metric) DO UPDATE SET value=${maximum ? "excluded.value" : "MIN(9007199254740991,community_progress.value+excluded.value)"} WHERE ${maximum ? "community_progress.value<excluded.value" : "community_progress.value<9007199254740991"}`).bind(uid, JSON.stringify(records), ...bindings),
    db.prepare(`INSERT INTO user_badges(user_id,badge,n,first_at,last_day) SELECT ?,p.metric,p.value,?,? FROM community_progress p JOIN json_each(?) d ON json_extract(d.value,'$.series')=p.metric WHERE p.user_id=? AND p.value>=json_extract(d.value,'$.levels[0]') AND ${guard}
    ON CONFLICT(user_id,badge) DO UPDATE SET n=excluded.n,last_day=MAX(user_badges.last_day,excluded.last_day) WHERE user_badges.n<excluded.n`).bind(uid, t, day, JSON.stringify(definitions), uid, ...bindings),
    db.prepare(`INSERT OR IGNORE INTO user_unlocks(user_id,item,at) SELECT ?,p.metric||':'||(CAST(l.key AS INTEGER)+1),? FROM community_progress p JOIN json_each(?) d ON json_extract(d.value,'$.series')=p.metric JOIN json_each(json_extract(d.value,'$.levels')) l WHERE p.user_id=? AND p.value>=l.value AND ${guard}`).bind(uid, t, JSON.stringify(definitions), uid, ...bindings),
    db.prepare(`UPDATE users SET deco=json_set(deco,'$.bn',(SELECT n FROM user_badges WHERE user_id=users.id AND badge=json_extract(users.deco,'$.bd'))) WHERE id=? AND json_valid(deco) AND json_extract(deco,'$.bd') IN (SELECT json_extract(value,'$.metric') FROM json_each(?)) AND EXISTS(SELECT 1 FROM user_badges WHERE user_id=users.id AND badge=json_extract(users.deco,'$.bd') AND n!=COALESCE(json_extract(users.deco,'$.bn'),0)) AND ${guard}`).bind(uid, JSON.stringify(records), ...bindings)
  ];
}

// src/farm/market-age.ts
function remainingStockSeconds(g, t) {
  return Math.max(0, g.fresh_seconds - g.fresh_qty * Math.max(0, t - g.fresh_at));
}
function effectiveStock(g, t, growSeconds) {
  return Math.floor(Math.max(0, Math.min(g.fresh_qty, remainingStockSeconds(g, t) / shelfLife(growSeconds))));
}

// src/farm/market-import.ts
var HISTORIC_LIFE = 7 * 86400;
function planMarketImport(original, t) {
  const state = structuredClone(original), counts = inventoryCounts(state);
  const entries = MARKET_ITEMS.flatMap((i) => {
    const quantity = Math.min(counts[i.key] ?? 0, original.market ? original.market.legacy[i.key] ?? 0 : counts[i.key] ?? 0);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return [];
    const parts = original.market ? stockBreakdown({ stockOrigins: original.market.legacyOrigins }, i.key, quantity) : stockBreakdown(state, i.key, quantity);
    if (i.kind !== "fish" && parts.legacy) {
      state.stockOrigins ??= {};
      state.stockOrigins[i.key] ??= { grown: 0, stolen: 0 };
      state.stockOrigins[i.key].grown += parts.legacy;
    }
    return [["grown", quantity - parts.stolen], ["stolen", parts.stolen]].filter(([, n]) => n > 0).map(([source, n]) => ({ id: "historic-" + crypto.randomUUID(), item: i.key, source, quantity: n, base: i.price * 100, born: t, expires: t + HISTORIC_LIFE }));
  });
  state.market = { version: 1, legacy: {}, legacyOrigins: {}, importedAt: t };
  return { state, entries, quantity: entries.reduce((n, l) => n + l.quantity, 0) };
}

// src/farm/market-reserve.ts
var RESERVE_ITEMS = ["crop", "animal", "fish"].flatMap((kind) => MARKET_ITEMS.filter((i) => i.kind === kind).slice(0, 8).map((i) => ({ ...i, target: kind === "crop" ? 80 : kind === "animal" ? 40 : 24 })));
async function replenishMarket(db, t) {
  const tick = Math.floor(t / 600) * 600;
  const data = RESERVE_ITEMS.map((i) => ({ item: i.key, target: i.target, base: i.price * 100, expires: tick + Math.max(7200, shelfLife(i.seconds)) }));
  return db.prepare(`INSERT OR IGNORE INTO farm_market_supply_grants(id,item,quantity,base_cents,born_at,expires_at)
 SELECT 'reserve-'||?1||'-'||item,item,target-stock,base,?1,expires FROM (
 SELECT json_extract(j.value,'$.item') AS item,json_extract(j.value,'$.target') AS target,
 json_extract(j.value,'$.base') AS base,json_extract(j.value,'$.expires') AS expires,
 COALESCE((SELECT SUM(quantity) FROM farm_market_lots WHERE owner_id=0 AND item=json_extract(j.value,'$.item') AND expires_at>?2 AND quantity>0),0) AS stock
 FROM json_each(?3) j) WHERE stock<target/2`).bind(tick, t, JSON.stringify(data)).run();
}

// src/farm/market.ts
async function marketEnabled(db) {
  return (await db.prepare("SELECT v FROM site_settings WHERE k='farm.market.enabled'").first())?.v === "on";
}
var receiptGate = "EXISTS(SELECT 1 FROM farm_market_receipts WHERE attempt=?)";
var alive = `EXISTS(SELECT 1 FROM users WHERE id=?1 AND kind='user' AND disabled=0) AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1)`;
async function receipt(db, uid, id, hash) {
  const row = await db.prepare("SELECT request_hash,result FROM farm_market_receipts WHERE user_id=? AND request_id=?").bind(uid, id).first();
  if (!row) return null;
  if (row.request_hash !== hash) fail(409, "\u64CD\u4F5C\u7F16\u53F7\u5DF2\u88AB\u4F7F\u7528\uFF0C\u8BF7\u5237\u65B0\u5E02\u573A");
  return { ...JSON.parse(row.result), duplicate: true };
}
async function enrollMarket(db, uid, id, t) {
  const hash = await sha256("market-enroll-v1"), done = await receipt(db, uid, id, hash);
  if (done) return done;
  if (!await marketEnabled(db)) return fail(409, "\u884C\u60C5\u5E02\u573A\u5C1A\u672A\u5F00\u653E");
  const row = await farmWallet(db, uid, t);
  if (!row) return fail(409, "\u8BF7\u5148\u6253\u5F00\u519C\u573A");
  const old = projectFarm(JSON.parse(row.state), t);
  if (old.market?.importedAt) return { active: true, duplicate: true };
  const { state: s, entries, quantity } = planMarketImport(old, t);
  const attempt = crypto.randomUUID(), result = { active: true, message: `\u884C\u60C5\u4ED3\u5E93\u5DF2\u5F00\u901A\uFF0C${quantity}\u4EFD\u5386\u53F2\u7269\u4EA7\u5DF2\u8FC1\u5165\u5E76\u83B7\u5F977\u5929\u65B0\u9C9C\u4FDD\u62A4\u671F\uFF1B\u6570\u91CF\u548C\u94B1\u5305\u4F59\u989D\u4FDD\u6301\u4E0D\u53D8\u3002` };
  const saved = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO farm_market_receipts(user_id,request_id,request_hash,attempt,kind,result,created_at)
   SELECT ?1,?2,?3,?4,'enroll',?5,?6 WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?7) AND ${alive} RETURNING attempt`).bind(uid, id, hash, attempt, JSON.stringify(result), t, row.revision),
    db.prepare(`INSERT INTO farm_market_imports(user_id,original_state,migrated_state,source_revision,quantities,attempt,created_at) SELECT ?,?,?,?,?,?,? WHERE ${receiptGate}`).bind(uid, row.state, JSON.stringify(s), row.revision, JSON.stringify(entries), attempt, t, attempt)
  ]);
  if (!saved[0].results.length) return await receipt(db, uid, id, hash) ?? fail(409, "\u519C\u573A\u521A\u521A\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5");
  return result;
}
async function tradeMarket(db, uid, input, t) {
  const hash = await sha256(JSON.stringify(input)), done = await receipt(db, uid, input.id, hash);
  if (done) return done;
  if (input.kind === "buy" && !await marketEnabled(db)) return fail(409, "\u5E02\u573A\u6682\u505C\u65B0\u4E70\u5165\uFF0C\u5DF2\u6709\u5E93\u5B58\u4ECD\u53EF\u51FA\u552E");
  const row = await farmWallet(db, uid, t);
  if (!row) return fail(409, "\u8BF7\u5148\u6253\u5F00\u519C\u573A");
  const [acc, lot] = await Promise.all([
    db.prepare("SELECT remainder_cents,revision FROM farm_market_accounts WHERE user_id=?").bind(uid).first(),
    db.prepare("SELECT * FROM farm_market_lots WHERE id=? AND owner_id=?").bind(input.lot, input.kind === "buy" ? 0 : uid).first()
  ]);
  if (!acc) return fail(409, "\u8BF7\u5148\u5F00\u901A\u884C\u60C5\u4ED3\u5E93");
  if (!lot || lot.quantity - lot.locked_quantity < input.quantity) return fail(409, "\u6279\u6B21\u6570\u91CF\u4E0D\u8DB3\u6216\u5DF2\u88AB\u51BB\u7ED3\uFF0C\u8BF7\u5237\u65B0");
  if (t < lot.cooldown_until) return fail(400, "\u4EA4\u6613\u51B7\u5374\u5C1A\u672A\u7ED3\u675F\uFF0C\u4FDD\u8D28\u671F\u4ECD\u5728\u7EE7\u7EED");
  const good = await db.prepare("SELECT * FROM farm_market_goods WHERE item=?").bind(lot.item).first();
  if (!good) return fail(409, "\u884C\u60C5\u5C1A\u672A\u5C31\u7EEA");
  const buy = input.kind === "buy", rotten = t >= lot.expires_at;
  if (buy && rotten) return fail(409, "\u8BE5\u6279\u6B21\u5DF2\u8FC7\u671F\uFF0C\u5546\u5E97\u4E0D\u4F1A\u51FA\u552E\u8150\u70C2\u5546\u54C1");
  const unit = buy ? Math.ceil(good.price_cents * 110 / 100) : good.price_cents;
  if (input.price !== unit) return fail(409, "\u53C2\u8003\u4EF7\u683C\u5DF2\u53D8\u5316\uFF0C\u8BF7\u67E5\u770B\u65B0\u4EF7\u683C\u540E\u786E\u8BA4");
  const total = Math.floor(unit * input.quantity / (rotten ? 10 : 1));
  if (input.expected_total !== void 0 && input.expected_total !== total) return fail(409, "\u6279\u6B21\u4FDD\u8D28\u671F\u6216\u62A5\u4EF7\u5DF2\u53D8\u5316\uFF0C\u8BF7\u67E5\u770B\u66F4\u65B0\u540E\u7684\u91D1\u989D\u540E\u91CD\u65B0\u786E\u8BA4");
  const money = marketMoney(row.balance, acc.remainder_cents, buy ? -total : total);
  const s = projectFarm(JSON.parse(row.state), t);
  if (!s.market) return fail(409, "\u884C\u60C5\u4ED3\u5E93\u72B6\u6001\u5F02\u5E38\uFF0C\u8BF7\u5237\u65B0");
  changeInventory(s, lot.item, buy ? input.quantity : -input.quantity);
  if (!buy && !lot.item.startsWith("fish:")) consumeStock(s, lot.item, inventoryCounts(s)[lot.item] + input.quantity, input.quantity, lot.source === "market" ? void 0 : lot.source);
  s.coins = money.balance;
  const split = buy || rotten ? { shop: 0, consumed: input.quantity, carry: good.split_carry } : marketSplit(input.quantity, good.split_carry);
  const attempt = crypto.randomUUID(), result = { kind: input.kind, item: lot.item, quantity: input.quantity, total_cents: total, rotten, balance: money.balance, remainder_cents: money.remainder, expires_at: lot.expires_at, cooldown_until: buy ? t + MARKET_RULES.cooldownSeconds : 0 };
  const transfer = buy ? input.quantity : split.shop, newOwner = buy ? uid : 0, source = buy ? "market" : lot.source, cooldown = buy ? t + MARKET_RULES.cooldownSeconds : 0;
  const freshRemoved = buy ? 0 : lot.expired ? 0 : input.quantity - (rotten ? 0 : split.shop);
  const batch = [
    db.prepare(`INSERT OR IGNORE INTO farm_market_receipts(user_id,request_id,request_hash,attempt,kind,item,quantity,total_cents,result,created_at)
   SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10 WHERE ${alive}
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?11)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND revision=?12)
   AND EXISTS(SELECT 1 FROM farm_market_accounts WHERE user_id=?1 AND revision=?13)
   AND EXISTS(SELECT 1 FROM farm_market_lots WHERE id=?14 AND owner_id=?15 AND revision=?16 AND quantity-locked_quantity>=?7)
   AND EXISTS(SELECT 1 FROM farm_market_goods WHERE item=?6 AND revision=?17)
   AND (SELECT count(*) FROM farm_market_receipts WHERE user_id=?1 AND created_at>=?10-60)<30 RETURNING attempt`).bind(uid, input.id, hash, attempt, input.kind, lot.item, input.quantity, total, JSON.stringify(result), t, row.revision, row.wallet_revision, acc.revision, lot.id, lot.owner_id, lot.revision, good.revision),
    db.prepare(`UPDATE farm_market_lots SET quantity=quantity-?,revision=revision+1 WHERE id=? AND ${receiptGate}`).bind(input.quantity, lot.id, attempt),
    db.prepare(`INSERT INTO farm_market_lots(id,owner_id,item,source,quantity,born_at,expires_at,cooldown_until)
   SELECT ?,?,?,?,?,?,?,? WHERE ?>0 AND ${receiptGate}
   ON CONFLICT(owner_id,item,source,born_at,expires_at,cooldown_until,expired) DO UPDATE SET quantity=quantity+excluded.quantity,revision=revision+1`).bind(crypto.randomUUID(), newOwner, lot.item, source, transfer, lot.born_at, lot.expires_at, cooldown, transfer, attempt),
    db.prepare(`UPDATE farm_market_goods SET fresh_seconds=fresh_seconds-?*(?-fresh_at),fresh_qty=fresh_qty-?,sold_flow=sold_flow+?,bought_flow=bought_flow+?,split_carry=?,revision=revision+1 WHERE item=? AND ${receiptGate}`).bind(freshRemoved, lot.expires_at, freshRemoved, !buy && !rotten ? input.quantity : 0, buy ? input.quantity : 0, split.carry, lot.item, attempt),
    db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?,'farm-market',?,?,?,?,? WHERE ${receiptGate}`).bind(uid, input.id, attempt, money.delta, money.balance, t, attempt),
    db.prepare(`UPDATE coin52_wallets SET balance=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${receiptGate}`).bind(money.balance, t, uid, attempt),
    db.prepare(`UPDATE farm_market_accounts SET remainder_cents=?,revision=revision+1 WHERE user_id=? AND ${receiptGate}`).bind(money.remainder, uid, attempt),
    db.prepare(`UPDATE farm_saves SET state=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${receiptGate}`).bind(JSON.stringify(s), t, uid, attempt),
    db.prepare(`DELETE FROM farm_market_lots WHERE id=? AND quantity=0 AND ${receiptGate}`).bind(lot.id, attempt)
  ];
  batch.push(...communityProgressStatements(db, uid, { market_trades: 1, market_sold: buy ? 0 : Math.floor(total / 100) }, t, receiptGate, [attempt]));
  const written = await db.batch(batch);
  if (!written[0].results.length) return await receipt(db, uid, input.id, hash) ?? fail(409, "\u4EA4\u6613\u51B2\u7A81\u6216\u64CD\u4F5C\u8FC7\u5FEB\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  return result;
}
async function settleMarket(db, t) {
  await replenishMarket(db, t);
  const expired = (await db.prepare("SELECT * FROM farm_market_lots WHERE expired=0 AND quantity>0 AND expires_at<=? ORDER BY expires_at,id LIMIT 40").bind(t).all()).results;
  for (const lot of expired) {
    await db.batch([
      db.prepare("UPDATE farm_market_goods SET fresh_seconds=fresh_seconds-?*(?-fresh_at),fresh_qty=fresh_qty-?,revision=revision+1 WHERE item=? AND EXISTS(SELECT 1 FROM farm_market_lots WHERE id=? AND revision=? AND expired=0)").bind(lot.quantity, lot.expires_at, lot.quantity, lot.item, lot.id, lot.revision),
      db.prepare("UPDATE farm_market_lots SET expired=1,revision=revision+1 WHERE id=? AND revision=? AND expired=0").bind(lot.id, lot.revision),
      db.prepare("DELETE FROM farm_market_lots WHERE id=? AND owner_id=0 AND expired=1 AND locked_quantity=0").bind(lot.id)
    ]);
  }
  if (expired.length === 40) return { expired: expired.length, ticks: 0, pending: true };
  const tick = Math.floor(t / 600) * 600, goods = (await db.prepare("SELECT * FROM farm_market_goods WHERE tick_at<? ORDER BY item LIMIT 192").bind(tick).all()).results;
  let ticks = 0;
  for (const g of goods) {
    const spec = MARKET_ITEMS.find((i) => i.key === g.item);
    if (!spec) continue;
    const effective = effectiveStock(g, t, spec.seconds), price = marketPrice({ price: g.price_cents, base: g.base_cents, fresh: effective, sold: g.sold_flow, bought: g.bought_flow });
    const done = await db.batch([
      db.prepare(`INSERT OR IGNORE INTO farm_market_ticks(item,tick_at,price_cents,fresh_qty,sold,bought,effective_qty) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM farm_market_goods WHERE item=? AND revision=? AND tick_at<?)`).bind(g.item, tick, price, g.fresh_qty, g.sold_flow, g.bought_flow, effective, g.item, g.revision, tick),
      db.prepare(`UPDATE farm_market_goods SET fresh_seconds=?,fresh_at=?,effective_qty=?,price_cents=?,tick_at=?,sold_flow=0,bought_flow=0,revision=revision+1 WHERE item=? AND revision=? AND tick_at<? AND EXISTS(SELECT 1 FROM farm_market_ticks WHERE item=? AND tick_at=?) RETURNING item`).bind(remainingStockSeconds(g, t), Math.max(t, g.fresh_at), effective, price, tick, g.item, g.revision, tick, g.item, tick)
    ]);
    ticks += done[1].results.length;
  }
  await db.prepare("DELETE FROM farm_market_ticks WHERE (item,tick_at) IN (SELECT item,tick_at FROM farm_market_ticks WHERE tick_at<? ORDER BY tick_at LIMIT 200)").bind(t - 7 * 86400).run();
  return { expired: expired.length, ticks, pending: false };
}

// src/farm/market-shop.ts
function shopQuery(db, url, t) {
  const q = new URL(url).searchParams, sort = q.get("shop_sort") || "expiry", kind = q.get("shop_kind") || "", search = (q.get("shop_q") || "").trim(), source = q.get("shop_source") || "", item = q.get("item") || "";
  const sorts = { expiry: ["l.expires_at", "ASC"], fresh: ["l.expires_at", "DESC"], price: ["g.price_cents", "ASC"], price_desc: ["g.price_cents", "DESC"], quantity: ["l.quantity", "DESC"], newest: ["l.born_at", "DESC"] };
  if (!sorts[sort] || !["", "crop", "animal", "fish"].includes(kind) || !["", "player", "initial"].includes(source) || search.length > 60) fail(400, "\u5546\u5E97\u7B5B\u9009\u65E0\u6548");
  const integer = (key, max2) => {
    const raw = q.get(key);
    if (!raw) return 0;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 0 || n > max2) fail(400, "\u5546\u5E97\u4EF7\u683C\u6216\u6570\u91CF\u8303\u56F4\u65E0\u6548");
    return n;
  };
  const max = integer("shop_max", 1e8), minQty = integer("shop_qty", 1e4), fresh = integer("shop_fresh", 604800);
  const where = ["l.owner_id=0", "l.quantity>0", "l.expires_at>?"], args = [t + fresh];
  const keys = MARKET_ITEMS.filter((c) => (!item || c.key === item) && (!kind || c.kind === kind) && (!search || c.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))).map((c) => c.key);
  if (item || kind || search) {
    where.push("l.item IN (SELECT value FROM json_each(?))");
    args.push(JSON.stringify(keys));
  }
  if (max) {
    where.push("(g.price_cents*110+99)/100<=?");
    args.push(max);
  }
  if (minQty) {
    where.push("l.quantity>=?");
    args.push(minQty);
  }
  if (source) where.push(source === "initial" ? "l.id LIKE 'initial-%'" : "l.id NOT LIKE 'initial-%'");
  const [column, direction] = sorts[sort], signature = JSON.stringify([sort, item, kind, search, source, max, minQty, fresh]), cursor = q.get("shop_after");
  if (cursor) {
    let a;
    try {
      a = JSON.parse(cursor);
    } catch {
      return fail(400, "\u5546\u5E97\u5206\u9875\u4F4D\u7F6E\u65E0\u6548");
    }
    if (!Array.isArray(a) || a.length !== 3 || !Number.isSafeInteger(a[0]) || typeof a[1] !== "string" || a[1].length > 100 || a[2] !== signature) return fail(400, "\u7B5B\u9009\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u5546\u5E97");
    where.push(`(${column}${direction === "ASC" ? ">" : "<"}? OR (${column}=? AND l.id>?))`);
    args.push(a[0], a[0], a[1]);
  }
  return { statement: db.prepare(`SELECT l.*,g.price_cents,${column} AS shop_sort_value FROM farm_market_lots l JOIN farm_market_goods g ON g.item=l.item WHERE ${where.join(" AND ")} ORDER BY ${column} ${direction},l.id ASC LIMIT 61`).bind(...args), signature };
}

// src/farm/market-quotes.ts
var QUOTE_TTL = 20;
async function marketQuotes(db, origin, t, item, cache) {
  const key = new Request(new URL("/__internal-cache/farm-market-age-v1/" + (item ? "history/" + encodeURIComponent(item) : "goods"), origin));
  const limit = item ? 144 : 192;
  if (cache) try {
    const hit = await cache.match(key);
    if (hit) {
      const value2 = await hit.json();
      if (Number.isSafeInteger(value2.sampled_at) && value2.sampled_at <= t && t - value2.sampled_at < QUOTE_TTL && Array.isArray(value2.rows) && value2.rows.length <= limit) return value2;
    }
  } catch {
  }
  const rows = item ? (await db.prepare("SELECT tick_at,price_cents,fresh_qty,sold,bought,effective_qty FROM farm_market_ticks WHERE item=? AND tick_at>=? AND tick_at<=? ORDER BY tick_at DESC LIMIT 144").bind(item, t - 86400, t).all()).results.reverse() : (await db.prepare("SELECT item,base_cents,price_cents,fresh_qty,effective_qty,tick_at FROM farm_market_goods ORDER BY item LIMIT 192").all()).results;
  const value = { sampled_at: t, rows };
  if (cache) try {
    await cache.put(key, new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${QUOTE_TTL}` } }));
  } catch {
  }
  return value;
}

// src/farm/market-bulk.ts
async function sellMarketBatch(db, uid, id, requested, t) {
  if (!Array.isArray(requested) || !requested.length || requested.length > 60 || new Set(requested.map((l) => l?.id)).size !== requested.length || requested.some((l) => !l || typeof l.id !== "string" || ![l.quantity, l.price, l.total].every(Number.isSafeInteger) || l.quantity < 1 || l.quantity > 1e4 || l.price < 1 || l.total < 0)) return fail(400, "\u6279\u91CF\u51FA\u552E\u53C2\u6570\u65E0\u6548");
  const hash = await sha256(JSON.stringify(requested)), prior2 = async () => {
    const r = await db.prepare("SELECT request_hash,result FROM farm_market_receipts WHERE user_id=? AND request_id=?").bind(uid, id).first();
    if (!r) return null;
    if (r.request_hash !== hash) fail(409, "\u64CD\u4F5C\u7F16\u53F7\u5DF2\u88AB\u4F7F\u7528");
    return { ...JSON.parse(r.result), duplicate: true };
  };
  const done = await prior2();
  if (done) return done;
  const row = await farmWallet(db, uid, t);
  if (!row) return fail(409, "\u8BF7\u5148\u6253\u5F00\u519C\u573A");
  const [acc, rows] = await Promise.all([
    db.prepare("SELECT remainder_cents,revision FROM farm_market_accounts WHERE user_id=?").bind(uid).first(),
    db.prepare(`SELECT l.*,g.price_cents,g.split_carry,g.revision AS good_revision FROM json_each(?) j CROSS JOIN farm_market_lots l ON l.id=json_extract(j.value,'$.id') JOIN farm_market_goods g ON g.item=l.item WHERE l.owner_id=?`).bind(JSON.stringify(requested), uid).all()
  ]);
  if (!acc || rows.results.length !== requested.length) return fail(409, "\u5E93\u5B58\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0");
  const s = projectFarm(JSON.parse(row.state), t);
  if (!s.market) return fail(409, "\u8BF7\u5148\u5F00\u901A\u884C\u60C5\u4ED3\u5E93");
  const lots = rows.results.map((l) => {
    const q = requested.find((r) => r.id === l.id);
    const rotten = t >= l.expires_at, total2 = Math.floor(l.price_cents * q.quantity / (rotten ? 10 : 1));
    if (l.cooldown_until > t || q.quantity > l.quantity - l.locked_quantity || q.price !== l.price_cents || q.total !== total2) fail(409, "\u5E93\u5B58\u3001\u4FDD\u8D28\u671F\u6216\u62A5\u4EF7\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u786E\u8BA4");
    return { ...l, sell: q.quantity, rotten, total: total2 };
  });
  const goods = /* @__PURE__ */ new Map(), transfers = [];
  for (const l of lots) {
    const g = goods.get(l.item) ?? { item: l.item, revision: l.good_revision, carry: l.split_carry, sold: 0, removed: 0, seconds: 0 };
    goods.set(l.item, g);
    const split = l.rotten ? { shop: 0, carry: g.carry } : marketSplit(l.sell, g.carry);
    g.carry = split.carry;
    g.sold += l.rotten ? 0 : l.sell;
    const removed = l.expired ? 0 : l.sell - split.shop;
    g.removed += removed;
    g.seconds += removed * l.expires_at;
    if (split.shop) transfers.push({ id: crypto.randomUUID(), item: l.item, source: l.source, quantity: split.shop, born: l.born_at, expires: l.expires_at });
    const old = inventoryCounts(s)[l.item];
    changeInventory(s, l.item, -l.sell);
    if (!l.item.startsWith("fish:")) consumeStock(s, l.item, old, l.sell, l.source === "market" ? void 0 : l.source);
  }
  const total = lots.reduce((n, l) => n + l.total, 0), quantity = lots.reduce((n, l) => n + l.sell, 0), money = marketMoney(row.balance, acc.remainder_cents, total);
  s.coins = money.balance;
  const attempt = crypto.randomUUID(), gate2 = "EXISTS(SELECT 1 FROM farm_market_receipts WHERE attempt=?)", lotJson = JSON.stringify(lots.map((l) => ({ id: l.id, revision: l.revision, quantity: l.sell }))), goodJson = JSON.stringify([...goods.values()]), transferJson = JSON.stringify(transfers);
  const result = { kind: "sell_batch", batches: lots.length, quantity, total_cents: total, balance: money.balance, remainder_cents: money.remainder };
  const writes = [
    db.prepare(`INSERT OR IGNORE INTO farm_market_receipts(user_id,request_id,request_hash,attempt,kind,quantity,total_cents,result,created_at)
   SELECT ?1,?2,?3,?4,'sell_batch',?5,?6,?7,?8 WHERE EXISTS(SELECT 1 FROM users WHERE id=?1 AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1)
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?9) AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND revision=?10) AND EXISTS(SELECT 1 FROM farm_market_accounts WHERE user_id=?1 AND revision=?11)
   AND NOT EXISTS(SELECT 1 FROM json_each(?12) j LEFT JOIN farm_market_lots l ON l.id=json_extract(j.value,'$.id') WHERE l.id IS NULL OR l.owner_id<>?1 OR l.revision<>json_extract(j.value,'$.revision'))
   AND NOT EXISTS(SELECT 1 FROM json_each(?13) j LEFT JOIN farm_market_goods g ON g.item=json_extract(j.value,'$.item') WHERE g.item IS NULL OR g.revision<>json_extract(j.value,'$.revision'))
   AND (SELECT count(*) FROM farm_market_receipts WHERE user_id=?1 AND created_at>=?8-60)<30 RETURNING attempt`).bind(uid, id, hash, attempt, quantity, total, JSON.stringify(result), t, row.revision, row.wallet_revision, acc.revision, lotJson, goodJson),
    db.prepare(`UPDATE farm_market_lots SET quantity=quantity-(SELECT json_extract(value,'$.quantity') FROM json_each(?) WHERE json_extract(value,'$.id')=farm_market_lots.id),revision=revision+1 WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${gate2}`).bind(lotJson, lotJson, attempt),
    db.prepare(`INSERT INTO farm_market_lots(id,owner_id,item,source,quantity,born_at,expires_at) SELECT json_extract(value,'$.id'),0,json_extract(value,'$.item'),json_extract(value,'$.source'),json_extract(value,'$.quantity'),json_extract(value,'$.born'),json_extract(value,'$.expires') FROM json_each(?) WHERE ${gate2} ON CONFLICT(owner_id,item,source,born_at,expires_at,cooldown_until,expired) DO UPDATE SET quantity=quantity+excluded.quantity,revision=revision+1`).bind(transferJson, attempt),
    db.prepare(`UPDATE farm_market_goods SET fresh_seconds=fresh_seconds-(SELECT json_extract(value,'$.seconds')-json_extract(value,'$.removed')*farm_market_goods.fresh_at FROM json_each(?1) WHERE json_extract(value,'$.item')=farm_market_goods.item),fresh_qty=fresh_qty-(SELECT json_extract(value,'$.removed') FROM json_each(?1) WHERE json_extract(value,'$.item')=farm_market_goods.item),sold_flow=sold_flow+(SELECT json_extract(value,'$.sold') FROM json_each(?1) WHERE json_extract(value,'$.item')=farm_market_goods.item),split_carry=(SELECT json_extract(value,'$.carry') FROM json_each(?1) WHERE json_extract(value,'$.item')=farm_market_goods.item),revision=revision+1 WHERE item IN(SELECT json_extract(value,'$.item') FROM json_each(?1)) AND EXISTS(SELECT 1 FROM farm_market_receipts WHERE attempt=?2)`).bind(goodJson, attempt),
    db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?,'farm-market',?,?,?,?,? WHERE ${gate2}`).bind(uid, id, attempt, money.delta, money.balance, t, attempt),
    db.prepare(`UPDATE coin52_wallets SET balance=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate2}`).bind(money.balance, t, uid, attempt),
    db.prepare(`UPDATE farm_market_accounts SET remainder_cents=?,revision=revision+1 WHERE user_id=? AND ${gate2}`).bind(money.remainder, uid, attempt),
    db.prepare(`UPDATE farm_saves SET state=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate2}`).bind(JSON.stringify(s), t, uid, attempt),
    db.prepare(`DELETE FROM farm_market_lots WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND quantity=0 AND ${gate2}`).bind(lotJson, attempt),
    ...communityProgressStatements(db, uid, { market_trades: 1, market_sold: Math.floor(total / 100) }, t, gate2, [attempt])
  ];
  const written = await db.batch(writes);
  if (!written[0].results.length) return await prior2() ?? fail(409, "\u5E93\u5B58\u521A\u521A\u53D1\u751F\u53D8\u5316\u6216\u64CD\u4F5C\u8FC7\u5FEB\uFF0C\u8BF7\u5237\u65B0\u91CD\u8BD5");
  return result;
}

// src/routes/farm-market.ts
var farmMarket = new Hono3();
farmMarket.get("/api/farm/market/history", async (c) => {
  needUser(c);
  const item = c.req.query("item"), t = now();
  if (!MARKET_ITEMS.some((i) => i.key === item)) return fail(400, "\u8BF7\u9009\u62E9\u6709\u6548\u7269\u4EA7");
  const snapshot = await marketQuotes(c.env.DB, c.req.url, t, item, typeof caches === "undefined" ? void 0 : caches.default);
  c.header("Cache-Control", "private, no-store");
  return c.json({ item, points: snapshot.rows.filter((p) => Number(p.tick_at) >= t - 86400), quotes_at: snapshot.sampled_at, server_time: t });
});
farmMarket.get("/api/farm/market", async (c) => {
  const uid = needUser(c).id, t = now(), item = c.req.query("item"), page = c.req.query("before");
  if (item && !MARKET_ITEMS.some((i) => i.key === item) || page && (!/^\d+$/.test(page) || !Number.isSafeInteger(Number(page)))) return fail(400, "\u884C\u60C5\u7B5B\u9009\u65E0\u6548");
  const shelf = shopQuery(c.env.DB, c.req.url, t);
  const [account, goods] = await Promise.all([
    c.env.DB.prepare("SELECT remainder_cents FROM farm_market_accounts WHERE user_id=?").bind(uid).first(),
    marketQuotes(c.env.DB, c.req.url, t, void 0, typeof caches === "undefined" ? void 0 : caches.default)
  ]);
  const query2 = `SELECT l.*,g.price_cents FROM farm_market_lots l JOIN farm_market_goods g ON g.item=l.item WHERE l.owner_id=? AND l.quantity>0 ${item ? "AND l.item=?" : ""} ${page ? "AND l.rowid<?" : ""} ORDER BY l.rowid DESC LIMIT 61`;
  const args = (id) => [id, ...item ? [item] : [], ...page ? [Number(page)] : []];
  const [mine, shop, owned] = await c.env.DB.batch([
    c.env.DB.prepare(query2.replace("SELECT l.*,", "SELECT l.rowid AS cursor,l.*,")).bind(...args(uid)),
    shelf.statement,
    c.env.DB.prepare("SELECT item,sum(quantity) AS quantity FROM farm_market_lots WHERE owner_id=? AND quantity>0 GROUP BY item").bind(uid)
  ]);
  const items = mine.results.slice(0, 60);
  const quotes = new Map(goods.rows.map((g) => [String(g.item), g]));
  const listedGoods = MARKET_ITEMS.map((spec) => quotes.get(spec.key) ?? { item: spec.key, base_cents: spec.price * 100, price_cents: spec.price * 100, fresh_qty: 0, effective_qty: 0, sold_flow: 0, bought_flow: 0, tick_at: 0, reference_only: true });
  c.header("Cache-Control", "private, no-store");
  return c.json({ enabled: await marketEnabled(c.env.DB), active: !!account, owned_counts: Object.fromEntries(owned.results.map((r) => [r.item, r.quantity])), remainder_cents: account?.remainder_cents ?? 0, rules: MARKET_RULES, catalog: MARKET_ITEMS, goods: listedGoods, quotes_at: goods.sampled_at, lots: items, next: mine.results.length > 60 ? items.at(-1)?.cursor : null, shop: shop.results.slice(0, 60), shop_next: shop.results.length > 60 ? JSON.stringify([shop.results[59].shop_sort_value, shop.results[59].id, shelf.signature]) : null, server_time: t });
});
farmMarket.post("/api/farm/market", async (c) => {
  sameOrigin(c);
  const uid = needUser(c).id, b = await boundedJson(c, 16384), t = now();
  if (typeof b.id !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(b.id)) return fail(400, "\u4EA4\u6613\u7F16\u53F7\u65E0\u6548");
  await farmActionLimit(c.env.DB, uid, t, 6);
  if (b.kind === "sell_batch") {
    const lots = b.lots;
    if (Object.keys(b).some((k) => !["id", "kind", "lots"].includes(k)) || !Array.isArray(lots) || lots.length < 1 || lots.length > 60 || new Set(lots.map((l) => l?.id)).size !== lots.length || lots.some((l) => !l || typeof l.id !== "string" || l.id.length > 80 || Object.keys(l).some((k) => !["id", "quantity", "price", "total"].includes(k)) || ![l.quantity, l.price, l.total].every(Number.isSafeInteger) || l.quantity < 1 || l.quantity > 1e4 || l.price < 1 || l.total < 0)) return fail(400, "\u6279\u91CF\u51FA\u552E\u53C2\u6570\u65E0\u6548\uFF0C\u5355\u6B21\u6700\u591A60\u6279");
    try {
      return c.json(await sellMarketBatch(c.env.DB, uid, b.id, lots, t));
    } catch (e) {
      if (e instanceof Error && ["D\u5E01\u4F59\u989D\u4E0D\u8DB3\u6216\u8D85\u51FA\u53EF\u7ED3\u7B97\u8303\u56F4", "\u4ED3\u5E93\u6570\u91CF\u4E0D\u8DB3\u6216\u5DF2\u6EE1", "\u6240\u9009\u6765\u6E90\u7684\u5E93\u5B58\u4E0D\u8DB3"].includes(e.message)) return fail(400, e.message);
      throw e;
    }
  }
  if (b.kind === "enroll") {
    if (Object.keys(b).some((k) => !["id", "kind"].includes(k))) return fail(400, "\u5F00\u901A\u53C2\u6570\u65E0\u6548");
    return c.json(await enrollMarket(c.env.DB, uid, b.id, t));
  }
  if (Object.keys(b).some((k) => !["id", "kind", "lot", "quantity", "price", "expected_total"].includes(k)) || !["buy", "sell"].includes(String(b.kind)) || typeof b.lot !== "string" || b.lot.length > 80 || !Number.isSafeInteger(b.quantity) || Number(b.quantity) < 1 || Number(b.quantity) > MARKET_RULES.maxTrade || !Number.isSafeInteger(b.price) || Number(b.price) < 1 || b.expected_total !== void 0 && (!Number.isSafeInteger(b.expected_total) || Number(b.expected_total) < 0)) return fail(400, "\u4EA4\u6613\u53C2\u6570\u65E0\u6548\uFF0C\u6570\u91CF\u4E3A1\u81F310000");
  try {
    return c.json(await tradeMarket(c.env.DB, uid, b, t));
  } catch (e) {
    if (e instanceof Error && ["D\u5E01\u4F59\u989D\u4E0D\u8DB3\u6216\u8D85\u51FA\u53EF\u7ED3\u7B97\u8303\u56F4", "\u4ED3\u5E93\u6570\u91CF\u4E0D\u8DB3\u6216\u5DF2\u6EE1", "\u6240\u9009\u6765\u6E90\u7684\u5E93\u5B58\u4E0D\u8DB3"].includes(e.message)) return fail(400, e.message);
    throw e;
  }
});

// src/routes/farm-conflict.ts
import { Hono as Hono4 } from "hono";

// src/farm/conflict-rules.ts
var LEGACY_CONFLICT_RULES = { fee: 5, toolCost: 2, maxTools: 5, prepareSeconds: 600, escrowSeconds: 86400, protectionSeconds: 28800, maxLootCents: 5e3, lootPercent: 10, dailyLossPercent: 20, attacksPerDay: 3, defensesPerDay: 2, pairCooldown: 86400, minEnrollment: 86400, uprisingSeconds: 1800, uprisingCost: 2, minAllies: 2, maxAllies: 4 };
var CONFLICT_RULES = { ...LEGACY_CONFLICT_RULES, fee: 1, toolCost: 1, prepareSeconds: 180, escrowSeconds: 3600, protectionSeconds: 7200, pairCooldown: 7200, minEnrollment: 0, uprisingSeconds: 600, uprisingCost: 1, minAllies: 1, entryStakeCents: 1e3 };
var RAID_RULES = { ...CONFLICT_RULES, prepareSeconds: 0, escrowSeconds: 900, uprisingSeconds: 120 };
var conflictBattleRules = (b) => b.resolves_at - b.starts_at === LEGACY_CONFLICT_RULES.prepareSeconds ? LEGACY_CONFLICT_RULES : b.resolves_at === b.starts_at ? RAID_RULES : CONFLICT_RULES;
function conflictChance(p) {
  const counter = { sneak: "patrol", rush: "barrier", lure: "decoy" }[p.tactic] === p.stance;
  const a = 100 + 18 * Math.sqrt(p.attack_tools), d = 100 + 18 * Math.sqrt(p.defense_tools) + 18 * p.guardian + (counter ? 22 : 0);
  return Math.max(0.15, Math.min(0.8, 0.5 + (a - d) / 220));
}
var conflictDay = (t) => Math.floor((t + 28800) / 86400);
var conflictDayStart = (t) => conflictDay(t) * 86400 - 28800;
function conflictLoot(quantity, unitCents, warehouseCents, remainingCents) {
  const cap = Math.min(CONFLICT_RULES.maxLootCents, Math.max(unitCents, Math.floor(warehouseCents / 10)), remainingCents);
  return Math.max(0, Math.min(quantity, Math.floor(cap / unitCents)));
}
function conflictRoll() {
  let n;
  do {
    n = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (n >= 4294e6);
  return n % 1e6;
}

// src/farm/conflict.ts
var gate = "EXISTS(SELECT 1 FROM farm_conflict_receipts WHERE attempt=?)";
var live = (uid) => ({ sql: "EXISTS(SELECT 1 FROM users WHERE id=? AND kind='user' AND disabled=0) AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?)", args: [uid, uid] });
var walletCheck = (uid, row) => ({ sql: "EXISTS(SELECT 1 FROM farm_saves WHERE user_id=? AND revision=?) AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=? AND revision=?)", args: [uid, row.revision, uid, row.wallet_revision] });
var memberCheck = (m) => ({ sql: "EXISTS(SELECT 1 FROM farm_conflict_members WHERE user_id=? AND revision=?)", args: [m.user_id, m.revision] });
var battleCheck = (b) => ({ sql: "EXISTS(SELECT 1 FROM farm_conflicts WHERE id=? AND revision=? AND status=?)", args: [b.id, b.revision, b.status] });
var noIncoming = (uid) => ({ sql: "NOT EXISTS(SELECT 1 FROM farm_conflicts WHERE defender_id=? AND status IN ('preparing','escrow','uprising','claimable'))", args: [uid] });
var valid = (ok, message) => {
  if (!ok) fail(409, message);
};
var event = (db, p, attempt) => db.prepare(`INSERT OR IGNORE INTO farm_conflict_events(user_id,actor_id,battle_id,phase,body,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(p.uid, p.actor, p.battle, p.phase, p.body, p.t, attempt);
async function prior(db, uid, id, hash) {
  const r = await db.prepare("SELECT request_hash,result FROM farm_conflict_receipts WHERE user_id=? AND request_id=?").bind(uid, id).first();
  if (!r) return null;
  if (r.request_hash !== hash) fail(409, "\u64CD\u4F5C\u7F16\u53F7\u5DF2\u4F7F\u7528");
  return { ...JSON.parse(r.result), duplicate: true };
}
async function commit(db, p) {
  const attempt = crypto.randomUUID(), checks = p.uid ? [live(p.uid), ...p.checks] : p.checks;
  const r = await db.batch([db.prepare(`INSERT OR IGNORE INTO farm_conflict_receipts(user_id,request_id,request_hash,attempt,result,created_at) SELECT ?,?,?,?,?,? WHERE ${checks.map((c) => "(" + c.sql + ")").join(" AND ") || "1"} RETURNING attempt`).bind(p.uid, p.id, p.hash, attempt, JSON.stringify(p.result), p.t, ...checks.flatMap((c) => c.args)), ...p.write(attempt)]);
  if (!r[0].results.length) return await prior(db, p.uid, p.id, p.hash) ?? fail(409, "\u5E93\u5B58\u6216\u653B\u9632\u72B6\u6001\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  return p.result;
}
async function wallet(db, uid, t) {
  const row = await farmWallet(db, uid, t);
  if (!row) return fail(409, "\u8BF7\u5148\u6253\u5F00\u519C\u573A");
  return row;
}
async function member(db, uid) {
  return db.prepare("SELECT * FROM farm_conflict_members WHERE user_id=?").bind(uid).first();
}
function walletWrites(db, uid, row, delta, ref, t, attempt, state) {
  const balance = row.balance + delta;
  valid(Number.isSafeInteger(balance) && balance >= 0, "D\u5E01\u4F59\u989D\u4E0D\u8DB3\u6216\u8D85\u51FA\u53EF\u7ED3\u7B97\u8303\u56F4");
  const s = state ?? projectFarm(JSON.parse(row.state), t);
  s.coins = balance;
  return [
    db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?,'farm-conflict',?,?,?,?,? WHERE ${gate}`).bind(uid, ref, attempt + ":" + uid, delta, balance, t, attempt),
    db.prepare(`UPDATE coin52_wallets SET balance=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate}`).bind(balance, t, uid, attempt),
    db.prepare(`UPDATE farm_saves SET state=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate}`).bind(JSON.stringify(s), t, uid, attempt)
  ];
}
async function conflictEnabled(db) {
  return (await db.prepare("SELECT v FROM site_settings WHERE k='farm.conflict.enabled'").first())?.v === "on";
}
async function conflictStakes(db, uid) {
  return (await db.prepare("SELECT l.*,s.quantity AS pledged,s.revision AS stake_revision,g.price_cents FROM farm_conflict_stakes s JOIN farm_market_lots l ON l.id=s.lot_id JOIN farm_market_goods g ON g.item=l.item WHERE s.user_id=? ORDER BY s.lot_id LIMIT 60").bind(uid).all()).results;
}
async function conflictSettings(db, uid, input, t) {
  const hash = await sha256(JSON.stringify(input)), done = await prior(db, uid, input.id, hash);
  if (done) return done;
  const m = await member(db, uid), result = { kind: input.kind, message: "\u5BF9\u6297\u8D27\u4ED3\u5DF2\u66F4\u65B0" };
  if (input.kind === "join") {
    valid(await conflictEnabled(db), "\u5BF9\u6297\u73A9\u6CD5\u5C1A\u672A\u5F00\u653E");
    const row = await wallet(db, uid, t);
    valid(!!JSON.parse(row.state).market, "\u8BF7\u5148\u5F00\u901A\u884C\u60C5\u4ED3\u5E93");
    if (m?.enabled) return { kind: "join", duplicate: true };
    return commit(db, { uid, id: input.id, hash, t, result, checks: [walletCheck(uid, row), m ? memberCheck(m) : { sql: "NOT EXISTS(SELECT 1 FROM farm_conflict_members WHERE user_id=?)", args: [uid] }], write: (a) => [
      db.prepare(`INSERT INTO farm_conflict_members(user_id,joined_at) SELECT ?,? WHERE ${gate} ON CONFLICT(user_id) DO UPDATE SET enabled=1,joined_at=excluded.joined_at,revision=revision+1`).bind(uid, t, a)
    ] });
  }
  const entering = input.kind === "join_pledge", joiningWallet = entering ? await wallet(db, uid, t) : null;
  if (entering) {
    valid(await conflictEnabled(db), "\u5BF9\u6297\u73A9\u6CD5\u5C1A\u672A\u5F00\u653E");
    valid(!!JSON.parse(joiningWallet.state).market, "\u8BF7\u5148\u5F00\u901A\u884C\u60C5\u4ED3\u5E93");
  }
  valid(m || entering, "\u8BF7\u5148\u52A0\u5165\u5BF9\u6297\u73A9\u6CD5");
  const current = m;
  if (input.kind === "stance") return commit(db, { uid, id: input.id, hash, t, result, checks: [memberCheck(current)], write: (a) => [db.prepare(`UPDATE farm_conflict_members SET stance=?,revision=revision+1 WHERE user_id=? AND ${gate}`).bind(input.stance, uid, a)] });
  if (input.kind === "leave") {
    valid(t >= current.joined_at + CONFLICT_RULES.minEnrollment, "\u8BF7\u5904\u7406\u5B8C\u884C\u52A8\u5E76\u53D6\u56DE\u7269\u8D44\u540E\u9000\u51FA");
    return commit(db, { uid, id: input.id, hash, t, result, checks: [m ? memberCheck(m) : { sql: "NOT EXISTS(SELECT 1 FROM farm_conflict_members WHERE user_id=?)", args: [uid] }, ...joiningWallet ? [walletCheck(uid, joiningWallet)] : [], noIncoming(uid), { sql: "NOT EXISTS(SELECT 1 FROM farm_conflicts WHERE attacker_id=? AND status IN ('preparing','escrow','uprising','claimable'))", args: [uid] }, { sql: "NOT EXISTS(SELECT 1 FROM farm_conflict_stakes WHERE user_id=?)", args: [uid] }], write: (a) => [db.prepare(`UPDATE farm_conflict_members SET enabled=0,revision=revision+1 WHERE user_id=? AND ${gate}`).bind(uid, a)] });
  }
  const lot = await db.prepare("SELECT * FROM farm_market_lots WHERE id=? AND owner_id=?").bind(input.lot, uid).first();
  valid(lot, "\u8BE5\u6279\u6B21\u4E0D\u5B58\u5728");
  const l = lot, n = input.quantity;
  const stake = await db.prepare("SELECT quantity,revision FROM farm_conflict_stakes WHERE lot_id=?").bind(l.id).first(), deposit = input.kind === "pledge" || entering;
  valid(deposit ? (entering || current.enabled) && t >= l.cooldown_until && t < l.expires_at && l.quantity - l.locked_quantity >= n : (stake?.quantity ?? 0) >= n, "\u53EF\u5212\u5165\u6216\u53D6\u56DE\u7684\u6570\u91CF\u4E0D\u8DB3\uFF0C\u6216\u4ECD\u5728\u51B7\u5374");
  if (deposit) valid(await conflictEnabled(db), "\u5BF9\u6297\u6682\u505C\u65B0\u5212\u5165\uFF0C\u539F\u6709\u5E93\u5B58\u4ECD\u53EF\u53D6\u56DE");
  return commit(db, { uid, id: input.id, hash, t, result, checks: [m ? memberCheck(m) : { sql: "NOT EXISTS(SELECT 1 FROM farm_conflict_members WHERE user_id=?)", args: [uid] }, ...joiningWallet ? [walletCheck(uid, joiningWallet)] : [], noIncoming(uid), { sql: "NOT EXISTS(SELECT 1 FROM farm_conflicts WHERE attacker_id=? AND status='preparing')", args: [uid] }, { sql: "EXISTS(SELECT 1 FROM farm_market_lots WHERE id=? AND revision=?)", args: [l.id, l.revision] }, stake ? { sql: "EXISTS(SELECT 1 FROM farm_conflict_stakes WHERE lot_id=? AND revision=?)", args: [l.id, stake.revision] } : { sql: "NOT EXISTS(SELECT 1 FROM farm_conflict_stakes WHERE lot_id=?) AND (SELECT count(*) FROM farm_conflict_stakes WHERE user_id=?)<60", args: [l.id, uid] }], write: (a) => [
    entering ? db.prepare(`INSERT INTO farm_conflict_members(user_id,joined_at) SELECT ?,? WHERE ${gate} ON CONFLICT(user_id) DO UPDATE SET enabled=1,joined_at=CASE WHEN enabled=1 THEN joined_at ELSE excluded.joined_at END,revision=revision+1`).bind(uid, t, a) : db.prepare(`UPDATE farm_conflict_members SET revision=revision+1 WHERE user_id=? AND ${gate}`).bind(uid, a),
    db.prepare(`UPDATE farm_market_lots SET locked_quantity=locked_quantity+?,revision=revision+1 WHERE id=? AND ${gate}`).bind(deposit ? n : -n, l.id, a),
    ...deposit ? [db.prepare(`INSERT INTO farm_conflict_stakes(lot_id,user_id,quantity) SELECT ?,?,? WHERE ${gate} ON CONFLICT(lot_id) DO UPDATE SET quantity=quantity+excluded.quantity,revision=revision+1`).bind(l.id, uid, n, a)] : n === stake.quantity ? [db.prepare(`DELETE FROM farm_conflict_stakes WHERE lot_id=? AND ${gate}`).bind(l.id, a)] : [db.prepare(`UPDATE farm_conflict_stakes SET quantity=quantity-?,revision=revision+1 WHERE lot_id=? AND ${gate}`).bind(n, l.id, a)]
  ] });
}
async function launchConflict(db, uid, input, t) {
  const hash = await sha256(JSON.stringify(input)), done = await prior(db, uid, input.id, hash);
  if (done) return done;
  valid(await conflictEnabled(db), "\u5BF9\u6297\u6682\u505C\u65B0\u884C\u52A8");
  valid(uid !== input.target, "\u4E0D\u80FD\u653B\u51FB\u81EA\u5DF1\u7684\u8D27\u4ED3");
  const rules = input.kind === "raid" ? RAID_RULES : CONFLICT_RULES;
  const [defender, ar, dr, stakes] = await Promise.all([member(db, input.target), wallet(db, uid, t), wallet(db, input.target, t), conflictStakes(db, input.target)]);
  valid(defender?.enabled, "\u8BE5\u519C\u53CB\u6CA1\u6709\u5F00\u653E\u5BF9\u6297\u8D27\u4ED3");
  valid(JSON.parse(ar.state).market, "\u8BF7\u5148\u514D\u8D39\u5F00\u901A\u884C\u60C5\u4ED3\u5E93\u4EE5\u63A5\u6536\u6218\u5229\u54C1\uFF0C\u65E0\u9700\u5165\u4ED3");
  valid(defender.protected_until <= t && protectedUntil(JSON.parse(dr.state)) <= t, "\u5BF9\u65B9\u4ECD\u5728\u5B88\u62A4\u6216\u6218\u540E\u4FDD\u62A4\u671F");
  const l = stakes.find((l2) => l2.id === input.lot && l2.expires_at > t && l2.cooldown_until <= t);
  valid(l, "\u6CA1\u6709\u53EF\u653B\u51FB\u7684\u65B0\u9C9C\u6279\u6B21");
  const goods = stakes.filter((l2) => l2.expires_at > t && l2.cooldown_until <= t), value = goods.reduce((v, l2) => v + l2.pledged * l2.price_cents, 0);
  const budget = await db.prepare("SELECT limit_cents,reserved_cents FROM farm_conflict_budgets WHERE user_id=? AND day=?").bind(input.target, conflictDay(t)).first();
  const limit = budget?.limit_cents ?? Math.floor(value / 5), reserved = budget?.reserved_cents ?? 0, n = conflictLoot(l.pledged, l.price_cents, value, limit - reserved);
  valid(n > 0, "\u8BE5\u8D27\u4ED3\u5DF2\u5230\u4ECA\u65E5\u635F\u5931\u4E0A\u9650\uFF0C\u6216\u53EF\u63A0\u4EF7\u503C\u4E0D\u8DB3\u4E00\u4EFD\u5546\u54C1");
  const cents = n * l.price_cents, bond = Math.max(1, Math.ceil(cents / 500)), cost = rules.fee + input.tools * rules.toolCost + bond;
  valid(ar.balance >= cost, "D\u5E01\u4E0D\u8DB3\u4EE5\u652F\u4ED8\u884C\u52A8\u9053\u5177\u53CA\u62BC\u91D1");
  const roll2 = conflictRoll(), nonce = crypto.randomUUID(), commitment = await sha256(`${input.id}:${roll2}:${nonce}`), result = { battle: input.id, cost, bond, quantity: n, item: l.item, maximum_cents: cents, resolves_at: t + rules.prepareSeconds, commitment, message: input.kind === "raid" ? "\u7A81\u88AD\u5DF2\u53D1\u8D77\uFF0C\u5373\u65F6\u5224\u5B9A\u7ED3\u679C\u3002" : "\u884C\u52A8\u5DF2\u53D1\u8D77\uFF0C\u9632\u5B88\u65B9\u67093\u5206\u949F\u51C6\u5907\u3002" };
  return commit(db, { uid, id: input.id, hash, t, result, checks: [
    live(input.target),
    walletCheck(uid, ar),
    walletCheck(input.target, dr),
    memberCheck(defender),
    noIncoming(input.target),
    { sql: "EXISTS(SELECT 1 FROM farm_market_lots WHERE id=? AND revision=?) AND EXISTS(SELECT 1 FROM farm_conflict_stakes WHERE lot_id=? AND revision=?)", args: [l.id, l.revision, l.id, l.stake_revision] },
    { sql: "(SELECT count(*) FROM farm_conflicts WHERE attacker_id=? AND starts_at>=?)<3 AND (SELECT count(*) FROM farm_conflicts WHERE defender_id=? AND starts_at>=?)<2 AND NOT EXISTS(SELECT 1 FROM farm_conflicts WHERE attacker_id=? AND defender_id=? AND starts_at>?)", args: [uid, conflictDayStart(t), input.target, conflictDayStart(t), uid, input.target, t - CONFLICT_RULES.pairCooldown] },
    budget ? { sql: "EXISTS(SELECT 1 FROM farm_conflict_budgets WHERE user_id=? AND day=? AND reserved_cents=?)", args: [input.target, conflictDay(t), reserved] } : { sql: "NOT EXISTS(SELECT 1 FROM farm_conflict_budgets WHERE user_id=? AND day=?)", args: [input.target, conflictDay(t)] }
  ], write: (a) => [
    ...walletWrites(db, uid, ar, -cost, input.id, t, a),
    db.prepare(`INSERT INTO farm_conflict_budgets(user_id,day,limit_cents,reserved_cents) SELECT ?,?,?,? WHERE ${gate} ON CONFLICT(user_id,day) DO UPDATE SET reserved_cents=reserved_cents+excluded.reserved_cents`).bind(input.target, conflictDay(t), limit, cents, a),
    db.prepare(`INSERT INTO farm_conflicts(id,attacker_id,defender_id,lot_id,item,quantity,loot_cents,bond,attack_tools,tactic,stance,guardian,roll,roll_nonce,commitment,starts_at,resolves_at) SELECT ${Array(17).fill("?").join(",")} WHERE ${gate}`).bind(input.id, uid, input.target, l.id, l.item, n, cents, bond, input.tools, input.tactic, defender.stance, JSON.parse(dr.state).guardian ? 1 : 0, roll2, nonce, commitment, t, t + rules.prepareSeconds, a),
    event(db, { uid: input.target, actor: uid, battle: input.id, phase: "warning", body: input.kind === "raid" ? "\u8D27\u4ED3\u53D7\u5230\u7A81\u88AD\uFF0C\u9ED8\u8BA4\u9635\u578B\u4E0E\u5B88\u62A4\u517D\u81EA\u52A8\u8FCE\u6218\uFF1B\u82E5\u5931\u5B88\uFF0C\u53EF\u572815\u5206\u949F\u8FFD\u7D22\u671F\u5185\u53D1\u8D77\u53CD\u51FB\u3002" : "\u5BF9\u6297\u8D27\u4ED3\u6536\u5230\u884C\u52A8\u9884\u8B66\uFF0C3\u5206\u949F\u5185\u53EF\u8C03\u6574\u7B56\u7565\u3001\u6295\u5165\u9632\u5B88\u9053\u5177\u6216\u5C01\u4ED3\u3002", t }, a)
  ] });
}
async function defendConflict(db, uid, input, t) {
  const hash = await sha256(JSON.stringify(input)), done = await prior(db, uid, input.id, hash);
  if (done) return done;
  const b = await db.prepare("SELECT * FROM farm_conflicts WHERE id=? AND defender_id=?").bind(input.battle, uid).first();
  valid(b && b.status === "preparing" && t < b.resolves_at, "\u9632\u5B88\u51C6\u5907\u671F\u5DF2\u7ED3\u675F");
  valid(input.tools >= b.defense_tools, "\u5DF2\u6295\u5165\u7684\u9632\u5B88\u9053\u5177\u4E0D\u80FD\u64A4\u56DE");
  valid(!b.sealed || input.sealed, "\u5C01\u4ED3\u540E\u672C\u6B21\u884C\u52A8\u4E0D\u80FD\u53D6\u6D88\u5C01\u4ED3");
  const row = await wallet(db, uid, t), cost = (input.tools - b.defense_tools) * conflictBattleRules(b).toolCost;
  valid(row.balance >= cost, "D\u5E01\u4E0D\u8DB3\u4EE5\u6295\u5165\u9632\u5B88\u9053\u5177");
  return commit(db, { uid, id: input.id, hash, t, result: { message: "\u9632\u5B88\u5DF2\u90E8\u7F72", cost }, checks: [battleCheck(b), walletCheck(uid, row)], write: (a) => [
    ...walletWrites(db, uid, row, -cost, input.id, t, a),
    db.prepare(`UPDATE farm_conflicts SET defense_tools=?,stance=?,sealed=?,revision=revision+1 WHERE id=? AND ${gate}`).bind(input.tools, input.stance, input.sealed ? 1 : 0, b.id, a)
  ] });
}
async function resolveConflict(db, b, t) {
  if (b.status !== "preparing" || t < b.resolves_at) return;
  const rules = conflictBattleRules(b), chance = conflictChance(b), won = b.roll / 1e6 < chance, quantity = b.sealed ? Math.floor(b.quantity / 2) : b.quantity, success = won && quantity > 0;
  const recipient = success ? b.attacker_id : b.defender_id, row = await wallet(db, recipient, t), hash = await sha256("resolve:" + b.id);
  return commit(db, { uid: 0, id: "resolve:" + b.id, hash, t, result: { battle: b.id, success }, checks: [battleCheck(b), walletCheck(recipient, row)], write: (a) => [
    ...communityProgressStatements(db, recipient, success ? { raid_wins: 1 } : { defend_wins: 1 }, t, gate, [a]),
    ...walletWrites(db, recipient, row, b.bond, b.id + ":bond", t, a),
    db.prepare(`UPDATE farm_conflicts SET status=?,quantity=?,loot_cents=?,chance=?,release_at=?,settled_at=?,revision=revision+1 WHERE id=? AND ${gate}`).bind(success ? "escrow" : "failed", success ? quantity : b.quantity, success ? Math.floor(b.loot_cents * quantity / b.quantity) : b.loot_cents, chance, success ? t + rules.escrowSeconds : 0, t, b.id, a),
    db.prepare(`UPDATE farm_conflict_members SET protected_until=MAX(protected_until,?),revision=revision+1 WHERE user_id=? AND ${gate}`).bind(success ? t + rules.protectionSeconds : 0, b.defender_id, a),
    ...[b.attacker_id, b.defender_id].map((uid) => event(db, { uid, actor: uid === b.attacker_id ? b.defender_id : b.attacker_id, battle: b.id, phase: "result", body: success ? `\u8FDB\u653B\u6210\u529F\uFF0C\u6218\u5229\u54C1\u8FDB\u5165${rules.escrowSeconds / 60}\u5206\u949F\u8FFD\u7D22\u6258\u7BA1\u671F\u3002` : "\u8FDB\u653B\u88AB\u963B\u6B62\uFF0C\u62BC\u91D1\u5DF2\u8865\u7ED9\u9632\u5B88\u65B9\u3002", t }, a))
  ] });
}
async function releaseConflict(db, b, t) {
  if (!["escrow", "claimable"].includes(b.status) || t < b.release_at) return;
  const [ar, dr, lot] = await Promise.all([wallet(db, b.attacker_id, t), wallet(db, b.defender_id, t), db.prepare("SELECT * FROM farm_market_lots WHERE id=?").bind(b.lot_id).first()]);
  valid(lot && lot.locked_quantity >= b.quantity, "\u6218\u5229\u54C1\u51BB\u7ED3\u8BB0\u5F55\u5F02\u5E38\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458");
  const l = lot, attacker = projectFarm(JSON.parse(ar.state), t), defender = projectFarm(JSON.parse(dr.state), t);
  try {
    changeInventory(attacker, b.item, b.quantity);
  } catch (e) {
    if (e instanceof Error && e.message === "\u4ED3\u5E93\u6570\u91CF\u4E0D\u8DB3\u6216\u5DF2\u6EE1") {
      await db.prepare("UPDATE farm_conflicts SET status='claimable',revision=revision+1 WHERE id=? AND revision=? AND status='escrow'").bind(b.id, b.revision).run();
      return { claimable: true };
    }
    throw e;
  }
  const original = inventoryCounts(defender)[b.item];
  changeInventory(defender, b.item, -b.quantity);
  if (!b.item.startsWith("fish:")) {
    consumeStock(defender, b.item, original, b.quantity, l.source === "market" ? void 0 : l.source);
    addStock(attacker, b.item, "stolen", b.quantity);
  }
  const expired = t >= l.expires_at ? 1 : l.expired, hash = await sha256("release:" + b.id);
  return commit(db, { uid: 0, id: "release:" + b.id, hash, t, result: { battle: b.id, claimed: true }, checks: [battleCheck(b), walletCheck(b.attacker_id, ar), walletCheck(b.defender_id, dr), { sql: "EXISTS(SELECT 1 FROM farm_market_lots WHERE id=? AND revision=?) AND EXISTS(SELECT 1 FROM farm_conflict_stakes WHERE lot_id=? AND quantity>=?)", args: [l.id, l.revision, l.id, b.quantity] }], write: (a) => [
    ...walletWrites(db, b.attacker_id, ar, 0, b.id + ":goods", t, a, attacker),
    ...walletWrites(db, b.defender_id, dr, 0, b.id + ":goods", t, a, defender),
    db.prepare(`UPDATE farm_market_lots SET quantity=quantity-?,locked_quantity=locked_quantity-?,revision=revision+1 WHERE id=? AND ${gate}`).bind(b.quantity, b.quantity, l.id, a),
    db.prepare(`DELETE FROM farm_conflict_stakes WHERE lot_id=? AND quantity=? AND ${gate}`).bind(l.id, b.quantity, a),
    db.prepare(`UPDATE farm_conflict_stakes SET quantity=quantity-?,revision=revision+1 WHERE lot_id=? AND ${gate}`).bind(b.quantity, l.id, a),
    db.prepare(`INSERT INTO farm_market_lots(id,owner_id,item,source,quantity,born_at,expires_at,cooldown_until,expired) SELECT ?,?,?,'stolen',?,?,?,?,? WHERE ${gate} ON CONFLICT(owner_id,item,source,born_at,expires_at,cooldown_until,expired) DO UPDATE SET quantity=quantity+excluded.quantity,revision=revision+1`).bind(crypto.randomUUID(), b.attacker_id, b.item, b.quantity, l.born_at, l.expires_at, t, expired, a),
    db.prepare(`UPDATE farm_market_goods SET fresh_seconds=fresh_seconds-?*(?-fresh_at),fresh_qty=fresh_qty-?,revision=revision+1 WHERE item=? AND ${gate}`).bind(expired && !l.expired ? b.quantity : 0, l.expires_at, expired && !l.expired ? b.quantity : 0, b.item, a),
    db.prepare(`UPDATE farm_conflicts SET status='claimed',revision=revision+1 WHERE id=? AND ${gate}`).bind(b.id, a),
    ...[b.attacker_id, b.defender_id].map((uid) => event(db, { uid, actor: uid === b.attacker_id ? b.defender_id : b.attacker_id, battle: b.id, phase: "released", body: "\u8FFD\u7D22\u671F\u7ED3\u675F\uFF0C\u6218\u5229\u54C1\u5DF2\u6309\u539F\u4FDD\u8D28\u671F\u8F6C\u79FB\u5165\u4ED3\u3002", t }, a))
  ] });
}
async function joinUprising(db, uid, input, t) {
  const hash = await sha256(JSON.stringify(input)), done = await prior(db, uid, input.id, hash);
  if (done) return done;
  const b = await db.prepare("SELECT * FROM farm_conflicts WHERE id=?").bind(input.battle).first();
  valid(b && ["escrow", "uprising"].includes(b.status), "\u8BE5\u6218\u5229\u54C1\u5DF2\u7ECF\u4E0D\u5728\u8FFD\u7D22\u671F");
  const rules = conflictBattleRules(b);
  valid(uid !== b.attacker_id, "\u653B\u51FB\u65B9\u4E0D\u80FD\u52A0\u5165\u8FFD\u7D22\u81EA\u5DF1\u7684\u961F\u4F0D");
  const up = await db.prepare("SELECT * FROM farm_uprisings WHERE battle_id=?").bind(b.id).first();
  if (!up) valid(uid === b.defender_id && t + rules.uprisingSeconds <= b.release_at, `\u4EC5\u53D7\u635F\u65B9\u80FD\u5728\u8FFD\u7D22\u622A\u6B62\u524D${rules.uprisingSeconds / 60}\u5206\u949F\u53D1\u8D77\u8D77\u4E49`);
  else valid(up.status === "forming" && t < up.closes_at, "\u8D77\u4E49\u5DF2\u7ED3\u675F\u62DB\u52DF");
  const row = await wallet(db, uid, t);
  valid(row.balance >= rules.uprisingCost, "D\u5E01\u4E0D\u8DB3\u4EE5\u6295\u5165\u8D77\u4E49\u8865\u7ED9");
  const checks = [battleCheck(b), walletCheck(uid, row), { sql: "NOT EXISTS(SELECT 1 FROM farm_uprising_members WHERE battle_id=? AND user_id=?) AND (SELECT count(*) FROM farm_uprising_members WHERE battle_id=?)<4", args: [b.id, uid, b.id] }];
  if (uid !== b.defender_id) checks.push({ sql: "EXISTS(SELECT 1 FROM farm_conflicts WHERE attacker_id=? AND defender_id=? AND starts_at>=? AND status IN ('escrow','uprising','claimable','claimed'))", args: [b.attacker_id, uid, t - 86400] });
  checks.push(up ? { sql: "EXISTS(SELECT 1 FROM farm_uprisings WHERE battle_id=? AND revision=? AND status='forming')", args: [b.id, up.revision] } : { sql: "NOT EXISTS(SELECT 1 FROM farm_uprisings WHERE battle_id=?)", args: [b.id] });
  const roll2 = conflictRoll(), nonce = crypto.randomUUID(), commitment = await sha256(`uprising:${b.id}:${roll2}:${nonce}`);
  return commit(db, { uid, id: input.id, hash, t, result: { message: `\u5DF2\u6295\u5165${rules.uprisingCost}D\u8865\u7ED9\uFF1B${rules.minAllies === 1 ? "\u53EF\u5355\u4EBA\u8FFD\u7D22\uFF0C\u7EC4\u961F\u63D0\u9AD8\u673A\u4F1A" : "\u97002\u81F34\u540D\u540C\u4E00\u653B\u51FB\u65B9\u7684\u53D7\u635F\u8005\u6210\u961F"}\uFF0C\u6210\u529F\u540E\u7269\u8D44\u5F52\u8FD8\u539F\u4E3B\u4EBA\u3002`, closes_at: up?.closes_at ?? t + rules.uprisingSeconds }, checks, write: (a) => [
    ...walletWrites(db, uid, row, -rules.uprisingCost, input.id, t, a),
    ...up ? [db.prepare(`UPDATE farm_uprisings SET revision=revision+1 WHERE battle_id=? AND ${gate}`).bind(b.id, a)] : [db.prepare(`INSERT INTO farm_uprisings(battle_id,closes_at,roll,roll_nonce,commitment) SELECT ?,?,?,?,? WHERE ${gate}`).bind(b.id, t + rules.uprisingSeconds, roll2, nonce, commitment, a)],
    db.prepare(`INSERT INTO farm_uprising_members(battle_id,user_id,joined_at) SELECT ?,?,? WHERE ${gate}`).bind(b.id, uid, t, a),
    db.prepare(`UPDATE farm_conflicts SET status='uprising',revision=revision+1 WHERE id=? AND ${gate}`).bind(b.id, a)
  ] });
}
async function resolveUprising(db, id, t) {
  const up = await db.prepare("SELECT * FROM farm_uprisings WHERE battle_id=? AND status='forming' AND closes_at<=?").bind(id, t).first();
  if (!up) return;
  const b = await db.prepare("SELECT * FROM farm_conflicts WHERE id=? AND status='uprising'").bind(id).first();
  if (!b) return;
  const rules = conflictBattleRules(b);
  const count4 = Number((await db.prepare("SELECT count(*) AS n FROM farm_uprising_members WHERE battle_id=?").bind(id).first()).n), chance = Math.min(0.65, 0.35 + 0.1 * (count4 - 1)), won = count4 >= rules.minAllies && up.roll / 1e6 < chance;
  const supporters = won ? (await db.prepare("SELECT user_id FROM farm_uprising_members WHERE battle_id=? LIMIT 4").bind(id).all()).results : [];
  const hash = await sha256("uprising-resolve:" + id);
  return commit(db, { uid: 0, id: "uprising-resolve:" + id, hash, t, result: { battle: id, recovered: won }, checks: [battleCheck(b), { sql: "EXISTS(SELECT 1 FROM farm_uprisings WHERE battle_id=? AND revision=? AND status='forming')", args: [id, up.revision] }], write: (a) => [
    ...supporters.flatMap((u) => communityProgressStatements(db, u.user_id, { uprising_wins: 1 }, t, gate, [a])),
    db.prepare(`UPDATE farm_uprisings SET status=?,chance=?,revision=revision+1 WHERE battle_id=? AND ${gate}`).bind(count4 < rules.minAllies ? "insufficient" : won ? "won" : "lost", count4 < rules.minAllies ? 0 : chance, id, a),
    db.prepare(`UPDATE farm_conflicts SET status=?,revision=revision+1 WHERE id=? AND ${gate}`).bind(won ? "recovered" : "escrow", id, a),
    ...[b.attacker_id, b.defender_id].map((uid) => event(db, { uid, actor: uid === b.attacker_id ? b.defender_id : b.attacker_id, battle: b.id, phase: "uprising", body: won ? "\u8D77\u4E49\u8FFD\u7D22\u6210\u529F\uFF0C\u539F\u4E3B\u4EBA\u7684\u8D27\u4ED3\u7269\u8D44\u5DF2\u4FDD\u5168\u3002" : count4 < rules.minAllies ? "\u8D77\u4E49\u672A\u8FBE\u5230\u7EA6\u5B9A\u4EBA\u6570\uFF0C\u7269\u8D44\u7EE7\u7EED\u6309\u539F\u6258\u7BA1\u622A\u6B62\u65F6\u95F4\u5904\u7406\u3002" : "\u8D77\u4E49\u8FFD\u7D22\u5931\u8D25\uFF0C\u7269\u8D44\u7EE7\u7EED\u6309\u539F\u6258\u7BA1\u622A\u6B62\u65F6\u95F4\u5904\u7406\u3002", t }, a))
  ] });
}
async function settleConflicts(db, t) {
  const preparing = (await db.prepare("SELECT * FROM farm_conflicts WHERE status='preparing' AND resolves_at<=? ORDER BY resolves_at,id LIMIT 10").bind(t).all()).results;
  const uprisings = (await db.prepare("SELECT battle_id FROM farm_uprisings WHERE status='forming' AND closes_at<=? ORDER BY closes_at,battle_id LIMIT 10").bind(t).all()).results;
  const escrow = (await db.prepare("SELECT * FROM farm_conflicts WHERE status='escrow' AND release_at<=? ORDER BY release_at,id LIMIT 10").bind(t).all()).results;
  for (const b of preparing) await resolveConflict(db, b, t).catch(() => console.error("farm_conflict_resolve_failed", b.id));
  for (const u of uprisings) await resolveUprising(db, u.battle_id, t).catch(() => console.error("farm_uprising_resolve_failed", u.battle_id));
  for (const b of escrow) await releaseConflict(db, b, t).catch(() => console.error("farm_conflict_release_failed", b.id));
  return { preparing: preparing.length, uprisings: uprisings.length, escrow: escrow.length };
}

// src/routes/farm-conflict.ts
var farmConflict = new Hono4();
farmConflict.get("/api/farm/conflict", async (c) => {
  const uid = needUser(c).id, db = c.env.DB, t = now(), target = c.req.query("target"), before = c.req.query("before");
  if (target && (!/^\d+$/.test(target) || !Number.isSafeInteger(Number(target))) || before && (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before)))) return fail(400, "\u5BF9\u6297\u76EE\u6807\u6216\u6E38\u6807\u65E0\u6548");
  const [me, targets, battles, allies, wallet2] = await db.batch([
    db.prepare("SELECT * FROM farm_conflict_members WHERE user_id=?").bind(uid),
    db.prepare(`SELECT m.user_id,m.stance,m.protected_until,u.username,u.name FROM farm_conflict_members m JOIN users u ON u.id=m.user_id WHERE m.enabled=1 AND m.user_id<>? AND m.user_id>? AND u.disabled=0 AND EXISTS(SELECT 1 FROM farm_conflict_stakes WHERE user_id=m.user_id) ORDER BY m.user_id LIMIT 31`).bind(uid, Number(before ?? 0)),
    db.prepare(`SELECT b.*,a.username AS attacker_name,d.username AS defender_name FROM farm_conflicts b JOIN users a ON a.id=b.attacker_id JOIN users d ON d.id=b.defender_id WHERE b.attacker_id=? OR b.defender_id=? ORDER BY b.starts_at DESC LIMIT 30`).bind(uid, uid),
    db.prepare(`SELECT b.id,b.attacker_id,b.defender_id,b.starts_at,b.resolves_at,u.closes_at,d.username AS defender_name,a.username AS attacker_name FROM farm_conflicts b JOIN farm_uprisings u ON u.battle_id=b.id JOIN users d ON d.id=b.defender_id JOIN users a ON a.id=b.attacker_id WHERE b.status='uprising' AND u.status='forming' AND u.closes_at>? AND b.defender_id<>? AND EXISTS(SELECT 1 FROM farm_conflicts v WHERE v.attacker_id=b.attacker_id AND v.defender_id=? AND v.starts_at>=? AND v.status IN ('escrow','uprising','claimable','claimed')) ORDER BY u.closes_at LIMIT 20`).bind(t, uid, uid, t - 86400),
    db.prepare("SELECT balance FROM coin52_wallets WHERE user_id=?").bind(uid)
  ]);
  const safe = battles.results.map((raw) => {
    const { roll: roll2, roll_nonce, tactic, ...b } = raw;
    return { ...b, rules: conflictBattleRules({ starts_at: Number(b.starts_at), resolves_at: Number(b.resolves_at) }), tactic: b.attacker_id === uid || b.status !== "preparing" ? tactic : null, ...b.status !== "preparing" ? { roll: roll2, roll_nonce } : {}, chance: b.status === "preparing" ? null : b.chance };
  });
  const ids = safe.map((b) => b.id), uprisings = ids.length ? (await db.prepare(`SELECT u.battle_id,u.closes_at,u.status,u.chance,u.commitment,CASE WHEN u.status<>'forming' THEN u.roll END AS roll,CASE WHEN u.status<>'forming' THEN u.roll_nonce END AS roll_nonce,(SELECT count(*) FROM farm_uprising_members WHERE battle_id=u.battle_id) AS members FROM farm_uprisings u WHERE u.battle_id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).all()).results : [];
  const own = await conflictStakes(db, uid);
  let scout = null;
  if (target) {
    const targetId = Number(target), m = await db.prepare(`SELECT m.user_id,m.stance,m.protected_until,u.username,
   CASE WHEN json_type(s.state,'$.guardian')='object' THEN 1 ELSE 0 END AS guardian,
   MAX(COALESCE(json_extract(s.state,'$.guardUntil'),0),COALESCE(json_extract(s.state,'$.guardian.protectionUntil'),0)) AS guard_until
   FROM farm_conflict_members m JOIN users u ON u.id=m.user_id LEFT JOIN farm_saves s ON s.user_id=m.user_id
   WHERE m.user_id=? AND m.enabled=1 AND u.disabled=0`).bind(targetId).first();
    if (m) {
      const [lots, limits] = await Promise.all([conflictStakes(db, targetId), db.prepare(
        `SELECT
    (SELECT limit_cents-reserved_cents FROM farm_conflict_budgets WHERE user_id=?2 AND day=?3) AS remaining,
    (SELECT count(*) FROM farm_conflicts WHERE attacker_id=?1 AND starts_at>=?4) AS attacks,
    (SELECT count(*) FROM farm_conflicts WHERE defender_id=?2 AND starts_at>=?4) AS defenses,
    EXISTS(SELECT 1 FROM farm_conflicts WHERE defender_id=?2 AND status IN ('preparing','escrow','uprising','claimable')) AS ongoing,
    (SELECT starts_at+?5 FROM farm_conflicts WHERE attacker_id=?1 AND defender_id=?2 ORDER BY starts_at DESC LIMIT 1) AS pair_until`
      ).bind(uid, targetId, conflictDay(t), conflictDayStart(t), CONFLICT_RULES.pairCooldown).first()]);
      const fresh = lots.filter((l) => l.expires_at > t && l.cooldown_until <= t), value = fresh.reduce((n, l) => n + l.pledged * l.price_cents, 0), remaining = Math.max(0, limits?.remaining ?? Math.floor(value / 5)), protection = Math.max(Number(m.protected_until), Number(m.guard_until));
      const blocked = targetId === uid ? "\u4E0D\u80FD\u653B\u51FB\u81EA\u5DF1\u7684\u8D27\u4ED3" : protection > t ? "\u5BF9\u65B9\u4ECD\u5728\u5B88\u62A4\u6216\u6218\u540E\u4FDD\u62A4\u671F" : Number(limits?.attacks) >= CONFLICT_RULES.attacksPerDay ? "\u4ECA\u65E5\u53D1\u8D77\u6B21\u6570\u5DF2\u7528\u5B8C" : Number(limits?.defenses) >= CONFLICT_RULES.defensesPerDay ? "\u5BF9\u65B9\u4ECA\u65E5\u627F\u53D7\u6B21\u6570\u5DF2\u8FBE\u4E0A\u9650" : limits?.ongoing ? "\u5BF9\u65B9\u6709\u5C1A\u672A\u7ED3\u675F\u7684\u653B\u9632\u6216\u8FFD\u7D22" : Number(limits?.pair_until) > t ? "\u5BF9\u540C\u4E00\u519C\u53CB\u76842\u5C0F\u65F6\u51B7\u5374\u5C1A\u672A\u7ED3\u675F" : "";
      scout = {
        ...m,
        protected_until: protection,
        blocked,
        remaining_cents: remaining,
        attacks_left: Math.max(0, CONFLICT_RULES.attacksPerDay - Number(limits?.attacks ?? 0)),
        pair_until: limits?.pair_until ?? 0,
        lots: fresh.map((l) => ({ id: l.id, item: l.item, quantity: l.pledged, price_cents: l.price_cents, expires_at: l.expires_at, max_quantity: conflictLoot(l.pledged, l.price_cents, value, remaining) }))
      };
    }
  }
  return c.json({ enabled: await conflictEnabled(db), me: me.results[0] ?? null, balance: wallet2.results[0]?.balance ?? 0, stakes: own, battles: safe, uprisings, allies: allies.results.map((b) => ({ ...b, rules: conflictBattleRules({ starts_at: Number(b.starts_at), resolves_at: Number(b.resolves_at) }) })), targets: targets.results.slice(0, 30), next: targets.results.length > 30 ? targets.results[29].user_id : null, scout, catalog: MARKET_ITEMS, rules: CONFLICT_RULES, server_time: t });
});
farmConflict.post("/api/farm/conflict", async (c) => {
  sameOrigin(c);
  const uid = needUser(c).id, b = await boundedJson(c, 1200), t = now(), db = c.env.DB;
  if (typeof b.id !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(b.id)) return fail(400, "\u64CD\u4F5C\u7F16\u53F7\u65E0\u6548");
  await farmActionLimit(db, uid, t, 6);
  const kinds = { join: [], join_pledge: ["lot", "quantity"], leave: [], stance: ["stance"], pledge: ["lot", "quantity"], withdraw: ["lot", "quantity"], attack: ["target", "lot", "tools", "tactic"], raid: ["target", "lot", "tools", "tactic"], defend: ["battle", "tools", "stance", "sealed"], uprising: ["battle"], claim: ["battle"] };
  const fields4 = kinds[String(b.kind)];
  if (!fields4 || Object.keys(b).some((k) => !["id", "kind", ...fields4].includes(k)) || fields4.some((k) => !(k in b))) return fail(400, "\u653B\u9632\u53C2\u6570\u65E0\u6548");
  if ("lot" in b && (typeof b.lot !== "string" || b.lot.length > 80) || "battle" in b && (typeof b.battle !== "string" || b.battle.length > 64) || "quantity" in b && (!Number.isSafeInteger(b.quantity) || Number(b.quantity) < 1 || Number(b.quantity) > 1e4) || "tools" in b && (!Number.isInteger(b.tools) || Number(b.tools) < 0 || Number(b.tools) > 5) || "target" in b && (!Number.isSafeInteger(b.target) || Number(b.target) < 1) || "tactic" in b && !["sneak", "rush", "lure"].includes(String(b.tactic)) || "stance" in b && !["patrol", "barrier", "decoy"].includes(String(b.stance)) || "sealed" in b && typeof b.sealed !== "boolean") return fail(400, "\u653B\u9632\u53C2\u6570\u8D85\u51FA\u8303\u56F4");
  if (b.kind === "attack" || b.kind === "raid") {
    const result = await launchConflict(db, uid, b, t);
    if (b.kind === "raid") {
      const battle = await db.prepare("SELECT * FROM farm_conflicts WHERE id=? AND attacker_id=?").bind(b.id, uid).first();
      if (battle?.status === "preparing") await resolveConflict(db, battle, t);
      const settled = await db.prepare("SELECT status,chance,release_at FROM farm_conflicts WHERE id=? AND attacker_id=?").bind(b.id, uid).first();
      return c.json({ ...result, ...settled, message: settled?.status === "escrow" ? "\u7A81\u88AD\u6210\u529F\uFF01\u62BC\u91D1\u5DF2\u9000\uFF0C\u6218\u5229\u54C1\u5DF2\u9501\u5B9A\uFF0C15\u5206\u949F\u8FFD\u7D22\u671F\u540E\u5165\u4ED3\u3002" : settled?.status === "failed" ? "\u8FD9\u6B21\u7A81\u88AD\u88AB\u6321\u4F4F\u4E86\uFF0C\u62BC\u91D1\u5DF2\u8865\u507F\u5B88\u65B9\u3002" : "\u884C\u52A8\u7ED3\u679C\u5DF2\u4FDD\u5B58\uFF0C\u53EF\u5728\u6218\u62A5\u67E5\u770B\u3002" });
    }
    return c.json(result);
  }
  if (b.kind === "defend") return c.json(await defendConflict(db, uid, b, t));
  if (b.kind === "uprising") return c.json(await joinUprising(db, uid, b, t));
  if (b.kind === "claim") {
    const battle = await db.prepare("SELECT * FROM farm_conflicts WHERE id=? AND attacker_id=?").bind(b.battle, uid).first();
    if (!battle) return fail(404, "\u6218\u5229\u54C1\u4E0D\u5B58\u5728");
    if (battle.status === "claimed") return c.json({ claimed: true, duplicate: true });
    if (!["escrow", "claimable"].includes(battle.status) || t < battle.release_at) return fail(409, "\u6218\u5229\u54C1\u4ECD\u5728\u8FFD\u7D22\u671F");
    return c.json(await releaseConflict(db, battle, t));
  }
  return c.json(await conflictSettings(db, uid, b, t));
});

// src/routes/farm-farewell.ts
import { Hono as Hono5 } from "hono";
var farmFarewell = new Hono5();
farmFarewell.get("/api/farm/farewell", async (c) => {
  const u = needUser(c), t = now();
  const receipt2 = farmClosed(t) ? await c.env.DB.prepare("SELECT status,asset_coins,bonus,details,paid_at FROM farm_farewell_recipients WHERE batch_id=? AND user_id=?").bind(FARM_FAREWELL_ID, u.id).first() : null;
  return c.json({
    closed: farmClosed(t),
    closes_at: FARM_CLOSE_AT,
    server_time: t,
    bonus: FARM_FAREWELL_BONUS,
    receipt: receipt2 ? { ...receipt2, details: receipt2.details ? JSON.parse(receipt2.details) : null } : null,
    rules: ["\u5730\u91CC\u53CA\u79DF\u5730\u5F53\u671F\u4F5C\u7269\u6309\u5B8C\u6574\u6536\u6210\u7ED3\u7B97\uFF0C\u5DF2\u88AB\u53D6\u8D70\u7684\u4EFD\u989D\u4E0D\u91CD\u590D\u8865\u53D1\u3002", "\u4ED3\u5E93\u6309\u622A\u6B62\u65F6\u884C\u60C5\u7ED3\u7B97\uFF0C\u8FC7\u671F\u4EA7\u7269\u6309\u539F\u89C4\u521910%\u56DE\u6536\uFF1B\u5E02\u573A\u6279\u6B21\u4E0D\u4E0E\u4ED3\u5E93\u91CD\u590D\u7D2F\u52A0\u3002", "\u5269\u4F59\u79CD\u5B50\u3001\u9972\u6599\u3001\u5B58\u6D3B\u52A8\u7269\u8D2D\u5165\u4EF7\u3001\u6269\u5EFA\u548C\u9C7C\u7AFF\u6295\u5165\u4E00\u5E76\u8FD4\u8FD8\uFF1B\u5F53\u671F\u755C\u4EA7\u3001\u80B2\u80A5\u732A\u3001\u6302\u673A\u9493\u9C7C\u8BA1\u5165\u6536\u76CA\u3002", "\u672A\u5B8C\u653B\u9632\u53D6\u6D88\uFF0C\u672A\u7ED3\u7B97\u6295\u5165\u8FD4\u8FD8\uFF0C\u4ED3\u5E93\u7269\u8D44\u6309\u539F\u4E3B\u4EBA\u5F52\u5C5E\u7ED3\u7B97\uFF1B\u5269\u4F59\u79DF\u671F\u8FD4\u8FD8\u79DF\u5BA2\u3002", "\u6BCF\u4E2A\u6B63\u5E38\u8D26\u53F7\u53E6\u83B7100000 D\u5E01\uFF1B\u6309\u6279\u6B21\u9646\u7EED\u5230\u8D26\uFF0C\u65E0\u9700\u624B\u52A8\u9886\u53D6\u3002"]
  });
});

// src/routes/farm.ts
var farm = new Hono6();
farm.use("/api/farm/*", async (c, next) => {
  needUser(c);
  c.header("cache-control", "no-store");
  if (farmClosed(now()) && !["/api/farm/wallet", "/api/farm/farewell"].includes(c.req.path)) return c.json({ error: "\u519C\u573A\u5DF2\u6682\u522B\uFF0C\u8D44\u4EA7\u4E0E\u8865\u507F\u6B63\u5728\u6309\u6279\u6B21\u7ED3\u7B97\uFF0C\u8BF7\u67E5\u770B\u7EAA\u5FF5\u9875\u3002", code: "farm_closed", closes_at: FARM_CLOSE_AT }, 410);
  await next();
});
farm.route("/", farmFarewell);
farm.route("/", farmSocial);
farm.route("/", farmLeases);
farm.route("/", farmMarket);
farm.route("/", farmConflict);
var view = (row, t) => {
  const { receipts, ...state } = projectFarm(JSON.parse(row.state), t);
  if (state.fishing?.cast?.v === 3) delete state.fishing.cast._secret;
  if (row.balance !== void 0) state.coins = row.balance;
  return { revision: row.revision, state, server_time: t };
};
async function lockedView(db, uid, row, t) {
  return leaseSceneView(view(row, t), await farmLeaseScene(db, uid, t));
}
farm.get("/api/farm/wallet", async (c) => {
  const user = needUser(c), raw = c.req.query("before"), before = raw === void 0 ? Number.MAX_SAFE_INTEGER : Number(raw);
  if (raw !== void 0 && (!/^[1-9]\d{0,15}$/.test(raw) || !Number.isSafeInteger(before))) return fail(400, "\u6D41\u6C34\u6E38\u6807\u65E0\u6548");
  const row = await farmWallet(c.env.DB, user.id, now());
  if (!row) await ensureCoinWallet(c.env.DB, user.id, now());
  const wallet2 = row || await c.env.DB.prepare("SELECT balance FROM coin52_wallets WHERE user_id=?").bind(user.id).first();
  if (!wallet2) return fail(409, "\u94B1\u5305\u72B6\u6001\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  const [ledger, migration] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id,kind,ref,delta,balance_after,created_at FROM coin52_ledger WHERE user_id=? AND id<? ORDER BY id DESC LIMIT 21").bind(user.id, before),
    c.env.DB.prepare("SELECT imported_coins,compensation,created_at FROM farm_migrations WHERE user_id=?").bind(user.id)
  ]);
  const rows = ledger.results.slice(0, 20);
  return c.json({ balance: wallet2.balance, rows, next: ledger.results.length > 20 ? rows.at(-1).id : null, migration: migration.results[0] ?? null });
});
farm.get("/api/farm/state", async (c) => {
  const user = needUser(c), t = now();
  let row = await c.env.DB.prepare("SELECT revision,state,updated_at FROM farm_saves WHERE user_id=?").bind(user.id).first();
  if (!row) {
    await c.env.DB.prepare(`INSERT OR IGNORE INTO farm_saves(user_id,state,updated_at,owner_operated_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?)`).bind(user.id, JSON.stringify(newFarm(t)), t, t, user.id, user.id).run();
    row = await c.env.DB.prepare("SELECT revision,state,updated_at FROM farm_saves WHERE user_id=?").bind(user.id).first();
  }
  if (!row) return fail(403, "\u8D26\u53F7\u6682\u4E0D\u53EF\u7528");
  const synced = await farmWallet(c.env.DB, user.id, t);
  if (!synced) return fail(409, "\u519C\u573A\u6B63\u5728\u540C\u6B65\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
  const display = { ...synced, state: JSON.stringify({ ...JSON.parse(synced.state), coins: synced.balance }) };
  const visible2 = await lockedView(c.env.DB, user.id, display, t);
  return c.json({ ...visible2, catalog: { crops: CROPS, trees: {}, achievements: ACHIEVEMENTS.filter((a) => a.id !== "woodworker" || JSON.parse(synced.state).achievements.includes(a.id)), animals: ANIMALS, ranch: RANCH_RULES, expansions: EXPANSIONS, fish: FISH, pigs: PIGS, leisure: LEISURE_RULES, fishingItems: FISHING_ITEMS, fishingRods: FISHING_RODS, fishingLoot: FISHING_LOOT_RULES, guardians: GUARDIANS, guardianRules: GUARDIAN_RULES, allUnlocked: isOwner(c, user) } });
});
farm.post("/api/farm/actions", async (c) => {
  sameOrigin(c);
  const user = needUser(c), body = await boundedJson(c, 32768), t = now();
  if (Object.keys(body).some((k) => !["id", "revision", "actions"].includes(k)) || typeof body.id !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(body.id) || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0) return fail(400, "\u5B58\u6863\u64CD\u4F5C\u683C\u5F0F\u65E0\u6548");
  if (!Array.isArray(body.actions) || !body.actions.length || body.actions.length > 120) return fail(400, "\u6BCF\u6B21\u64CD\u4F5C\u9700\u89811\u81F3120\u4E2A\u6709\u6548\u76EE\u6807");
  const units = body.actions.reduce((n, a) => n + (a && typeof a === "object" && "type" in a ? a.type === "guardian_skill" ? 6 : a.type === "lease_plant" ? 2 : 1 : 1), 0);
  const row = await farmWallet(c.env.DB, user.id, t);
  if (!row) return fail(409, "\u8BF7\u5148\u6253\u5F00\u519C\u573A\u52A0\u8F7D\u5B58\u6863");
  const state = { ...JSON.parse(row.state), coins: row.balance }, hash = await sha256(JSON.stringify({ revision: body.revision, actions: body.actions })), receipt2 = state.receipts.find((r) => r.id === body.id);
  if (receipt2) {
    if (receipt2.hash !== hash) return fail(409, "\u64CD\u4F5C\u7F16\u53F7\u5DF2\u88AB\u4F7F\u7528\uFF0C\u8BF7\u5237\u65B0\u5B58\u6863");
    return c.json({ ...await lockedView(c.env.DB, user.id, row, t), duplicate: true, messages: [] });
  }
  if (row.revision !== body.revision) return c.json({ error: "\u519C\u573A\u8FDB\u5EA6\u5DF2\u5728\u5176\u4ED6\u9875\u9762\u66F4\u65B0\uFF0C\u5DF2\u52A0\u8F7D\u6700\u65B0\u5B58\u6863\uFF0C\u8BF7\u91CD\u65B0\u64CD\u4F5C", code: "farm_conflict", ...await lockedView(c.env.DB, user.id, row, t) }, 409);
  await farmActionLimit(c.env.DB, user.id, t, units);
  const scene = await farmLeaseScene(c.env.DB, user.id, t), locks = scene.locks;
  if (Array.isArray(body.actions) && body.actions.some((a) => a && locks.some((l) => l.plot === a.plot))) return fail(400, "\u8FD9\u5757\u7530\u5730\u6B63\u5728\u51FA\u79DF\uFF0C\u79DF\u671F\u7ED3\u675F\u540E\u53EF\u4EE5\u7EE7\u7EED\u4F7F\u7528");
  let result;
  try {
    result = applyFarmSceneActions(state, body.actions, scene.rented, t, { allUnlocked: isOwner(c, user), lockedPlots: locks.map((l) => l.plot) });
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : "\u519C\u573A\u64CD\u4F5C\u65E0\u6548");
  }
  result.state.receipts = [...state.receipts, { id: body.id, hash, revision: row.revision + 1 }].slice(-32);
  const encoded = JSON.stringify(result.state);
  const awards = farmBadgeStatements(c.env.DB, user.id, encoded, row.revision + 1, t, state);
  const changed = result.state.coins !== row.balance;
  const base = changed ? farmWalletActionStatements(c.env.DB, { userId: user.id, row, encoded, balance: result.state.coins, id: body.id, attempt: crypto.randomUUID(), t }) : [c.env.DB.prepare(`UPDATE farm_saves SET state=?1,revision=revision+1,updated_at=?2,owner_operated_at=?2 WHERE user_id=?3 AND revision=?4 AND EXISTS(SELECT 1 FROM users WHERE id=?3 AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?3) RETURNING revision,state,updated_at`).bind(encoded, t, user.id, row.revision)];
  const lots = marketStockStatements(c.env.DB, { userId: user.id, before: state, after: result.state, t, gate: "EXISTS(SELECT 1 FROM farm_saves WHERE user_id=? AND revision=? AND state=?)", bindings: [user.id, row.revision + 1, encoded] });
  const leaseData = JSON.stringify(result.leases.map((l) => ({ id: l.id, crop_state: l.crop_state })));
  const leaseWrites = result.leases.length ? [c.env.DB.prepare(`UPDATE farm_leases SET crop_state=(SELECT json_extract(value,'$.crop_state') FROM json_each(?1) WHERE json_extract(value,'$.id')=farm_leases.id),revision=revision+1 WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?1)) AND tenant_id=?2 AND state='active' AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?2 AND revision=?3 AND state=?4)`).bind(leaseData, user.id, row.revision + 1, encoded)] : [];
  const stored = await c.env.DB.batch([...base, ...leaseWrites, ...awards, ...lots]);
  const saved = stored[base.length - 1].results[0];
  if (!saved) {
    const latest = await farmWallet(c.env.DB, user.id, t);
    return c.json({ error: "\u5B58\u6863\u53D1\u751F\u5E76\u53D1\u66F4\u65B0\uFF0C\u8BF7\u52A0\u8F7D\u6700\u65B0\u8FDB\u5EA6\u540E\u91CD\u8BD5", code: "farm_conflict", ...latest ? await lockedView(c.env.DB, user.id, latest, t) : {} }, 409);
  }
  const visible2 = leaseSceneView(view(saved, t), { locks, rented: scene.rented.map((l) => result.leases.find((next) => next.id === l.id) ?? l) });
  return c.json({ ...visible2, messages: result.messages });
});

// src/farm/farewell-value.ts
var nonnegative = (n) => {
  if (!Number.isSafeInteger(n) || n < 0) throw Error("farm_farewell_invalid_amount");
  return n;
};
function farewellValue(input, t, prices, lots, leases, extras) {
  const lines = [];
  const add = (kind, label, quantity, cents) => {
    nonnegative(quantity);
    nonnegative(cents);
    if (cents) lines.push({ kind, label, quantity, cents });
  };
  const price = (key, base) => nonnegative(prices[key] ?? base * 100);
  if (input) {
    const s = projectFarm(input, t), counts = inventoryCounts(s);
    for (const item of MARKET_ITEMS) {
      const count4 = nonnegative(counts[item.key] ?? 0);
      if (!count4) continue;
      const lot = lots.find((l) => l.item === item.key), tracked = Math.min(count4, lot?.quantity ?? 0), fresh = Math.min(tracked, lot?.fresh ?? 0), untracked = count4 - tracked;
      const cents = (fresh + untracked) * price(item.key, item.price) + Math.floor((tracked - fresh) * price(item.key, item.price) / 10);
      add("inventory", item.name, count4, cents);
    }
    for (const crop of CROPS) add("seeds", crop.name + "\u79CD\u5B50", s.seeds[crop.id] ?? 0, (s.seeds[crop.id] ?? 0) * crop.seedPrice * 100);
    for (const plot of s.plots) {
      const crop = CROPS.find((c) => c.id === plot.crop);
      if (crop) {
        const n = 2 - Math.min(1, Math.max(0, plot.stolen ?? 0));
        add("growing", crop.name + "\u5F53\u671F\u6536\u6210", n, n * price("crop:" + crop.id, crop.sellPrice));
      }
    }
    for (const animal of s.ranch?.animals ?? []) {
      const spec = ANIMALS.find((a) => a.id === animal.kind);
      if (!spec) throw Error("farm_farewell_unknown_animal");
      const n = animal.stored + (animal.deadAt === void 0 ? Math.max(0, Math.ceil((animal.fedUntil - animal.producedAt) / spec.seconds)) : 0);
      add("ranch", spec.product + "\uFF08\u542B\u5DF2\u6295\u5582\u7684\u672A\u5B8C\u6210\u4EA7\u51FA\uFF09", n, n * price("animal:" + spec.id, spec.sellPrice));
      if (animal.deadAt === void 0) add("animal", spec.name + "\u8D2D\u5165\u4EF7\u8FD4\u8FD8", 1, spec.price * 100);
    }
    for (const pig of s.pigs?.animals ?? []) {
      const spec = PIGS.find((p) => p.id === pig.kind);
      if (spec && !pig.deadAt) add("pig", spec.name + "\u6210\u719F\u6536\u76CA", 1, spec.sellPrice * 100);
    }
    add("feed", "\u5269\u4F59\u9972\u6599", s.ranch?.feed ?? 0, (s.ranch?.feed ?? 0) * RANCH_RULES.feedPrice * 100);
    const avgFish = FISH.reduce((n, f) => n + price("fish:" + f.id, f.price), 0) / FISH.length;
    if (s.fishing?.idle) add("fishing", "\u6302\u673A\u9493\u9C7C\u5B8C\u6574\u9884\u671F\u6536\u76CA", s.fishing.idle.count, Math.ceil(avgFish * s.fishing.idle.count));
    if (s.fishing?.cast && s.fishing.cast.expires >= t) {
      const n = ("rods" in s.fishing.cast ? s.fishing.cast.rods : 1) ?? 1;
      add("fishing", "\u8FDB\u884C\u4E2D\u629B\u7AFF\u8D39\u7528\u8FD4\u8FD8", n, LEISURE_RULES.castCost * n * 100);
    }
    const itemPrices = { river_bait: 4, strong_line: 8, compost: 10, ward_charm: 20, feed_bundle: 12, reed: 3 };
    for (const [id, n] of Object.entries(s.fishing?.items ?? {})) {
      if (n && !Object.hasOwn(itemPrices, id)) throw Error("farm_farewell_unknown_item");
      add("tools", id, n, n * (itemPrices[id] ?? 0) * 100);
    }
    const rod = s.fishing?.gear?.rod ?? 0;
    add("equipment", "\u9C7C\u7AFF\u5347\u7EA7\u6295\u5165\u8FD4\u8FD8", rod, FISHING_RODS.filter((r) => r.level <= rod).reduce((n, r) => n + r.cost, 0) * 100);
    add("land", "\u5730\u5757\u6269\u5EFA\u6295\u5165\u8FD4\u8FD8", s.plots.length, FARM_EXPANSIONS.filter((e) => e.plots < s.plots.length).reduce((n, e) => n + e.coins, 0) * 100);
    const slots = s.ranch?.slots ?? 6;
    add("land", "\u7267\u573A\u6269\u5EFA\u6295\u5165\u8FD4\u8FD8", slots, RANCH_EXPANSIONS.filter((e) => e.slots < slots).reduce((n, e) => n + e.coins, 0) * 100);
  }
  for (const lease of leases) {
    const plot = JSON.parse(lease.crop_state), crop = CROPS.find((c) => c.id === plot.crop);
    if (crop) {
      const n = 2 - Math.min(1, Math.max(0, plot.stolen ?? 0));
      add("lease", "\u79DF\u5730 \xB7 " + crop.name, n, n * price("crop:" + crop.id, crop.sellPrice));
    }
    if (lease.expires_at > t) add("rent", "\u672A\u4F7F\u7528\u79DF\u671F\u8FD4\u8FD8", 1, Math.ceil(lease.price * 100 * (lease.expires_at - t) / (lease.expires_at - lease.started_at)));
  }
  add("market", "\u5E02\u573A\u96F6\u94B1", 1, extras.marketRemainder);
  add("conflict", "\u672A\u5B8C\u653B\u9632\u6295\u5165\u8FD4\u8FD8", 1, extras.conflictRefund * 100);
  const totalCents = nonnegative(lines.reduce((n, x) => n + x.cents, 0));
  return { lines, total_cents: totalCents, coins: Math.ceil(totalCents / 100) };
}

// src/farm/farewell.ts
var farewellLive = "EXISTS(SELECT 1 FROM users WHERE id=?1 AND id>0 AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1)";
async function settleFarmFarewellUser(db, uid, t, prices) {
  const row = await farmWallet(db, uid, FARM_CLOSE_AT);
  await db.prepare(`INSERT OR IGNORE INTO coin52_wallets(user_id,updated_at) SELECT ?1,?2 WHERE ${farewellLive}`).bind(uid, t).run();
  const queries = await db.batch([
    db.prepare("SELECT balance,revision FROM coin52_wallets WHERE user_id=?").bind(uid),
    db.prepare("SELECT item,SUM(quantity) quantity,SUM(CASE WHEN expires_at>? THEN quantity ELSE 0 END) fresh FROM farm_market_lots WHERE owner_id=? GROUP BY item").bind(FARM_CLOSE_AT, uid),
    db.prepare("SELECT crop_state,price,started_at,expires_at FROM farm_leases WHERE tenant_id=? AND state='active'").bind(uid),
    db.prepare("SELECT remainder_cents FROM farm_market_accounts WHERE user_id=?").bind(uid),
    db.prepare("SELECT attacker_id,defender_id,starts_at,resolves_at,attack_tools,defense_tools,bond,status FROM farm_conflicts WHERE attacker_id=?1 AND status IN('preparing','escrow','uprising','claimable') UNION ALL SELECT attacker_id,defender_id,starts_at,resolves_at,attack_tools,defense_tools,bond,status FROM farm_conflicts WHERE defender_id=?1 AND status IN('preparing','escrow','uprising','claimable')").bind(uid),
    db.prepare("SELECT b.starts_at,b.resolves_at FROM farm_uprising_members m JOIN farm_uprisings u ON u.battle_id=m.battle_id JOIN farm_conflicts b ON b.id=m.battle_id WHERE m.user_id=? AND u.status='forming' AND b.status='uprising'").bind(uid)
  ]);
  const wallet2 = queries[0].results[0];
  if (!wallet2) throw Error("farm_farewell_wallet_unavailable");
  let refund = 0;
  for (const battle of queries[4].results) {
    const rules = conflictBattleRules(battle);
    refund += battle.attacker_id === uid ? rules.fee + battle.attack_tools * rules.toolCost + (battle.status === "preparing" ? battle.bond : 0) : battle.defense_tools * rules.toolCost;
  }
  for (const battle of queries[5].results) refund += conflictBattleRules(battle).uprisingCost;
  const value = farewellValue(row ? JSON.parse(row.state) : null, FARM_CLOSE_AT, prices, queries[1].results, queries[2].results, { marketRemainder: Number(queries[3].results[0]?.remainder_cents ?? 0), conflictRefund: refund });
  const total = value.coins + FARM_FAREWELL_BONUS, balance = wallet2.balance + total, attempt = crypto.randomUUID();
  if (!Number.isSafeInteger(balance)) throw Error("farm_farewell_balance_overflow");
  const result = await db.batch([
    db.prepare(`UPDATE farm_farewell_recipients SET status='paid',asset_coins=?3,bonus=?4,details=?5,state_snapshot=?6,save_revision=?7,wallet_revision=?8,attempt=?9,paid_at=?10
   WHERE batch_id=?2 AND user_id=?1 AND status='pending' AND ${farewellLive}
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND revision=?8)
   AND ((?7 IS NULL AND NOT EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1)) OR EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?7)) RETURNING user_id`).bind(uid, FARM_FAREWELL_ID, value.coins, FARM_FAREWELL_BONUS, JSON.stringify(value), row?.state ?? null, row?.revision ?? null, wallet2.revision, attempt, t),
    db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT ?1,'farm-farewell-assets',?2,?3||'-assets',?4,?5,?6 WHERE ?4>0 AND EXISTS(SELECT 1 FROM farm_farewell_recipients WHERE attempt=?3)`).bind(uid, FARM_FAREWELL_ID, attempt, value.coins, wallet2.balance + value.coins, t),
    db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT ?1,'farm-farewell-bonus',?2,?3||'-bonus',?4,?5,?6 WHERE EXISTS(SELECT 1 FROM farm_farewell_recipients WHERE attempt=?3)`).bind(uid, FARM_FAREWELL_ID, attempt, FARM_FAREWELL_BONUS, balance, t),
    db.prepare("UPDATE coin52_wallets SET balance=?,revision=revision+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM farm_farewell_recipients WHERE attempt=?)").bind(balance, t, uid, attempt),
    // Keep the original save for the memorial archive. Revision invalidates stale in-flight actions.
    db.prepare("UPDATE farm_saves SET revision=revision+1 WHERE user_id=? AND EXISTS(SELECT 1 FROM farm_farewell_recipients WHERE attempt=?)").bind(uid, attempt),
    db.prepare("INSERT OR IGNORE INTO title_awards(user_id,title,source,created_at,levels) SELECT ?,'oldfarmer','farm-farewell-20261028',?,5200 WHERE EXISTS(SELECT 1 FROM farm_farewell_recipients WHERE attempt=?)").bind(uid, t, attempt)
  ]);
  return { paid: result[0].results.length === 1, amount: total };
}
async function runFarmFarewell(db, t) {
  if (!farmClosed(t)) return { pending: true };
  await db.prepare("INSERT OR IGNORE INTO farm_farewell_batches(id,closes_at,created_at) VALUES(?,?,?)").bind(FARM_FAREWELL_ID, FARM_CLOSE_AT, t).run();
  const batch = await db.prepare("SELECT status FROM farm_farewell_batches WHERE id=?").bind(FARM_FAREWELL_ID).first();
  if (batch?.status === "complete") return { complete: true };
  const [pending, quotes] = await db.batch([
    db.prepare("SELECT user_id FROM farm_farewell_recipients WHERE batch_id=? AND status='pending' AND retry_at<=? ORDER BY retry_at,user_id LIMIT 8").bind(FARM_FAREWELL_ID, t),
    db.prepare("SELECT item,price_cents FROM farm_farewell_prices WHERE batch_id=?").bind(FARM_FAREWELL_ID)
  ]);
  const prices = Object.fromEntries(quotes.results.map((r) => [String(r.item), Number(r.price_cents)]));
  let paid = 0, failed = 0;
  for (const r of pending.results) {
    const uid = Number(r.user_id);
    const eligible = await db.prepare(`SELECT 1 WHERE ${farewellLive}`).bind(uid).first();
    if (!eligible) {
      await db.prepare("UPDATE farm_farewell_recipients SET status='skipped' WHERE batch_id=? AND user_id=? AND status='pending'").bind(FARM_FAREWELL_ID, uid).run();
      continue;
    }
    try {
      if ((await settleFarmFarewellUser(db, uid, t, prices)).paid) paid++;
    } catch {
      failed++;
      console.error("farm_farewell_retry", uid);
      await db.prepare("UPDATE farm_farewell_recipients SET failures=failures+1,retry_at=? WHERE batch_id=? AND user_id=? AND status='pending'").bind(t + 300, FARM_FAREWELL_ID, uid).run();
    }
  }
  await db.prepare("UPDATE farm_farewell_batches SET status='complete',completed_at=? WHERE id=? AND status='settling' AND NOT EXISTS(SELECT 1 FROM farm_farewell_recipients WHERE batch_id=? AND status='pending')").bind(t, FARM_FAREWELL_ID, FARM_FAREWELL_ID).run();
  return { paid, failed };
}
export {
  CROPS,
  farm,
  newFarm,
  runFarmFarewell,
  settleConflicts,
  settleFarmLeases,
  settleMarket
};
