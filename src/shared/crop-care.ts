/** One clock for Worker, field renderers, visitor protection and leased plots. */
export type CropTiming = {wateredAt:number|null;growSeconds?:number;pestAt?:number;careCycle?:number;cycle?:string;readyNotBefore?:number}
type CropClock={seconds:number;legacySeconds?:number}
// Existing watered crops retain their original deadline. New cycles snapshot
// their duration so future balancing never changes a crop already in progress.
export const cropSeconds=(plot:CropTiming,crop:CropClock)=>plot.growSeconds??crop.legacySeconds??crop.seconds
export const CROP_CARE = {chance:0.25,appearsAt:0.35,delay:0.1} as const
export function cropMaxSeconds(seconds:number){return seconds+Math.ceil(seconds*CROP_CARE.delay)}
export function cropMatureAt(plot:CropTiming,crop:CropClock){
 const seconds=cropSeconds(plot,crop)
 return plot.wateredAt===null?Infinity:Math.max(plot.readyNotBefore??0,plot.wateredAt+seconds+(plot.pestAt===undefined?0:Math.ceil(seconds*CROP_CARE.delay)))
}
export function cropHasPests(plot:CropTiming,crop:{seconds:number},t:number){
 return plot.pestAt!==undefined&&plot.wateredAt!==null&&t>=plot.pestAt&&t<cropMatureAt(plot,crop)
}
export function cropProgress(plot:CropTiming,crop:{seconds:number},t:number){
 return plot.wateredAt===null?0:Math.max(0,Math.min(1,(t-plot.wateredAt)/(cropMatureAt(plot,crop)-plot.wateredAt)))
}
export function clearCropPests(plot:CropTiming,crop:CropClock,t:number){
 // Clearing a late infestation can ripen the crop now, never retroactively.
 // Visitor protection must still start at the actual moment of ripening.
 if(plot.wateredAt!==null&&plot.wateredAt+cropSeconds(plot,crop)<t)plot.readyNotBefore=t
 delete plot.pestAt
}
export function waterCrop(plot:CropTiming,crop:CropClock,t:number){
 plot.wateredAt=t;plot.growSeconds??=crop.seconds
 // Only new, server-created cycles participate. Existing crops keep their old deadline.
 if(plot.careCycle===1&&plot.cycle&&parseInt(plot.cycle.slice(0,2),16)<256*CROP_CARE.chance)plot.pestAt=t+Math.floor(plot.growSeconds*CROP_CARE.appearsAt)
}
