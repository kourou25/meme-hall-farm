export const safeNext=(value:unknown):string=>{
 if(typeof value!=='string'||value.length>300||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020\u007f]/.test(value))return '/'
 return value
}
