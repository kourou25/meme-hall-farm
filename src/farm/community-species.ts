// Public nickname/chat motifs only. Provenance stays in research, never shipped.
export const COMMUNITY_CROPS=[
 ['baobao_blessing_rice','饱饱福签稻','corn','grain',0xd7b66c,0x86a16e,'star','胖鱼把福签藏进稻穗，祝每个干饭人都有收成。'],
 ['baobao_big_banana','吃大份金蕉','jiba_banana','banana',0xe4be6a,0x779662,'coin','群里的一句“吃大的”，长成了沉甸甸的金蕉。'],
 ['iron_armour_eggplant','铁男轻甲茄','grok_eggplant','pepper',0x87949e,0x6e9678,'gear','银灰小甲片裹住茄子，今天也绝不空收。'],
 ['iron_offwork_mint','下班摸鱼薄荷','cabbage','flower',0xa3bfb3,0x548d80,'clock','等到下班铃响，就把烦恼留在田埂外。'],
 ['polaris_star_lotus','Polaris寻星莲','naizi_peach','flower',0xaaa6d2,0x789b9e,'star','北极星来自昵称，星点在莲心悄悄发亮。'],
 ['polaris_water_berry','多喝水露莓','gemini_berry','berry',0x8db6c1,0x739e82,'bubble','把群里的一句“多喝点水”，收成一簇清凉露莓。'],
 ['bigrice_little_grain','BigRice稻光穗','wheat','grain',0xdcc68c,0x859b67,'sun','米粒小精灵，名字取自群友公开昵称。'],
 ['bigrice_rice_mushroom','米粒绒绒菇','mole_mushroom','mushroom',0xe3dbc1,0xa3b399,'cloud','像小饭团一样的菌帽，颗颗饱满。'],
 ['soup_morning_pumpkin','早茶羹羹瓜','pumpkin','pumpkin',0xcbb07d,0x839d6a,'sun','给清晨的问候留一碗热乎乎的田园汤。'],
 ['soup_cosmos_flower','天地无极花','meme_sunflower','flower',0xd8b499,0x779078,'twin','名字来自天地无极羹，花心像旋转的小汤碗。'],
 ['group_coupon_pepper','国补灯笼椒','tomato','pepper',0xd59a77,0x7c995f,'lamp','群聊红包的“国补”梗，结成一串小灯笼。'],
 ['group_shared_clover','互助券券草','wheat','flower',0xa7bb8e,0x648d6b,'clover','把互助小券折成四叶，收好每一次顺手帮忙。'],
] as const
export const COMMUNITY_FISH=[
 ['baobao','饱饱福鱼',8,'#c6ad75'],['ironfish','铁男银甲鲈',7,'#8c9b9e'],['offwork','下班钟摆鲀',6,'#afa58b'],
 ['polaris','Polaris星尾鳉',8,'#9c9ac0'],['waterplease','露水青鲤',5,'#88ada8'],['bigrice','米光银鱼',6,'#c4bc9f'],
 ['soup','早茶暖鳍鲫',6,'#c6a084'],['coupon','国补红包鲷',7,'#bd8b83'],
] as const
export function communityCrops<T extends {id:string;seconds:number;seedPrice:number;sellPrice:number;xp:number;unlock:number}>(base:ReadonlyArray<T>){return COMMUNITY_CROPS.map(([id,name,tier,,,,,story],i)=>{const p=base.find(p=>p.id===tier);if(!p)throw Error('群友物种档位缺失');return {...p,id,name,frame:600+i,collection:'群友限定',story}})}
