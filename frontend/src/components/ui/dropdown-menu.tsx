import * as React from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof DM.Content>, React.ComponentPropsWithoutRef<typeof DM.Content>>(
  ({ className, sideOffset = 4, ...props }, ref) => (
    <DM.Portal>
      <DM.Content ref={ref} sideOffset={sideOffset}
        className={cn("z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0", className)} {...props} />
    </DM.Portal>
  ));
DropdownMenuContent.displayName = "DropdownMenuContent";
export const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof DM.Item>, React.ComponentPropsWithoutRef<typeof DM.Item>>(
  ({ className, ...props }, ref) => (
    <DM.Item ref={ref} className={cn("relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4", className)} {...props} />
  ));
DropdownMenuItem.displayName = "DropdownMenuItem";
export const DropdownMenuSeparator = ({ className }: { className?: string }) => <DM.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} />;
export const DropdownMenuLabel = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof DM.Label>) => <DM.Label className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)} {...p} />;
