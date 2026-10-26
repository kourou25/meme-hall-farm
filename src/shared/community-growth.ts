// Distinct progress tracks; purchases never directly buy title levels.
export const COMMUNITY_GROWTH=[
 {series:'resource_respect',name:'受人敬仰',unit:'次认可',levels:[5,20,50,100,300],color:'#8a5e94',accent:'#eed3a1',motif:'laurel',desc:'资源分享获得不同账号认可；同人同帖只累计一次，取消后重勾不重复计入'},
 {series:'card_draws',name:'赌鬼',unit:'次抽卡',levels:[10,100,500,2000,10000],color:'#9c6a8f',accent:'#e4c4a4',motif:'mask',desc:'累计完成抽卡；不要求中奖，不增加中奖概率'},
 {series:'card_wins',name:'欧皇出巡',unit:'次永久称号',levels:[1,20,100,500,2000],color:'#bc8b3c',accent:'#e4ce91',motif:'sun',desc:'抽到永久称号的次数，体验卡不计入'},
 {series:'card_dry',name:'非酋也发光',unit:'连抽未中',levels:[5,10,20,35,50],color:'#687692',accent:'#c8c9dd',motif:'moon',desc:'历史最长连续未获永久称号次数，保底后荣誉仍保留'},
 {series:'scratch_draws',name:'开票达人',unit:'张刮刮乐',levels:[10,100,500,2000,10000],color:'#4e9790',accent:'#e5ce9c',motif:'lotus',desc:'累计购买的刮刮乐张数'},
 {series:'scratch_wins',name:'彩运随行',unit:'张中奖票',levels:[1,30,150,600,3000],color:'#bb7296',accent:'#d9cdb1',motif:'flower',desc:'刮刮乐获得非零奖励的张数'},
 {series:'scratch_jackpot',name:'赌神',unit:'次十倍彩',levels:[1,3,10,30,100],color:'#9a7739',accent:'#dcd88b',motif:'star',desc:'刮刮乐单张获得10倍及以上奖励，不代表未来胜率'},
 {series:'scratch_dry',name:'再起不能',unit:'连张未中',levels:[3,6,10,15,25],color:'#8b7e9b',accent:'#becbda',motif:'cloud',desc:'刮刮乐历史最长连续未中奖张数；用于记录趣味经历'},
 {series:'lotto_wins',name:'七星来客',unit:'注中奖',levels:[1,5,20,100,500],color:'#527da0',accent:'#c9d9a4',motif:'star',desc:'大乐透已完成发奖的中奖注数'},
 {series:'coins_peak',name:'金库主人',unit:'枚最高余额',levels:[1000,10000,100000,1000000,10000000],color:'#ad8a40',accent:'#e6cda0',motif:'sun',desc:'账户曾达到的最高D币余额；消费不撤回已获荣誉'},
 {series:'market_trades',name:'集市行家',unit:'笔交易',levels:[1,20,100,500,2000],color:'#688f7d',accent:'#e2c79c',motif:'sprout',desc:'动态集市成功买入或售出交易笔数'},
 {series:'market_sold',name:'丰收掌柜',unit:'枚销售收入',levels:[100,1000,10000,100000,1000000],color:'#ae8055',accent:'#d8d79e',motif:'lotus',desc:'动态集市累计售出收入，收入不等于利润'},
 {series:'raid_wins',name:'掠影游侠',unit:'次行动成功',levels:[1,5,20,100,500],color:'#916e76',accent:'#d7bfa0',motif:'blade',desc:'对抗货仓行动判定成功次数；仅限双方加入的对抗玩法'},
 {series:'defend_wins',name:'铁壁守望',unit:'次防守成功',levels:[1,5,20,100,500],color:'#5c8794',accent:'#b9d1cd',motif:'halberd',desc:'对抗行动被成功阻止的次数'},
 {series:'uprising_wins',name:'揭竿同盟',unit:'次追索成功',levels:[1,3,10,30,100],color:'#b37a5b',accent:'#e2c882',motif:'spear',desc:'参与并成功追回物资的起义次数'},
] as const
export const COMMUNITY_REWARDS=COMMUNITY_GROWTH.flatMap(f=>f.levels.map((wins,i)=>({...f,id:f.series+(i+1),label:f.name,level:i+1,wins,symbol:'✦'})))
