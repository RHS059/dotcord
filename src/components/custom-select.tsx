import * as React from 'react';
import {Check, ChevronDown} from 'lucide-react';
import {cn} from '@/lib/utils';
export type SelectOption = {value: string; label: string; hint?: string};
export type CustomSelectProps = {id?: string;label: string;value: string;onChange: (value: string) => void;options: SelectOption[];disabled?: boolean;variant?: 'field' | 'chip';className?: string};
const openMenuEvent = 'dotcord:open-select';
/** Shared keyboard/focus behavior for all dropdowns. */
export function useSelectController({id,value,options,onChange,disabled=false,open:controlledOpen,defaultOpen=false,onOpenChange}: {
  id:string;value:string;options:Array<{value:string;disabled?:boolean}>;onChange:(value:string)=>void;disabled?:boolean;open?:boolean;defaultOpen?:boolean;onOpenChange?:(open:boolean)=>void;
}) {
  const [internalOpen,setInternalOpen]=React.useState(defaultOpen);
  const open=controlledOpen??internalOpen;
  const [activeIndex,setActiveIndex]=React.useState(0);
  const rootRef=React.useRef<HTMLDivElement>(null);
  const triggerRef=React.useRef<HTMLButtonElement>(null);
  const optionRefs=React.useRef<Array<HTMLElement|null>>([]);
  const enabledIndices=options.flatMap((option,index)=>option.disabled?[]:[index]);
  const selectedIndex=options.findIndex(option=>option.value===value&&!option.disabled);
  const currentIndex=selectedIndex>=0?selectedIndex:(enabledIndices[0]??-1);
  const setOpen=React.useCallback((next:boolean)=>{
    if(next===open)return;
    if(next&&(disabled||!options.some(option=>!option.disabled)))return;
    if(next){setActiveIndex(currentIndex);window.dispatchEvent(new CustomEvent(openMenuEvent,{detail:id}));}
    setInternalOpen(next);onOpenChange?.(next);
  },[currentIndex,disabled,id,onOpenChange,open,options]);
  React.useEffect(()=>{
    if(!open)return;
    const onOtherMenu=(event:Event)=>{if((event as CustomEvent<string>).detail!==id)setOpen(false);};
    const onOutside=(event:MouseEvent|TouchEvent)=>{if(event.target instanceof Node&&!rootRef.current?.contains(event.target))setOpen(false);};
    window.addEventListener(openMenuEvent,onOtherMenu);
    document.addEventListener('mousedown',onOutside);
    document.addEventListener('touchstart',onOutside,{passive:true});
    return()=>{window.removeEventListener(openMenuEvent,onOtherMenu);document.removeEventListener('mousedown',onOutside);document.removeEventListener('touchstart',onOutside);};
  },[id,open,setOpen]);
  React.useEffect(()=>{if(disabled&&open)setOpen(false);},[disabled,open,setOpen]);
  React.useEffect(()=>{if(open)optionRefs.current[activeIndex]?.scrollIntoView?.({block:'nearest'});},[activeIndex,open]);
  const select=(index:number)=>{const option=options[index];if(disabled||!option||option.disabled)return;onChange(option.value);setOpen(false);triggerRef.current?.focus({preventScroll:true});};
  const onKeyDown=(event:React.KeyboardEvent<HTMLButtonElement>)=>{
    if(disabled)return;
    if(!open){if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();setOpen(true);}return;}
    if(event.key==='Tab'){setOpen(false);return;}
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);return;}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();select(activeIndex);return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const activePosition=enabledIndices.indexOf(activeIndex);
      const nextPosition=event.key==='Home'?0:event.key==='End'?enabledIndices.length-1:(activePosition+(event.key==='ArrowDown'?1:-1)+enabledIndices.length)%enabledIndices.length;
      setActiveIndex(enabledIndices[nextPosition]??-1);
    }
  };
  return {open,setOpen,activeIndex,setActiveIndex,select,onKeyDown,rootRef,triggerRef,optionRefs};
}
export function CustomSelect({id,label,value,onChange,options,disabled=false,variant='field',className}:CustomSelectProps){
  const generatedId=React.useId();const menuId=id||`select-${generatedId.replace(/[^a-zA-Z0-9_-]/g,'')}`;
  const control=useSelectController({id:menuId,value,options,onChange,disabled});
  const selected=options.find(option=>option.value===value);
  return <div ref={control.rootRef} data-menu="" data-open={control.open} data-variant={variant} data-provider={variant==='chip'?value:undefined} className={cn('custom-select',className)}>
    <span id={`${menuId}-lbl`} className={variant==='chip'?'sr-only':'custom-select-label'}>{label}</span>
    <button ref={control.triggerRef} id={id||`${menuId}-trigger`} type="button" className="custom-select-trigger" role="combobox" aria-haspopup="listbox" aria-expanded={control.open} aria-controls={`${menuId}-list`} aria-activedescendant={control.open&&control.activeIndex>=0?`${menuId}-opt-${control.activeIndex}`:undefined} aria-labelledby={`${menuId}-lbl ${menuId}-btn`} disabled={disabled} onClick={()=>control.setOpen(!control.open)} onKeyDown={control.onKeyDown} onBlur={event=>{if(!event.currentTarget.parentElement?.contains(event.relatedTarget as Node|null))control.setOpen(false);}}>
      <span id={`${menuId}-btn`} className="custom-select-value">{selected?.label||'Select an option…'}</span><ChevronDown aria-hidden="true" className="custom-select-chevron"/>
    </button>
    <ul id={`${menuId}-list`} role="listbox" aria-labelledby={`${menuId}-lbl`} aria-hidden={!control.open} className="custom-select-list" inert={!control.open}>
      {options.map((option,index)=><li key={option.value} ref={element=>{control.optionRefs.current[index]=element;}} id={`${menuId}-opt-${index}`} role="option" aria-selected={option.value===value} data-active={index===control.activeIndex} data-provider={variant==='chip'?option.value:undefined} className={cn('custom-select-option',option.hint&&'has-hint')} onMouseEnter={()=>control.setActiveIndex(index)} onMouseDown={event=>{event.preventDefault();control.select(index);}} onClick={event=>{if(event.detail===0)control.select(index);}}>
        <span className="custom-select-option-copy"><span>{option.label}</span>{option.hint&&<span className="custom-select-hint">{option.hint}</span>}</span>{option.value===value&&<Check aria-hidden="true" className="custom-select-check"/>}
      </li>)}
    </ul>
  </div>;
}
