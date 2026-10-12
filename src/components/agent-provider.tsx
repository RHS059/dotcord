import {CustomSelect} from '@/components/custom-select';
export type WakeProvider='dot'|'grokbot'|'claude';
export const providerLabel=(provider:WakeProvider='dot')=>({dot:'Dot',grokbot:'Grokbot',claude:'Claude'}[provider]);
const providers=(['dot','grokbot','claude'] as const).map(value=>({value,label:providerLabel(value)}));
export function AgentProvider({value='dot',onChange,disabled=false,label='Agent Type'}:{value?:WakeProvider;onChange:(value:WakeProvider)=>void;disabled?:boolean;label?:string}){
  return <CustomSelect label={label} value={value} onChange={value=>onChange(value as WakeProvider)} options={providers} disabled={disabled} variant="chip"/>;
}
