export type CareState={compostUnits:number;cleaned:number}
// Only manure created by completed production enters this converter.
export function compostManure(s:{care?:CareState;fishing?:{items?:Record<string,number>}},n:number){
 if(!Number.isSafeInteger(n)||n<=0)throw Error('暂无需要清洁的粪污')
 if(!s.fishing)throw Error('请先加载完整农场存档')
 const care=s.care??{compostUnits:0,cleaned:0},items=s.fishing.items??{},total=care.compostUnits+n,made=Math.floor(total/4)
 if((items.compost??0)+made>9999)throw Error('堆肥已满，请先使用')
 items.compost=(items.compost??0)+made;s.fishing.items=items;s.care={compostUnits:total%4,cleaned:care.cleaned+n}
 return made?`清洁完成，制成水草堆肥 ×${made}`:`清洁完成，堆肥原料 ${total%4}/4`
}
