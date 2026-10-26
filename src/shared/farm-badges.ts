import {CROPS,TREE_KINDS} from '../farm/rules'

export const FARM_BADGES = [
 {id:'ranch_collected',name:'牧歌丰收',unit:'份畜产',levels:[10,100,1000,5000,20000],tile:10,tier:'fun',desc:'累计收取畜产，照料的日常成为牧场荣誉'},
 {id:'guardian_care',name:'护灵同伴',unit:'次协作',levels:[1,20,100,300,1000],tile:10,tier:'epic',desc:'守护兽成功施放技能的累计次数'},
 {id:'fishing_escaped',name:'脱钩哲学家',unit:'次脱钩',levels:[1,10,50,200,1000],tile:10,tier:'fun',desc:'鱼儿成功逃脱的次数，失败也留下故事'},
 {id:'fishing_discovery',name:'水域博物家',unit:'种鱼获',levels:[1,5,10,16,24],tile:10,tier:'rare',desc:'鱼篓图鉴中累计发现的不同鱼种'},
 {id:'farm_water',name:'朝露园丁',unit:'次浇水',levels:[1,24,100,500,2000],tile:8,tier:'fun',desc:'更新后成功浇水次数，批量操作逐块累计'},
 {id:'farm_pest',name:'护苗巡官',unit:'次除虫',levels:[1,10,50,200,1000],tile:8,tier:'rare',desc:'更新后成功除虫次数'},

 {id:'fishing_landed',name:'听浪钓客',unit:'次遛鱼',levels:[1,20,100,500,2000],tile:10,tier:'rare',desc:'成功完成场景遛鱼 1 / 20 / 100 / 500 / 2000 次升级'},
 {id:'fishing_treasure',name:'锦鲤附体',unit:'次秘藏',levels:[1,3,10,30,100],tile:10,tier:'epic',desc:'手动钓获稀有称号秘藏 1 / 3 / 10 / 30 / 100 次升级'},
 {id:'farm_plant',name:'种田高手',unit:'次播种',levels:[1,24,100,500,2000],tile:8,tier:'fun',desc:'累计播种 1 / 24 / 100 / 500 / 2000 次升级，已有播种进度保留'},
 {id:'farm_steal',name:'顺手摘星',unit:'份摘取',levels:[1,10,50,200,1000],tile:10,tier:'rare',desc:'累计摘取作物或畜产 1 / 10 / 50 / 200 / 1000 份升级；从2026年10月22日新版成功操作起累计'},
 {id:'farm_harvest',name:'收成记事',unit:'份收成',levels:[2,20,100,500,2000],tile:8,tier:'fun',desc:'云存档累计收获 2 / 20 / 100 / 500 / 2000 份作物升级'},
 {id:'farm_wood',name:'林间收藏',unit:'份木材',levels:[12,50,200,800,3000],tile:9,tier:'rare',desc:'云存档累计采集 12 / 50 / 200 / 800 / 3000 份木材升级'},
 {id:'farm_discovery',name:'田园图鉴',unit:'种物种',levels:[1,2,4,6,8],tile:10,tier:'epic',desc:'发现 1 / 2 / 4 / 6 / 8 种作物与树木升级；统计所有已上线作物与历史树木'},
] as const
export type FarmBadgeId=typeof FARM_BADGES[number]['id']
const species=new Set<string>([...CROPS.map(c=>c.id),...Object.keys(TREE_KINDS)])
const count=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0?Number(n):0
export function farmBadgeProgress(raw:unknown):Record<FarmBadgeId,number>{
 let s:any=raw
 if(typeof raw==='string'){try{s=JSON.parse(raw)}catch{s=null}}
 if(s?.version!==1&&s?.version!==2)s=null
 const discovery=s?.discovery&&typeof s.discovery==='object'&&!Array.isArray(s.discovery)?s.discovery:{}
 return {ranch_collected:count(s?.ranch?.collected),guardian_care:count(s?.guardian?.careCount),fishing_escaped:count(s?.fishing?.escaped),fishing_discovery:Object.values(s?.fishing?.discovery??{}).filter(v=>count(v)>0).length,farm_water:count(s?.totals?.watered),farm_pest:count(s?.totals?.pestsCleared),fishing_landed:count(s?.fishing?.landed),fishing_treasure:count(s?.fishing?.treasures),farm_plant:count(s?.totals?.planted),farm_steal:count(s?.totals?.stolen),farm_harvest:count(s?.totals?.harvest),farm_wood:count(s?.totals?.wood),farm_discovery:Object.entries(discovery).filter(([id,v]:[string,any])=>species.has(id)&&count(v?.count)>0&&count(v?.firstAt)>0).length}
}
export const farmBadge=(id:unknown)=>FARM_BADGES.find(b=>b.id===id)
