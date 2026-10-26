import {COMMUNITY_FISH} from './community-species.ts'
export const FISH=[
 ['huan','桃腮鳑鲏',4,'#c89b9d'],['banana','金弯泥鳅',5,'#c5ae70'],['meme','花斑小鲤',4,'#c49b78'],['linux','墨衣金鳍',6,'#65727c'],
 ['seek','鲸梦蓝鳍',8,'#739da9'],['gpt','青结鲤',6,'#849c75'],['claude','暖斑溪鳟',6,'#be9677'],['gemini','双星蝶尾',8,'#a39bbb'],
 ['jev','两面青鲈',5,'#8da6a1'],['kimi','月牙银鲳',7,'#a9b5c1'],['qwen','云纹白条',5,'#a0b5c4'],['grok','夜巡乌鲈',9,'#72748a'],
 ['holy','流金锦鲤',12,'#ccb47a'],['mole','赤须夜鲶',10,'#946d80'],['capy','困困弹涂',3,'#b09c83'],['bug','疾风青梭',7,'#81a69f'],
...COMMUNITY_FISH,
].map(([id,name,price,color],frame)=>({id:String(id),name:String(name),price:Number(price),color:String(color),frame}))
export const FISHING_ITEMS=[
 {id:'river_bait',name:'溪虫饵',description:'下次手动垂钓消耗1份，非鱼掉落由30%提高至40%。'},
 {id:'strong_line',name:'韧丝线',description:'下次手动垂钓消耗1份，张力增长放缓；基础脱钩率降至2%。'},
 {id:'compost',name:'水草堆肥',description:'用于未加速的生长中作物，缩短原生长时间10%，每茬仅一次。'},
 {id:'ward_charm',name:'巡田铃',description:'开启15分钟防摘守护，不叠加剩余时间。'},
 {id:'feed_bundle',name:'谷物包',description:'打开获得6份牧场饲料。'},
 {id:'reed',name:'柔韧芦苇',description:'3份可编成1根韧丝线。'},
] as const
export const FISHING_RODS=[{level:0,name:'旧竹竿',cost:0},{level:1,name:'溪行竿',cost:80},{level:2,name:'听潮竿',cost:240},{level:3,name:'星汐竿',cost:600}]
export const FISHING_LOOT_RULES={fish:70,crop:9,seeds:7,coins:5,item:8,title:1,baseEscapePercent:8,lineEscapePercent:2}
