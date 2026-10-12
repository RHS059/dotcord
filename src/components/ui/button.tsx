import * as React from 'react';
import {cva,type VariantProps} from 'class-variance-authority';
import {Slot} from 'radix-ui';
import {cn} from '@/lib/utils';
const buttonVariants=cva('ui-button',{
 variants:{variant:{default:'ui-button-primary',destructive:'ui-button-destructive',outline:'ui-button-outline',secondary:'ui-button-secondary',ghost:'ui-button-ghost',link:'ui-button-link'},size:{default:'ui-button-default',xs:'ui-button-xs',sm:'ui-button-sm',lg:'ui-button-lg',icon:'ui-button-icon','icon-xs':'ui-button-icon-xs','icon-sm':'ui-button-icon-sm','icon-lg':'ui-button-icon-lg'}},
 defaultVariants:{variant:'default',size:'default'},
});
function Button({className,variant='default',size='default',asChild=false,...props}:React.ComponentProps<'button'>&VariantProps<typeof buttonVariants>&{asChild?:boolean}){
 const Comp=asChild?Slot.Root:'button';
 return <Comp data-slot="button" data-variant={variant} data-size={size} className={cn(buttonVariants({variant,size,className}))} {...props}/>;
}
export {Button,buttonVariants};
