export const GUARDIANS=[
 {id:'deepseek',name:'DeepSeek 鲸鱼娘',color:'#83aebe',theme:'巡查',image:'/assets/farm/guardians/deepseek.webp'},
 {id:'gpt',name:'GPT Astra',color:'#91ad99',theme:'协作',image:'/assets/farm/guardians/gpt.webp'},
 {id:'claude',name:'Claude 娘',color:'#cba58c',theme:'照料',image:'/assets/farm/guardians/claude.webp'},
 {id:'gemini',name:'Gemini 娘',color:'#afa4ca',theme:'警戒',image:'/assets/farm/guardians/gemini.webp'},
] as const
export type GuardianState={id:string;stance:'patrol'|'barrier'|'decoy';charges:number;chargedAt:number;skillAt:number;protectionUntil:number;careCount:number;penetrable?:boolean}
export const GUARDIAN_RULES={maxCharges:3,rechargeSeconds:21600,skillCooldown:1800,protectionSeconds:900,maxCare:6,maxLevel:20}
export function guardianView(input:GuardianState|undefined,t:number){
 if(!input)return null
 const s={...input},steps=Math.max(0,Math.floor((t-s.chargedAt)/GUARDIAN_RULES.rechargeSeconds));s.charges=Math.min(3,s.charges+steps)
 s.chargedAt=s.charges===3?t:s.chargedAt+steps*GUARDIAN_RULES.rechargeSeconds
 return {...s,level:Math.min(20,1+Math.floor(s.careCount/20)),nextCharge:s.charges===3?null:s.chargedAt+GUARDIAN_RULES.rechargeSeconds}
}
export function guardianAction(s:{guardian?:GuardianState},a:Record<string,unknown>,t:number){
 const require=(ok:unknown,message:string)=>{if(!ok)throw Error(message)}
 if(a.type==='guardian_select'){
  require(Object.keys(a).every(k=>['type','id'].includes(k))&&GUARDIANS.some(g=>g.id===a.id),'守护兽不存在')
  const previous=guardianView(s.guardian,t)
  // Switching characters never resets energy, cooldown, levels or an active ward.
  s.guardian=previous?{...previous,id:String(a.id)}:{id:String(a.id),stance:'patrol',charges:3,chargedAt:t,skillAt:0,protectionUntil:0,careCount:0}
  return '守护兽已到岗，成长与专注值由四个形象共用'
 }
 require(s.guardian,'请先选择守护兽')
 const g=s.guardian=guardianView(s.guardian,t)!
 if(a.type==='guardian_stance'){
  require(Object.keys(a).every(k=>['type','stance'].includes(k))&&['patrol','barrier','decoy'].includes(String(a.stance)),'防守策略无效');g.stance=a.stance as GuardianState['stance'];return '防守策略已保存'
 }
 require(a.type==='guardian_skill'&&Object.keys(a).every(k=>['type','skill'].includes(k))&&['ward','care'].includes(String(a.skill)),'守护技能无效')
 require(t>=g.skillAt+GUARDIAN_RULES.skillCooldown,'守护技能仍在冷却');require(g.charges>0,'专注值不足，恢复后可再使用')
 if(a.skill==='ward')require(g.protectionUntil<=t,'守护正在生效')
 g.charges--;g.skillAt=t;g.careCount++
 if(a.skill==='ward'){g.protectionUntil=t+GUARDIAN_RULES.protectionSeconds;g.penetrable=true}
 return a.skill==='ward'?'守护兽警戒15分钟：拦截普通摘取，潜入成功率降至40%':'守护兽完成协助照料'
}
export function protectedUntil(s:{guardUntil?:number;guardSoftUntil?:number;guardian?:GuardianState}){return Math.max(s.guardUntil??0,s.guardSoftUntil??0,s.guardian?.protectionUntil??0)}
// 已付费的旧绝对保护履行至到期，新守护才适用潜入对抗。
export function hardProtectionUntil(s:{guardUntil?:number;guardian?:GuardianState}){return Math.max(s.guardUntil??0,s.guardian?.penetrable?0:s.guardian?.protectionUntil??0)}
